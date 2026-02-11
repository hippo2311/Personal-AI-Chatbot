const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const dayjs = require('dayjs');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const app = express();
const PORT = Number(process.env.PORT || 4000);
const DEFAULT_NAME = 'Friend';
const DEFAULT_CHECK_IN_TIME = '20:00';

// ─── OPENAI CONFIG ───────────────────────────────────────────────────────────
// Set your OpenAI API key in the environment: OPENAI_API_KEY=sk-...
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = 'gpt-4o-mini';
console.log('🔑 OpenAI key loaded:', OPENAI_API_KEY ? `${OPENAI_API_KEY.slice(0, 10)}...` : 'NOT FOUND');
// ─── MOOD WORDS (kept for fast local fallback if OpenAI is unavailable) ──────
const POSITIVE_WORDS = new Set([
  'good', 'great', 'happy', 'awesome', 'excited', 'productive',
  'love', 'amazing', 'fantastic', 'chill', 'better', 'calm',
  'grateful', 'proud', 'fun',
]);

const NEGATIVE_WORDS = new Set([
  'bad', 'sad', 'tired', 'stressed', 'anxious', 'angry', 'upset',
  'depressed', 'lonely', 'worried', 'overwhelmed', 'burned',
  'burnt', 'hate', 'awful', 'terrible', 'exhausted',
]);

// ─── GRAPH DOMAIN CONFIG ─────────────────────────────────────────────────────
const ALLOWED_DOMAINS = [
  'Work Life',
  'Academic Life',
  'Personal Life',
  'Friends',
  'Dating',
  'Health',
  'Family',
];

// ─── DATABASE SETUP ───────────────────────────────────────────────────────────
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'chatbot.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

app.use(cors());
app.use(express.json());

initSchema();

// ─── EXISTING ROUTES (unchanged) ─────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, timestamp: nowIso() });
});

app.get('/api/user/:userId', (req, res) => {
  const userId = safeUserId(req.params.userId);
  const user = ensureUser(userId);
  res.json({ user: mapUser(user) });
});

app.put('/api/user/:userId', (req, res) => {
  const userId = safeUserId(req.params.userId);
  const user = ensureUser(userId);

  const name = normalizeName(req.body?.name ?? user.name);
  const checkInTime = normalizeCheckInTime(req.body?.checkInTime ?? user.check_in_time);

  db.prepare(
    `UPDATE users
      SET name = ?,
          check_in_time = ?,
          updated_at = ?
      WHERE id = ?`
  ).run(name, checkInTime, nowIso(), userId);

  const updatedUser = getUser(userId);
  res.json({ user: mapUser(updatedUser) });
});

app.get('/api/chat/:userId/today', (req, res) => {
  const userId = safeUserId(req.params.userId);
  const forcePrompt = req.query.forcePrompt === '1';
  const date = normalizeDate(req.query.date);

  const user = ensureUser(userId);
  ensureConversation(userId, date);

  let conversation = getConversation(userId, date);
  maybeSeedCheckInPrompt(user, conversation, date, forcePrompt);

  conversation = getConversation(userId, date);
  const messages = getMessages(conversation.id).map(mapMessage);

  res.json({
    user: mapUser(user),
    conversation: mapConversation(conversation),
    messages,
  });
});

// ─── MODIFIED: /message now calls OpenAI for the assistant reply ──────────────
app.post('/api/chat/:userId/message', async (req, res) => {
  console.log('📨 Received message from user');  // ADD THIS
  const userId = safeUserId(req.params.userId);
  const text = String(req.body?.text || '').trim();
  const date = normalizeDate(req.body?.date);

  if (!text) {
    res.status(400).json({ error: 'Message text is required.' });
    return;
  }

  const user = ensureUser(userId);
  ensureConversation(userId, date);

  const conversation = getConversation(userId, date);
  if (conversation.is_ended) {
    res.status(409).json({
      error: `Today's conversation was already closed. Start again on ${dayjs(date).add(1, 'day').format('YYYY-MM-DD')}.`,
      conversation: mapConversation(conversation),
    });
    return;
  }

  // Analyze mood (local keyword method — fast, no API call needed)
  const mood = analyzeMood(text);
  insertMessage(conversation.id, 'user', text, mood);
  updateConversationMood(conversation.id);

  const updatedConversation = getConversation(userId, date);

  // Load full message history for context
  const allMessages = getMessages(updatedConversation.id);

  // Load graph events for this user as extra context
  const graphEvents = getGraphEvents(userId);

  let assistantReply;
  try {
    assistantReply = await buildAssistantReplyAI({
      userName: user.name,
      userText: text,
      moodLabel: mood.label,
      userMessageCount: updatedConversation.user_message_count,
      allMessages,
      graphEvents,
    });
  } catch (err) {
    console.error('❌ OpenAI error, falling back to template reply:', err.message);
    console.error('Full error details:', err);
    console.error('Stack trace:', err.stack);
    // Graceful fallback to original template system
    assistantReply = buildAssistantReplyTemplate({
      userName: user.name,
      userText: text,
      moodLabel: mood.label,
      userMessageCount: updatedConversation.user_message_count,
    });
  }

  insertMessage(conversation.id, 'assistant', assistantReply.reply, null);

  const finalConversation = getConversation(userId, date);
  const messages = getMessages(finalConversation.id).map(mapMessage);

  res.json({
    conversation: mapConversation(finalConversation),
    messages,
    promptToEnd: assistantReply.promptToEnd,
  });
});

app.post('/api/chat/:userId/end-day', (req, res) => {
  const userId = safeUserId(req.params.userId);
  const date = normalizeDate(req.body?.date);

  const user = ensureUser(userId);
  ensureConversation(userId, date);

  const conversation = getConversation(userId, date);
  if (!conversation.is_ended) {
    db.prepare(
      `UPDATE conversations
        SET is_ended = 1,
            ended_at = ?,
            updated_at = ?
        WHERE id = ?`
    ).run(nowIso(), nowIso(), conversation.id);

    insertMessage(
      conversation.id,
      'assistant',
      `Nice work checking in today, ${user.name}. I will ask again at ${user.check_in_time} tomorrow.`,
      null
    );
  }

  const finalConversation = getConversation(userId, date);
  const messages = getMessages(finalConversation.id).map(mapMessage);

  res.json({
    conversation: mapConversation(finalConversation),
    messages,
  });
});

app.get('/api/dashboard/:userId', (req, res) => {
  const userId = safeUserId(req.params.userId);
  const days = clampDays(req.query.days);

  const user = ensureUser(userId);
  const rows = db
    .prepare(
      `SELECT
          c.id,
          c.user_id,
          c.date,
          c.mood_label,
          c.mood_score,
          c.is_ended,
          c.started_at,
          c.ended_at,
          c.updated_at,
          COALESCE(SUM(CASE WHEN m.sender = 'user' THEN 1 ELSE 0 END), 0) AS user_message_count,
          COALESCE(SUM(CASE WHEN m.sender = 'assistant' THEN 1 ELSE 0 END), 0) AS assistant_message_count
        FROM conversations c
        LEFT JOIN messages m ON m.conversation_id = c.id
        WHERE c.user_id = ?
        GROUP BY c.id
        ORDER BY c.date DESC
        LIMIT ?`
    )
    .all(userId, days);

  const moodBreakdown = { great: 0, good: 0, neutral: 0, low: 0, tough: 0 };
  let totalMoodScore = 0;
  let endedCount = 0;

  rows.forEach((row) => {
    const label = row.mood_label;
    if (moodBreakdown[label] !== undefined) moodBreakdown[label] += 1;
    totalMoodScore += Number(row.mood_score || 0);
    if (row.is_ended) endedCount += 1;
  });

  const totalTrackedDays = rows.length;
  const averageMoodScore = totalTrackedDays
    ? Number((totalMoodScore / totalTrackedDays).toFixed(2))
    : 0;
  const checkInsLast7Days = rows.filter((row) => {
    const diff = dayjs().startOf('day').diff(dayjs(row.date), 'day');
    return diff >= 0 && diff <= 6;
  }).length;

  const summary = {
    totalTrackedDays,
    averageMoodScore,
    averageMoodLabel: moodLabelFromScore(averageMoodScore),
    completionRate: totalTrackedDays
      ? Number(((endedCount / totalTrackedDays) * 100).toFixed(1))
      : 0,
    checkInsLast7Days,
    streakDays: computeRecentStreak(rows),
  };

  const trend = [...rows].reverse().map((row) => ({
    date: row.date,
    moodLabel: row.mood_label,
    moodScore: Number(Number(row.mood_score).toFixed(2)),
    isEnded: Boolean(row.is_ended),
    userMessageCount: Number(row.user_message_count),
  }));

  res.json({
    user: mapUser(user),
    summary,
    moodBreakdown,
    trend,
    recentConversations: rows.map(mapConversation),
    insights: buildInsights(summary, moodBreakdown),
  });
});

// ─── NEW: Graph endpoints ─────────────────────────────────────────────────────

// GET /api/graph/:userId — return all graph nodes and edges
app.get('/api/graph/:userId', (req, res) => {
  const userId = safeUserId(req.params.userId);
  ensureUser(userId);

  const events = getGraphEvents(userId);
  const nodes = buildGraphNodes(events);
  const edges = buildGraphEdges(events);

  res.json({ nodes, edges, eventCount: events.length });
});

// POST /api/graph/:userId/extract — extract events from a completed conversation
// and save them into the graph. Call this when "End Day" is pressed.
app.post('/api/graph/:userId/extract', async (req, res) => {
  const userId = safeUserId(req.params.userId);
  const date = normalizeDate(req.body?.date);

  ensureUser(userId);
  const conversation = getConversation(userId, date);
  if (!conversation) {
    res.status(404).json({ error: 'No conversation found for this date.' });
    return;
  }

  const allMessages = getMessages(conversation.id);
  if (allMessages.length < 2) {
    res.json({ extracted: 0, message: 'Not enough messages to extract events.' });
    return;
  }

  try {
    const events = await extractEventsFromConversation(allMessages, userId, date);
    res.json({ extracted: events.length, events });
  } catch (err) {
    console.error('Event extraction failed:', err.message);
    res.status(500).json({ error: 'Event extraction failed: ' + err.message });
  }
});

// DELETE /api/graph/:userId/event/:eventId — remove a specific event node
app.delete('/api/graph/:userId/event/:eventId', (req, res) => {
  const userId = safeUserId(req.params.userId);
  const eventId = Number(req.params.eventId);

  const row = db.prepare('SELECT * FROM graph_events WHERE id = ? AND user_id = ?').get(eventId, userId);
  if (!row) {
    res.status(404).json({ error: 'Event not found.' });
    return;
  }

  db.prepare('DELETE FROM graph_events WHERE id = ?').run(eventId);
  res.json({ deleted: true, id: eventId });
});

// ─── ERROR HANDLER ────────────────────────────────────────────────────────────
app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(PORT, () => {
  console.log(`AI diary server running on http://localhost:${PORT}`);
  if (!OPENAI_API_KEY) {
    console.warn('⚠  OPENAI_API_KEY is not set. AI replies will use fallback templates.');
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// OPENAI HELPERS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Low-level: call the OpenAI chat completions endpoint.
 * Uses Node's built-in https so no extra dependency needed.
 */
function callOpenAI(messages, temperature = 0.7, maxTokens = 600) {
  console.log('🔵 Calling OpenAI API...');  // ADD THIS
  return new Promise((resolve, reject) => {
    if (!OPENAI_API_KEY) {
      reject(new Error('OPENAI_API_KEY not set'));
      return;
    }

    const body = JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      temperature,
      max_tokens: maxTokens,
    });

    const options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (response) => {
      console.log('📡 OpenAI response status:', response.statusCode);  // ADD THIS
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        console.log('📦 OpenAI raw response:', data.substring(0, 200));  // ADD THIS
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            console.error('❌ OpenAI returned error:', parsed.error);  // ADD THIS
            reject(new Error(parsed.error.message));
            return;
          }
          resolve(parsed.choices[0].message.content.trim());
        } catch (e) {
          console.error('❌ Failed to parse OpenAI response:', e);  // ADD THIS
          reject(new Error('Failed to parse OpenAI response'));
        }
      });
    });

    req.on('error', (err) => {
      console.error('❌ HTTPS request failed:', err);  // ADD THIS
      reject(err);
    });
    req.write(body);
    req.end();
  });
}

/**
 * Build the AI assistant reply using conversation history + graph context.
 */
async function buildAssistantReplyAI({ userName, userText, moodLabel, userMessageCount, allMessages, graphEvents }) {
  console.log('🔧 Inside buildAssistantReplyAI, userText:', userText);
  const text = userText.toLowerCase();
  const userWantsToEnd = /\b(bye|good night|end|wrap up|done for today|stop)\b/.test(text);

  if (userWantsToEnd) {
    return {
      reply: `No problem. I can close today's chat now. Click "End today's conversation" when you are ready.`,
      promptToEnd: true,
    };
  }

  // Build graph context string (most recent / highest importance first)
  const graphContext = graphEvents.length > 0
    ? graphEvents
        .sort((a, b) => b.importance - a.importance)
        .slice(0, 15)
        .map(e => `- [${e.domains}] ${e.summary} (${e.emotional_tone}, importance ${e.importance}/5, ${e.event_date})`)
        .join('\n')
    : 'No past events recorded yet.';

  // Build conversation history for OpenAI (exclude the very first seed prompt if empty)
  const history = allMessages
    .slice(-12) // last 12 messages for context window efficiency
    .map(m => ({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.content }));

  const systemPrompt = `You are a warm, empathetic AI diary companion named Lifemap. You help ${userName} reflect on their day.

Your personality:
- Caring and non-judgmental
- Ask one focused follow-up question per reply
- Keep replies to 2–3 sentences max
- Reference past life events naturally when relevant (don't force it)
- If mood is tough/low, be extra gentle

Current mood detected: ${moodLabel}

${userName}'s past life events (from their personal graph):
${graphContext}

If the user has sent ${userMessageCount} or more messages and seems to be wrapping up, you can gently offer to end the session. Always suggest ending if they've sent 6+ messages.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
  ];

  const reply = await callOpenAI(messages, 0.75, 300);
  const promptToEnd = userMessageCount >= 5;

  return { reply, promptToEnd };
}

/**
 * Extract structured life events from a conversation using OpenAI,
 * then persist them to the graph_events table.
 */
async function extractEventsFromConversation(allMessages, userId, date) {
  const conversation = allMessages
    .map(m => `${m.sender.toUpperCase()}: ${m.content}`)
    .join('\n');

  const systemPrompt = `You are a life event extractor for a personal diary app.
Analyze the conversation and extract ALL distinct life events the user mentioned.
Return ONLY a valid JSON array with no extra text, markdown, or code fences.

Each item must have exactly these fields:
{
  "summary": "one sentence describing the event",
  "domains": ["one or more of: Work Life, Academic Life, Personal Life, Friends, Dating, Health, Family"],
  "emotional_tone": "one of: positive, negative, neutral, stressed, anxious, happy, sad, grateful, excited",
  "importance": <integer 1–5>,
  "keywords": ["keyword1", "keyword2"]
}`;

  const raw = await callOpenAI(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Extract events from this diary conversation:\n\n${conversation}` },
    ],
    0.0,
    800
  );

  // Parse JSON — strip any accidental markdown fences
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']') + 1;
  if (start === -1 || end === 0) return [];

  const events = JSON.parse(raw.slice(start, end));
  const saved = [];

  for (const ev of events) {
    // Validate and sanitize domains
    const domains = (ev.domains || [])
      .filter(d => ALLOWED_DOMAINS.includes(d));
    if (domains.length === 0) domains.push('Personal Life');

    const row = db.prepare(
      `INSERT INTO graph_events
        (user_id, event_date, summary, domains, emotional_tone, importance, keywords, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      date,
      String(ev.summary || '').slice(0, 500),
      JSON.stringify(domains),
      String(ev.emotional_tone || 'neutral'),
      Math.min(5, Math.max(1, Number(ev.importance) || 3)),
      JSON.stringify(ev.keywords || []),
      nowIso()
    );

    saved.push({ id: row.lastInsertRowid, ...ev, domains, event_date: date });
  }

  return saved;
}

// ═════════════════════════════════════════════════════════════════════════════
// GRAPH HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function getGraphEvents(userId) {
  const rows = db
    .prepare('SELECT * FROM graph_events WHERE user_id = ? ORDER BY created_at ASC')
    .all(userId);

  return rows.map(r => ({
    ...r,
    domains: safeJsonParse(r.domains, ['Personal Life']),
    keywords: safeJsonParse(r.keywords, []),
  }));
}

/**
 * Build node list for the graph:
 * - 7 fixed domain hub nodes
 * - one event node per graph_event row
 */
function buildGraphNodes(events) {
  const domainMeta = {
    'Work Life':      { color: '#E8A838', icon: '💼' },
    'Academic Life':  { color: '#4A90D9', icon: '📚' },
    'Personal Life':  { color: '#9B59B6', icon: '🌸' },
    'Friends':        { color: '#2ECC71', icon: '🤝' },
    'Dating':         { color: '#E74C3C', icon: '💕' },
    'Health':         { color: '#1ABC9C', icon: '🏃' },
    'Family':         { color: '#F39C12', icon: '🏡' },
  };

  const domainNodes = ALLOWED_DOMAINS.map(d => ({
    id: `domain:${d}`,
    type: 'domain',
    label: d,
    color: domainMeta[d]?.color || '#888',
    icon: domainMeta[d]?.icon || '●',
  }));

  const eventNodes = events.map(ev => ({
    id: `event:${ev.id}`,
    type: 'event',
    dbId: ev.id,
    summary: ev.summary,
    domains: ev.domains,
    emotional_tone: ev.emotional_tone,
    importance: ev.importance,
    keywords: ev.keywords,
    event_date: ev.event_date,
    createdAt: ev.created_at,
  }));

  return [...domainNodes, ...eventNodes];
}

/**
 * Build edge list:
 * - event → domain (BELONGS_TO) for each domain the event is tagged with
 * - event → previous event in same domain (FOLLOWS) for temporal chain
 */
function buildGraphEdges(events) {
  const edges = [];
  const lastEventPerDomain = {};

  for (const ev of events) {
    for (const domain of ev.domains) {
      // BELONGS_TO edge
      edges.push({
        source: `event:${ev.id}`,
        target: `domain:${domain}`,
        type: 'BELONGS_TO',
      });

      // FOLLOWS edge (temporal continuity within same domain)
      if (lastEventPerDomain[domain] !== undefined) {
        edges.push({
          source: `event:${ev.id}`,
          target: `event:${lastEventPerDomain[domain]}`,
          type: 'FOLLOWS',
        });
      }
      lastEventPerDomain[domain] = ev.id;
    }
  }

  return edges;
}

// ═════════════════════════════════════════════════════════════════════════════
// DATABASE SCHEMA
// ═════════════════════════════════════════════════════════════════════════════

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      check_in_time TEXT NOT NULL DEFAULT '${DEFAULT_CHECK_IN_TIME}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      mood_label TEXT NOT NULL DEFAULT 'neutral',
      mood_score REAL NOT NULL DEFAULT 0,
      is_ended INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, date),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      sender TEXT NOT NULL CHECK(sender IN ('assistant', 'user')),
      content TEXT NOT NULL,
      mood_label TEXT,
      mood_score REAL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS graph_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      event_date TEXT NOT NULL,
      summary TEXT NOT NULL,
      domains TEXT NOT NULL DEFAULT '["Personal Life"]',
      emotional_tone TEXT NOT NULL DEFAULT 'neutral',
      importance INTEGER NOT NULL DEFAULT 3,
      keywords TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_user_date ON conversations(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_graph_events_user ON graph_events(user_id, event_date);
  `);
}

// ═════════════════════════════════════════════════════════════════════════════
// ORIGINAL HELPER FUNCTIONS (unchanged from your friend's code)
// ═════════════════════════════════════════════════════════════════════════════

function nowIso() { return dayjs().toISOString(); }
function todayDate() { return dayjs().format('YYYY-MM-DD'); }

function safeUserId(value) {
  const userId = String(value || '').trim();
  return userId ? userId.slice(0, 64) : 'default-user';
}

function normalizeName(value) {
  const name = String(value || '').trim();
  return name ? name.slice(0, 40) : DEFAULT_NAME;
}

function normalizeCheckInTime(value) {
  const candidate = String(value || '').trim();
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(candidate) ? candidate : DEFAULT_CHECK_IN_TIME;
}

function normalizeDate(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return todayDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return todayDate();
  const parsed = dayjs(candidate);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : todayDate();
}

function clampDays(value) {
  const raw = Number(value);
  if (Number.isNaN(raw)) return 30;
  return Math.max(7, Math.min(120, Math.trunc(raw)));
}

function getUser(userId) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

function ensureUser(userId) {
  const existing = getUser(userId);
  if (existing) return existing;
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO users (id, name, check_in_time, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
  ).run(userId, DEFAULT_NAME, DEFAULT_CHECK_IN_TIME, timestamp, timestamp);
  return getUser(userId);
}

function ensureConversation(userId, date) {
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO conversations (user_id, date, mood_label, mood_score, is_ended, started_at, created_at, updated_at)
      VALUES (?, ?, 'neutral', 0, 0, ?, ?, ?)
      ON CONFLICT(user_id, date) DO NOTHING`
  ).run(userId, date, timestamp, timestamp, timestamp);
}

function getConversation(userId, date) {
  return db.prepare(
    `SELECT c.*,
        COALESCE(SUM(CASE WHEN m.sender = 'user' THEN 1 ELSE 0 END), 0) AS user_message_count,
        COALESCE(SUM(CASE WHEN m.sender = 'assistant' THEN 1 ELSE 0 END), 0) AS assistant_message_count
      FROM conversations c
      LEFT JOIN messages m ON m.conversation_id = c.id
      WHERE c.user_id = ? AND c.date = ?
      GROUP BY c.id`
  ).get(userId, date);
}

function getMessages(conversationId) {
  return db.prepare(
    `SELECT id, conversation_id, sender, content, mood_label, mood_score, created_at
      FROM messages WHERE conversation_id = ? ORDER BY id ASC`
  ).all(conversationId);
}

function insertMessage(conversationId, sender, content, mood) {
  db.prepare(
    `INSERT INTO messages (conversation_id, sender, content, mood_label, mood_score, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`
  ).run(conversationId, sender, content, mood?.label || null, mood?.score ?? null, nowIso());
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(nowIso(), conversationId);
}

function maybeSeedCheckInPrompt(user, conversation, date, forcePrompt) {
  const totalMessages =
    Number(conversation.user_message_count) + Number(conversation.assistant_message_count);
  if (totalMessages > 0 || conversation.is_ended) return;

  const shouldPrompt = forcePrompt || (date === todayDate() && hasReachedCheckInTime(user.check_in_time));
  if (!shouldPrompt) return;

  insertMessage(conversation.id, 'assistant', `Hi ${user.name}, how was your day?`, null);
}

function hasReachedCheckInTime(checkInTime) {
  const [hour, minute] = checkInTime.split(':').map(Number);
  const now = dayjs();
  return now.hour() * 60 + now.minute() >= hour * 60 + minute;
}

function analyzeMood(text) {
  const lowerText = text.toLowerCase();
  const words = lowerText.split(/[^a-z]+/).filter(Boolean);
  let score = 0;
  for (const word of words) {
    if (POSITIVE_WORDS.has(word)) score += 1;
    if (NEGATIVE_WORDS.has(word)) score -= 1;
  }
  if (/not good|rough day|bad day|too much|so tired|burned out|burnt out/.test(lowerText)) score -= 1;
  if (/really good|great day|feeling better|pretty happy|very productive/.test(lowerText)) score += 1;
  score = Math.max(-2, Math.min(2, score));
  return { score, label: moodLabelFromScore(score) };
}

function moodLabelFromScore(score) {
  if (score >= 1.5) return 'great';
  if (score >= 0.5) return 'good';
  if (score <= -1.5) return 'tough';
  if (score <= -0.5) return 'low';
  return 'neutral';
}

function updateConversationMood(conversationId) {
  const aggregate = db.prepare(
    `SELECT AVG(mood_score) AS average_score, COUNT(*) AS entries
      FROM messages WHERE conversation_id = ? AND sender = 'user' AND mood_score IS NOT NULL`
  ).get(conversationId);

  const averageScore = aggregate.entries ? Number(aggregate.average_score) : 0;
  db.prepare(
    `UPDATE conversations SET mood_score = ?, mood_label = ?, updated_at = ? WHERE id = ?`
  ).run(averageScore, moodLabelFromScore(averageScore), nowIso(), conversationId);
}

// Fallback template reply (used when OpenAI is unavailable)
function buildAssistantReplyTemplate({ userName, userText, moodLabel, userMessageCount }) {
  const text = userText.toLowerCase();
  const userWantsToEnd = /\b(bye|good night|end|wrap up|done for today|stop)\b/.test(text);

  let reply = '';
  if (moodLabel === 'tough') {
    reply = pick([
      `That sounds really heavy, ${userName}. Thanks for sharing it with me. What felt hardest today?`,
      `I hear you, ${userName}. Tough days can drain you fast. Want to unpack one part of it together?`,
    ]);
  } else if (moodLabel === 'low') {
    reply = pick([
      `Thanks for telling me, ${userName}. What was one moment that pulled your energy down today?`,
      `Got it. Even a low day is worth checking in on. What happened that stood out the most?`,
    ]);
  } else if (moodLabel === 'great') {
    reply = pick([
      `Love that energy, ${userName}. What was the best moment of your day?`,
      `That is awesome to hear. What do you want to carry into tomorrow from today?`,
    ]);
  } else if (moodLabel === 'good') {
    reply = pick([
      `Nice. Sounds like a solid day, ${userName}. What made it go well?`,
      `Good to hear. Want to lock in one small win from today?`,
    ]);
  } else {
    reply = pick([
      `Thanks for checking in, ${userName}. What was the most memorable part of your day?`,
      `I am here with you. What happened today that you want to reflect on?`,
    ]);
  }

  if (userWantsToEnd) {
    return { reply: `No problem. I can close today's chat now. Click "End today's conversation" when you are ready.`, promptToEnd: true };
  }

  if (userMessageCount >= 4) {
    return { reply: `${reply} If you are ready, I can also help you wrap up this conversation for today.`, promptToEnd: true };
  }

  return { reply, promptToEnd: false };
}

function buildInsights(summary, moodBreakdown) {
  if (summary.totalTrackedDays === 0) {
    return ['No logs yet. Start your first daily check-in to populate the dashboard.'];
  }

  const insights = [];

  if (summary.averageMoodScore <= -0.5) {
    insights.push('Recent mood trend is below neutral. Consider shorter daily check-ins with recovery goals.');
  } else if (summary.averageMoodScore >= 0.5) {
    insights.push('Recent mood trend is positive. Keep repeating routines linked to better days.');
  } else {
    insights.push('Mood trend is stable. Adding detail in messages can improve pattern detection.');
  }

  if (summary.completionRate < 60) {
    insights.push('Many conversations stay open. Ending each day gives cleaner mood analytics.');
  } else {
    insights.push('Conversation completion is strong. Your data quality for trends is improving.');
  }

  if (moodBreakdown.tough >= 3) {
    insights.push('Multiple tough days were detected. It may help to set smaller next-day goals.');
  }

  if (summary.streakDays >= 3) {
    insights.push(`You are on a ${summary.streakDays}-day check-in streak.`);
  }

  return insights.slice(0, 3);
}

function computeRecentStreak(rows) {
  if (!rows.length) return 0;
  let streak = 1;
  let prevDate = dayjs(rows[0].date);
  for (let i = 1; i < rows.length; i++) {
    const curr = dayjs(rows[i].date);
    if (prevDate.diff(curr, 'day') === 1) { streak++; prevDate = curr; }
    else break;
  }
  return streak;
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function safeJsonParse(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function mapUser(row) {
  return { id: row.id, name: row.name, checkInTime: row.check_in_time, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapConversation(row) {
  return {
    id: row.id, userId: row.user_id, date: row.date,
    moodLabel: row.mood_label, moodScore: Number(Number(row.mood_score || 0).toFixed(2)),
    isEnded: Boolean(row.is_ended), startedAt: row.started_at, endedAt: row.ended_at,
    updatedAt: row.updated_at,
    userMessageCount: Number(row.user_message_count || 0),
    assistantMessageCount: Number(row.assistant_message_count || 0),
  };
}

function mapMessage(row) {
  return {
    id: row.id, conversationId: row.conversation_id, sender: row.sender,
    content: row.content, moodLabel: row.mood_label, moodScore: row.mood_score, createdAt: row.created_at,
  };
}