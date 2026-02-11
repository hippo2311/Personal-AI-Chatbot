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
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = 'gpt-4o-mini'; // Change to 'gpt-4o' for better extraction
console.log('🔑 OpenAI key loaded:', OPENAI_API_KEY ? `${OPENAI_API_KEY.slice(0, 10)}...` : 'NOT FOUND');

// ─── MOOD WORDS (kept for fast local fallback) ──────────────────────────────
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

// ─── IN-MEMORY SESSION STORAGE ───────────────────────────────────────────────
const activeSessions = new Map();

function getSessionKey(userId, date) {
  return `${userId}:${date}`;
}

function getOrCreateActiveSession(userId, date) {
  const key = getSessionKey(userId, date);
  if (!activeSessions.has(key)) {
    activeSessions.set(key, {
      messages: [],
      startedAt: nowIso(),
    });
  }
  return activeSessions.get(key);
}

function addMessageToSession(userId, date, sender, content, moodLabel = null, moodScore = null) {
  const session = getOrCreateActiveSession(userId, date);
  session.messages.push({
    id: randomId(),
    sender,
    content,
    moodLabel,
    moodScore,
    createdAt: nowIso(),
  });
  return session.messages;
}

function getSessionMessages(userId, date) {
  const key = getSessionKey(userId, date);
  const session = activeSessions.get(key);
  return session ? session.messages : [];
}

function clearSession(userId, date) {
  const key = getSessionKey(userId, date);
  const messages = getSessionMessages(userId, date);
  activeSessions.delete(key);
  console.log(`🗑️ Cleared session for ${key} (${messages.length} messages)`);
  return messages;
}

function randomId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

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

// ─── ROUTES ──────────────────────────────────────────────────────────────────

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

  // Send initial prompt if needed
  if (!conversation.is_ended && forcePrompt) {
    const sessionMessages = getSessionMessages(userId, date);
    if (sessionMessages.length === 0) {
      addMessageToSession(
        userId,
        date,
        'assistant',
        `Hi ${user.name}, how was your day?`,
        null,
        null
      );
    }
  }

  conversation = getConversation(userId, date);
  const messages = getSessionMessages(userId, date);

  res.json({
    user: mapUser(user),
    conversation: mapConversation(conversation),
    messages: messages.map(m => ({
      id: m.id,
      conversationId: conversation.id,
      sender: m.sender,
      content: m.content,
      moodLabel: m.moodLabel,
      moodScore: m.moodScore,
      createdAt: m.createdAt,
    })),
  });
});

app.post('/api/chat/:userId/message', async (req, res) => {
  console.log('📨 Received message from user');
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

  // Analyze mood
  const mood = analyzeMood(text);

  // Add user message to in-memory session
  addMessageToSession(userId, date, 'user', text, mood.label, mood.score);

  const sessionMessages = getSessionMessages(userId, date);
  console.log(`📝 Session has ${sessionMessages.length} messages`);

  // Load knowledge graph context
  const kgContext = getRelevantKnowledgeContext(userId, text);

  let assistantReply;
  try {
    assistantReply = await buildAssistantReplyAI({
      userName: user.name,
      userText: text,
      moodLabel: mood.label,
      userMessageCount: sessionMessages.filter(m => m.sender === 'user').length,
      allMessages: sessionMessages,
      knowledgeContext: kgContext,
    });
  } catch (err) {
    console.error('❌ OpenAI error, falling back to template reply:', err.message);

    assistantReply = buildAssistantReplyTemplate({
      userName: user.name,
      userText: text,
      moodLabel: mood.label,
      userMessageCount: sessionMessages.filter(m => m.sender === 'user').length,
    });
  }

  // Add assistant reply to in-memory session
  addMessageToSession(userId, date, 'assistant', assistantReply.reply, null, null);

  const finalConversation = getConversation(userId, date);
  const finalMessages = getSessionMessages(userId, date);

  res.json({
    conversation: mapConversation(finalConversation),
    messages: finalMessages.map(m => ({
      id: m.id,
      conversationId: conversation.id,
      sender: m.sender,
      content: m.content,
      moodLabel: m.moodLabel,
      moodScore: m.moodScore,
      createdAt: m.createdAt,
    })),
    promptToEnd: assistantReply.promptToEnd,
  });
});

app.post('/api/chat/:userId/end-day', async (req, res) => {
  const userId = safeUserId(req.params.userId);
  const date = normalizeDate(req.body?.date);

  const user = ensureUser(userId);
  ensureConversation(userId, date);

  const conversation = getConversation(userId, date);

  if (!conversation.is_ended) {
    console.log(`🔚 Ending conversation for ${userId} on ${date}`);

    // Mark conversation as ended
    db.prepare(
      `UPDATE conversations
        SET is_ended = 1,
            ended_at = ?,
            updated_at = ?
        WHERE id = ?`
    ).run(nowIso(), nowIso(), conversation.id);

    // Extract knowledge graph from session
    const sessionMessages = getSessionMessages(userId, date);
    console.log(`📊 Found ${sessionMessages.length} messages in session`);

    if (sessionMessages.length >= 2) {
      try {
        console.log('🚀 Starting knowledge graph extraction...');
        await extractKnowledgeGraphFromConversation(sessionMessages, userId, date);
        console.log(`✅ Knowledge graph extracted`);
      } catch (err) {
        console.error('❌ Failed to extract:', err.message);
        console.error('Full error:', err);
      }
    } else {
      console.log('⚠️ Not enough messages in session (need at least 2)');
    }

    // Clear session
    clearSession(userId, date);

    const goodbyeMessage = {
      id: randomId(),
      sender: 'assistant',
      content: `Nice work checking in today, ${user.name}. I will ask again at ${user.check_in_time} tomorrow.`,
      moodLabel: null,
      moodScore: null,
      createdAt: nowIso(),
    };

    res.json({
      conversation: mapConversation(getConversation(userId, date)),
      messages: [goodbyeMessage],
    });
  } else {
    res.json({
      conversation: mapConversation(conversation),
      messages: [],
    });
  }
});

app.get('/api/dashboard/:userId', (req, res) => {
  const userId = safeUserId(req.params.userId);
  const days = clampDays(req.query.days);

  const user = ensureUser(userId);
  const rows = db
    .prepare(
      `SELECT * FROM conversations
        WHERE user_id = ?
        ORDER BY date DESC
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
  const averageMoodScore = totalTrackedDays ? Number((totalMoodScore / totalTrackedDays).toFixed(2)) : 0;

  const summary = {
    totalTrackedDays,
    averageMoodScore,
    averageMoodLabel: moodLabelFromScore(averageMoodScore),
    completionRate: totalTrackedDays ? Number(((endedCount / totalTrackedDays) * 100).toFixed(1)) : 0,
    checkInsLast7Days: rows.filter((row) => dayjs().startOf('day').diff(dayjs(row.date), 'day') <= 6).length,
    streakDays: computeRecentStreak(rows),
  };

  const trend = [...rows].reverse().map((row) => ({
    date: row.date,
    moodLabel: row.mood_label,
    moodScore: Number(row.mood_score.toFixed(2)),
    isEnded: Boolean(row.is_ended),
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

// ─── KNOWLEDGE GRAPH ENDPOINTS ───────────────────────────────────────────────

app.get('/api/graph/:userId', (req, res) => {
  const userId = safeUserId(req.params.userId);
  ensureUser(userId);

  const events = getKnowledgeGraphEvents(userId);
  const entities = getKnowledgeGraphEntities(userId);
  const relationships = getKnowledgeGraphRelationships(userId);
  
  const nodes = buildGraphNodes(events, entities);
  const edges = buildGraphEdges(events, relationships);

  console.log(`📊 Graph data: ${nodes.length} nodes, ${edges.length} edges`);

  res.json({ 
    nodes, 
    edges, 
    eventCount: events.length,
    entityCount: entities.length,
  });
});

app.delete('/api/graph/:userId/event/:eventId', (req, res) => {
  const userId = safeUserId(req.params.userId);
  const eventId = Number(req.params.eventId);

  const row = db.prepare('SELECT * FROM kg_events WHERE id = ? AND user_id = ?').get(eventId, userId);
  if (!row) {
    res.status(404).json({ error: 'Event not found.' });
    return;
  }

  db.prepare('DELETE FROM kg_events WHERE id = ?').run(eventId);
  db.prepare('DELETE FROM kg_relationships WHERE from_id = ? OR to_id = ?').run(`event:${eventId}`, `event:${eventId}`);
  
  res.json({ deleted: true, id: eventId });
});

app.delete('/api/graph/:userId/clear', (req, res) => {
  const userId = safeUserId(req.params.userId);
  ensureUser(userId);

  const eventResult = db.prepare('DELETE FROM kg_events WHERE user_id = ?').run(userId);
  const entityResult = db.prepare('DELETE FROM kg_entities WHERE user_id = ?').run(userId);
  const relResult = db.prepare('DELETE FROM kg_relationships WHERE user_id = ?').run(userId);

  res.json({
    deleted: eventResult.changes + entityResult.changes + relResult.changes,
    message: `Cleared knowledge graph.`,
  });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(PORT, () => {
  console.log(`AI diary server running on http://localhost:${PORT}`);
  if (!OPENAI_API_KEY) console.warn('⚠  OPENAI_API_KEY not set.');
});

// ═════════════════════════════════════════════════════════════════════════════
// OPENAI & KNOWLEDGE GRAPH
// ═════════════════════════════════════════════════════════════════════════════

function callOpenAI(messages, temperature = 0.7, maxTokens = 600) {
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
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(parsed.error.message));
            return;
          }
          resolve(parsed.choices[0].message.content.trim());
        } catch (e) {
          reject(new Error('Failed to parse OpenAI response'));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.write(body);
    req.end();
  });
}

async function buildAssistantReplyAI({ userName, userText, moodLabel, userMessageCount, allMessages, knowledgeContext }) {
  const text = userText.toLowerCase();
  if (/\b(bye|good night|end|wrap up|done|stop)\b/.test(text)) {
    return {
      reply: `No problem. Click "End today's conversation" when ready.`,
      promptToEnd: true,
    };
  }

  const history = allMessages.slice(-12).map(m => ({
    role: m.sender === 'user' ? 'user' : 'assistant',
    content: m.content
  }));

  const systemPrompt = `You are Lifemap, a warm AI diary companion for ${userName}.

Personality: caring, non-judgmental, ask one focused question per reply, keep to 2-3 sentences.
Current mood: ${moodLabel}

${userName}'s memories:
${knowledgeContext || 'No past memories yet.'}

Suggest ending if ${userMessageCount} >= 6 messages.`;

  const reply = await callOpenAI([
    { role: 'system', content: systemPrompt },
    ...history,
  ], 0.75, 300);

  return { reply, promptToEnd: userMessageCount >= 5 };
}

async function extractKnowledgeGraphFromConversation(sessionMessages, userId, date) {
  const conversation = sessionMessages.map(m => `${m.sender.toUpperCase()}: ${m.content}`).join('\n');

  const systemPrompt = `You are a knowledge graph extractor for a personal diary app.

CRITICAL: Extract ALL distinct events, entities, and relationships from this conversation.
Do NOT summarize or combine events - extract each one separately.

Return ONLY valid JSON (no markdown, no code fences, no preamble):
{
  "entities": [
    {"id": "e1", "type": "place|person|food|activity|preference|object|organization", "name": "entity name", "attributes": {"key": "value"}},
    {"id": "e2", "type": "...", "name": "...", "attributes": {}}
  ],
  "events": [
    {"id": "ev1", "summary": "one sentence describing what happened", "event_type": "travel|dining|meeting|accomplishment|experience|social|health|work|study", "domains": ["Personal Life"], "emotional_tone": "happy|excited|neutral|stressed|anxious|sad|grateful|proud", "importance": 3, "related_entities": ["e1", "e2"], "keywords": ["keyword1", "keyword2"]},
    {"id": "ev2", "summary": "...", "event_type": "...", "domains": ["Work Life"], "emotional_tone": "...", "importance": 4, "related_entities": ["e3"], "keywords": ["..."]}
  ],
  "relationships": [
    {"from_id": "ev1", "to_id": "e1", "relationship_type": "visited|ate|met|accomplished|experienced|enjoyed|located_in|part_of|prefers", "strength": 5},
    {"from_id": "ev2", "to_id": "ev1", "relationship_type": "followed_by|caused_by|related_to", "strength": 3}
  ]
}

EXAMPLES:

Input: "I went to Chongqing and loved the xiaomian! Then I visited the Hongya Cave."
Output:
{
  "entities": [
    {"id": "e1", "type": "place", "name": "Chongqing", "attributes": {"country": "China"}},
    {"id": "e2", "type": "food", "name": "Chongqing xiaomian", "attributes": {"cuisine": "Sichuanese"}},
    {"id": "e3", "type": "place", "name": "Hongya Cave", "attributes": {"type": "tourist attraction"}},
    {"id": "e4", "type": "preference", "name": "spicy food", "attributes": {}}
  ],
  "events": [
    {"id": "ev1", "summary": "User traveled to Chongqing", "event_type": "travel", "domains": ["Personal Life"], "emotional_tone": "excited", "importance": 4, "related_entities": ["e1"], "keywords": ["travel", "China"]},
    {"id": "ev2", "summary": "User ate Chongqing xiaomian", "event_type": "dining", "domains": ["Personal Life"], "emotional_tone": "happy", "importance": 3, "related_entities": ["e2", "e1"], "keywords": ["food", "xiaomian"]},
    {"id": "ev3", "summary": "User visited Hongya Cave", "event_type": "experience", "domains": ["Personal Life"], "emotional_tone": "excited", "importance": 3, "related_entities": ["e3", "e1"], "keywords": ["tourism", "sightseeing"]}
  ],
  "relationships": [
    {"from_id": "ev1", "to_id": "e1", "relationship_type": "visited", "strength": 5},
    {"from_id": "ev2", "to_id": "e2", "relationship_type": "ate", "strength": 5},
    {"from_id": "ev2", "to_id": "ev1", "relationship_type": "part_of", "strength": 5},
    {"from_id": "ev3", "to_id": "e3", "relationship_type": "visited", "strength": 5},
    {"from_id": "ev3", "to_id": "ev1", "relationship_type": "part_of", "strength": 5},
    {"from_id": "e2", "to_id": "e1", "relationship_type": "located_in", "strength": 5},
    {"from_id": "e3", "to_id": "e1", "relationship_type": "located_in", "strength": 5},
    {"from_id": "user", "to_id": "e4", "relationship_type": "prefers", "strength": 4},
    {"from_id": "e2", "to_id": "e4", "relationship_type": "is_type_of", "strength": 5}
  ]
}

REMEMBER:
- Extract EVERY distinct event separately (don't combine "went to X and did Y" into one event - make it two!)
- Include all entities mentioned (places, people, foods, activities, preferences)
- Create relationships between events (temporal, causal, part-of)
- Create relationships between entities and events
- Be thorough - missing events means losing memories!`;

  console.log('🤖 Calling OpenAI for knowledge graph extraction...');
  console.log('📝 Conversation length:', conversation.length, 'characters');

  const raw = await callOpenAI([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Extract knowledge graph from this diary conversation:\n\n${conversation}` },
  ], 0.1, 3000);

  console.log('📦 Raw OpenAI response:', raw.substring(0, 300));

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}') + 1;
  if (start === -1) {
    console.log('⚠️ No JSON found in response');
    return { entities: [], events: [], relationships: [] };
  }

  const graph = JSON.parse(raw.slice(start, end));
  
  console.log(`🎯 Extracted: ${graph.entities?.length || 0} entities, ${graph.events?.length || 0} events, ${graph.relationships?.length || 0} relationships`);
  
  await saveKnowledgeGraph(graph, userId, date);
  return graph;
}

async function saveKnowledgeGraph(graph, userId, date) {
  const { entities = [], events = [], relationships = [] } = graph;

  console.log(`💾 Saving ${entities.length} entities, ${events.length} events, ${relationships.length} relationships`);

  // Map AI IDs to database IDs
  const entityIdMap = {};
  const eventIdMap = {};

  // Save entities
  for (const entity of entities) {
    const result = db.prepare(
      `INSERT OR REPLACE INTO kg_entities (user_id, entity_id, entity_type, name, attributes, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      entity.id,
      entity.type,
      entity.name,
      JSON.stringify(entity.attributes || {}),
      nowIso()
    );
    entityIdMap[entity.id] = `entity:${result.lastInsertRowid}`;
    console.log(`  💾 Entity saved: ${entity.name} (DB ID: ${result.lastInsertRowid})`);
  }

  // Save events - using auto-increment, no unique constraint on event_id
  for (const event of events) {
    const result = db.prepare(
      `INSERT INTO kg_events (user_id, event_date, summary, event_type, domains, emotional_tone, importance, related_entities, keywords, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      date,
      event.summary,
      event.event_type || 'general',
      JSON.stringify(event.domains || ['Personal Life']),
      event.emotional_tone || 'neutral',
      event.importance || 3,
      JSON.stringify(event.related_entities || []),
      JSON.stringify(event.keywords || []),
      nowIso()
    );
    eventIdMap[event.id] = `event:${result.lastInsertRowid}`;
    console.log(`  💾 Event saved: ${event.summary.substring(0, 50)}... (DB ID: ${result.lastInsertRowid})`);
  }

  // Save relationships - map AI IDs to DB IDs
  for (const rel of relationships) {
    const fromId = eventIdMap[rel.from_id] || entityIdMap[rel.from_id] || rel.from_id;
    const toId = eventIdMap[rel.to_id] || entityIdMap[rel.to_id] || rel.to_id;

    db.prepare(
      `INSERT INTO kg_relationships (user_id, from_id, to_id, relationship_type, strength, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(userId, fromId, toId, rel.relationship_type, rel.strength || 3, nowIso());
    
    console.log(`  💾 Relationship: ${fromId} --[${rel.relationship_type}]--> ${toId}`);
  }

  console.log(`✅ Saved ${entities.length} entities, ${events.length} events, ${relationships.length} relationships`);
}

function getRelevantKnowledgeContext(userId, query) {
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (!keywords.length) return '';

  const placeholders = keywords.map(() => 'LOWER(name) LIKE ?').join(' OR ');
  const entities = db.prepare(
    `SELECT * FROM kg_entities WHERE user_id = ? AND (${placeholders}) LIMIT 10`
  ).all(userId, ...keywords.map(k => `%${k}%`));

  if (!entities.length) return '';

  let context = '';
  for (const entity of entities) {
    const events = db.prepare(
      `SELECT * FROM kg_events WHERE user_id = ? AND related_entities LIKE ? ORDER BY event_date DESC LIMIT 3`
    ).all(userId, `%${entity.entity_id}%`);

    if (events.length) {
      context += `\n📍 ${entity.name}:\n`;
      for (const event of events) {
        context += `  - ${event.summary} (${event.event_date})\n`;
      }
    }
  }
  return context;
}

function getKnowledgeGraphEvents(userId) {
  return db.prepare('SELECT * FROM kg_events WHERE user_id = ? ORDER BY created_at ASC').all(userId).map(r => ({
    ...r,
    domains: safeJsonParse(r.domains, ['Personal Life']),
    keywords: safeJsonParse(r.keywords, []),
    related_entities: safeJsonParse(r.related_entities, []),
  }));
}

function getKnowledgeGraphEntities(userId) {
  return db.prepare('SELECT * FROM kg_entities WHERE user_id = ? ORDER BY created_at ASC').all(userId).map(r => ({
    ...r,
    attributes: safeJsonParse(r.attributes, {}),
  }));
}

function getKnowledgeGraphRelationships(userId) {
  return db.prepare('SELECT * FROM kg_relationships WHERE user_id = ? ORDER BY created_at ASC').all(userId);
}

function buildGraphNodes(events, entities) {
  const domainMeta = {
    'Work Life': { color: '#E8A838', icon: '💼' },
    'Academic Life': { color: '#4A90D9', icon: '📚' },
    'Personal Life': { color: '#9B59B6', icon: '🌸' },
    'Friends': { color: '#2ECC71', icon: '🤝' },
    'Dating': { color: '#E74C3C', icon: '💕' },
    'Health': { color: '#1ABC9C', icon: '🏃' },
    'Family': { color: '#F39C12', icon: '🏡' },
  };

  const entityTypeMeta = {
    'place': { color: '#3498db', icon: '📍' },
    'person': { color: '#e74c3c', icon: '👤' },
    'food': { color: '#f39c12', icon: '🍜' },
    'activity': { color: '#9b59b6', icon: '⚡' },
    'preference': { color: '#1abc9c', icon: '❤️' },
    'object': { color: '#95a5a6', icon: '📦' },
    'organization': { color: '#34495e', icon: '🏢' },
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

  const entityNodes = entities.map(entity => ({
    id: `entity:${entity.id}`,
    type: 'entity',
    entityType: entity.entity_type,
    name: entity.name,
    attributes: entity.attributes,
    color: entityTypeMeta[entity.entity_type]?.color || '#95a5a6',
    icon: entityTypeMeta[entity.entity_type]?.icon || '⭐',
  }));

  console.log(`📊 Built ${domainNodes.length} domain nodes, ${eventNodes.length} event nodes, ${entityNodes.length} entity nodes`);

  return [...domainNodes, ...eventNodes, ...entityNodes];
}

function buildGraphEdges(events, relationships) {
  const edges = [];
  const lastEventPerDomain = {};

  // Add edges from kg_relationships table (the connections we want!)
  for (const rel of relationships) {
    edges.push({
      source: rel.from_id,
      target: rel.to_id,
      type: rel.relationship_type.toUpperCase().replace(/_/g, ' '),
      strength: rel.strength,
    });
  }

  // Add edges from events to domains
  for (const ev of events) {
    for (const domain of ev.domains) {
      edges.push({ 
        source: `event:${ev.id}`, 
        target: `domain:${domain}`, 
        type: 'BELONGS TO' 
      });
      
      // Temporal continuity within same domain
      if (lastEventPerDomain[domain]) {
        edges.push({ 
          source: `event:${ev.id}`, 
          target: `event:${lastEventPerDomain[domain]}`, 
          type: 'FOLLOWS' 
        });
      }
      lastEventPerDomain[domain] = ev.id;
    }
  }

  console.log(`📊 Built ${edges.length} edges (${relationships.length} from relationships, ${edges.length - relationships.length} domain/temporal)`);

  return edges;
}

// ═════════════════════════════════════════════════════════════════════════════
// SCHEMA
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

    CREATE TABLE IF NOT EXISTS kg_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      name TEXT NOT NULL,
      attributes TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, entity_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS kg_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      event_date TEXT NOT NULL,
      summary TEXT NOT NULL,
      event_type TEXT,
      domains TEXT NOT NULL,
      emotional_tone TEXT,
      importance INTEGER,
      related_entities TEXT,
      keywords TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS kg_relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      relationship_type TEXT NOT NULL,
      strength INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_user_date ON conversations(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_kg_entities_user ON kg_entities(user_id, entity_type);
    CREATE INDEX IF NOT EXISTS idx_kg_events_user ON kg_events(user_id, event_date);
    CREATE INDEX IF NOT EXISTS idx_kg_relationships_from ON kg_relationships(user_id, from_id);
    CREATE INDEX IF NOT EXISTS idx_kg_relationships_to ON kg_relationships(user_id, to_id);
  `);
}

// ═════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═════════════════════════════════════════════════════════════════════════════

function nowIso() { return dayjs().toISOString(); }
function todayDate() { return dayjs().format('YYYY-MM-DD'); }
function safeUserId(value) { return String(value || '').trim().slice(0, 64) || 'default-user'; }
function normalizeName(value) { return String(value || '').trim().slice(0, 40) || DEFAULT_NAME; }
function normalizeCheckInTime(value) {
  const candidate = String(value || '').trim();
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(candidate) ? candidate : DEFAULT_CHECK_IN_TIME;
}
function normalizeDate(value) {
  const candidate = String(value || '').trim();
  if (!candidate || !/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return todayDate();
  const parsed = dayjs(candidate);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : todayDate();
}
function clampDays(value) {
  const raw = Number(value);
  return Number.isNaN(raw) ? 30 : Math.max(7, Math.min(120, Math.trunc(raw)));
}
function getUser(userId) { return db.prepare('SELECT * FROM users WHERE id = ?').get(userId); }
function ensureUser(userId) {
  const existing = getUser(userId);
  if (existing) return existing;
  const timestamp = nowIso();
  db.prepare(`INSERT INTO users (id, name, check_in_time, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(userId, DEFAULT_NAME, DEFAULT_CHECK_IN_TIME, timestamp, timestamp);
  return getUser(userId);
}
function ensureConversation(userId, date) {
  const timestamp = nowIso();
  db.prepare(`INSERT INTO conversations (user_id, date, mood_label, mood_score, is_ended, started_at, created_at, updated_at) VALUES (?, ?, 'neutral', 0, 0, ?, ?, ?) ON CONFLICT(user_id, date) DO NOTHING`).run(userId, date, timestamp, timestamp, timestamp);
}
function getConversation(userId, date) {
  return db.prepare(`SELECT * FROM conversations WHERE user_id = ? AND date = ?`).get(userId, date);
}
function analyzeMood(text) {
  const lowerText = text.toLowerCase();
  const words = lowerText.split(/[^a-z]+/).filter(Boolean);
  let score = 0;
  for (const word of words) {
    if (POSITIVE_WORDS.has(word)) score += 1;
    if (NEGATIVE_WORDS.has(word)) score -= 1;
  }
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
function buildAssistantReplyTemplate({ userName, userText, moodLabel, userMessageCount }) {
  const text = userText.toLowerCase();
  if (/\b(bye|good night|end|wrap up|done|stop)\b/.test(text)) {
    return { reply: `No problem. Click "End today's conversation" when ready.`, promptToEnd: true };
  }
  const replies = {
    tough: [`That sounds heavy, ${userName}. What felt hardest?`],
    low: [`Thanks for sharing, ${userName}. What pulled your energy down?`],
    great: [`Love that energy! What was the best moment?`],
    good: [`Nice. What made it go well?`],
    neutral: [`Thanks for checking in. What stood out today?`],
  };
  return { reply: pick(replies[moodLabel] || replies.neutral), promptToEnd: userMessageCount >= 4 };
}
function buildInsights(summary, moodBreakdown) {
  if (!summary.totalTrackedDays) return ['Start your first check-in.'];
  const insights = [];
  if (summary.averageMoodScore <= -0.5) insights.push('Recent mood below neutral.');
  else if (summary.averageMoodScore >= 0.5) insights.push('Recent mood positive.');
  if (summary.streakDays >= 3) insights.push(`${summary.streakDays}-day streak.`);
  return insights.slice(0, 3);
}
function computeRecentStreak(rows) {
  if (!rows.length) return 0;
  let streak = 1, prevDate = dayjs(rows[0].date);
  for (let i = 1; i < rows.length; i++) {
    const curr = dayjs(rows[i].date);
    if (prevDate.diff(curr, 'day') === 1) { streak++; prevDate = curr; }
    else break;
  }
  return streak;
}
function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
function safeJsonParse(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function mapUser(row) { return { id: row.id, name: row.name, checkInTime: row.check_in_time, createdAt: row.created_at, updatedAt: row.updated_at }; }
function mapConversation(row) {
  return {
    id: row.id, userId: row.user_id, date: row.date, moodLabel: row.mood_label,
    moodScore: Number(row.mood_score.toFixed(2)), isEnded: Boolean(row.is_ended),
    startedAt: row.started_at, endedAt: row.ended_at, updatedAt: row.updated_at,
    userMessageCount: 0, assistantMessageCount: 0,
  };
}
