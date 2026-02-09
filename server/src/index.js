const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const dayjs = require('dayjs');
const fs = require('node:fs');
const path = require('node:path');

const app = express();
const PORT = Number(process.env.PORT || 4000);
const DEFAULT_NAME = 'Friend';
const DEFAULT_CHECK_IN_TIME = '20:00';

const POSITIVE_WORDS = new Set([
  'good',
  'great',
  'happy',
  'awesome',
  'excited',
  'productive',
  'love',
  'amazing',
  'fantastic',
  'chill',
  'better',
  'calm',
  'grateful',
  'proud',
  'fun',
]);

const NEGATIVE_WORDS = new Set([
  'bad',
  'sad',
  'tired',
  'stressed',
  'anxious',
  'angry',
  'upset',
  'depressed',
  'lonely',
  'worried',
  'overwhelmed',
  'burned',
  'burnt',
  'hate',
  'awful',
  'terrible',
  'exhausted',
]);

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'chatbot.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

app.use(cors());
app.use(express.json());

initSchema();

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

app.post('/api/chat/:userId/message', (req, res) => {
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

  const mood = analyzeMood(text);
  insertMessage(conversation.id, 'user', text, mood);
  updateConversationMood(conversation.id);

  const updatedConversation = getConversation(userId, date);
  const assistantReply = buildAssistantReply({
    userName: user.name,
    userText: text,
    moodLabel: mood.label,
    userMessageCount: updatedConversation.user_message_count,
  });

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

  const moodBreakdown = {
    great: 0,
    good: 0,
    neutral: 0,
    low: 0,
    tough: 0,
  };

  let totalMoodScore = 0;
  let endedCount = 0;

  rows.forEach((row) => {
    const label = row.mood_label;
    if (moodBreakdown[label] !== undefined) {
      moodBreakdown[label] += 1;
    }
    totalMoodScore += Number(row.mood_score || 0);
    if (row.is_ended) {
      endedCount += 1;
    }
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

  const trend = [...rows]
    .reverse()
    .map((row) => ({
      date: row.date,
      moodLabel: row.mood_label,
      moodScore: Number(Number(row.mood_score).toFixed(2)),
      isEnded: Boolean(row.is_ended),
      userMessageCount: Number(row.user_message_count),
    }));

  const recentConversations = rows.map((row) => mapConversation(row));

  res.json({
    user: mapUser(user),
    summary,
    moodBreakdown,
    trend,
    recentConversations,
    insights: buildInsights(summary, moodBreakdown),
  });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(PORT, () => {
  console.log(`AI chatbot server running on http://localhost:${PORT}`);
});

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

    CREATE INDEX IF NOT EXISTS idx_conversations_user_date ON conversations(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
  `);
}

function nowIso() {
  return dayjs().toISOString();
}

function todayDate() {
  return dayjs().format('YYYY-MM-DD');
}

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
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(candidate)
    ? candidate
    : DEFAULT_CHECK_IN_TIME;
}

function normalizeDate(value) {
  const candidate = String(value || '').trim();
  if (!candidate) {
    return todayDate();
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    return todayDate();
  }
  const parsed = dayjs(candidate);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : todayDate();
}

function clampDays(value) {
  const raw = Number(value);
  if (Number.isNaN(raw)) {
    return 30;
  }
  return Math.max(7, Math.min(120, Math.trunc(raw)));
}

function getUser(userId) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

function ensureUser(userId) {
  const existing = getUser(userId);
  if (existing) {
    return existing;
  }

  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO users (id, name, check_in_time, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)`
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
  return db
    .prepare(
      `SELECT
          c.*,
          COALESCE(SUM(CASE WHEN m.sender = 'user' THEN 1 ELSE 0 END), 0) AS user_message_count,
          COALESCE(SUM(CASE WHEN m.sender = 'assistant' THEN 1 ELSE 0 END), 0) AS assistant_message_count
        FROM conversations c
        LEFT JOIN messages m ON m.conversation_id = c.id
        WHERE c.user_id = ? AND c.date = ?
        GROUP BY c.id`
    )
    .get(userId, date);
}

function getMessages(conversationId) {
  return db
    .prepare(
      `SELECT id, conversation_id, sender, content, mood_label, mood_score, created_at
        FROM messages
        WHERE conversation_id = ?
        ORDER BY id ASC`
    )
    .all(conversationId);
}

function insertMessage(conversationId, sender, content, mood) {
  db.prepare(
    `INSERT INTO messages (conversation_id, sender, content, mood_label, mood_score, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    conversationId,
    sender,
    content,
    mood?.label || null,
    mood?.score ?? null,
    nowIso()
  );

  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
    nowIso(),
    conversationId
  );
}

function maybeSeedCheckInPrompt(user, conversation, date, forcePrompt) {
  const totalMessages =
    Number(conversation.user_message_count) + Number(conversation.assistant_message_count);
  if (totalMessages > 0 || conversation.is_ended) {
    return;
  }

  const shouldPrompt =
    forcePrompt || (date === todayDate() && hasReachedCheckInTime(user.check_in_time));

  if (!shouldPrompt) {
    return;
  }

  const intro = `Hi ${user.name}, how was your day?`;
  insertMessage(conversation.id, 'assistant', intro, null);
}

function hasReachedCheckInTime(checkInTime) {
  const [hour, minute] = checkInTime.split(':').map((part) => Number(part));
  const now = dayjs();
  const currentMinutes = now.hour() * 60 + now.minute();
  const targetMinutes = hour * 60 + minute;
  return currentMinutes >= targetMinutes;
}

function analyzeMood(text) {
  const lowerText = text.toLowerCase();
  const words = lowerText.split(/[^a-z]+/).filter(Boolean);

  let score = 0;

  for (const word of words) {
    if (POSITIVE_WORDS.has(word)) {
      score += 1;
    }
    if (NEGATIVE_WORDS.has(word)) {
      score -= 1;
    }
  }

  if (/not good|rough day|bad day|too much|so tired|burned out|burnt out/.test(lowerText)) {
    score -= 1;
  }

  if (/really good|great day|feeling better|pretty happy|very productive/.test(lowerText)) {
    score += 1;
  }

  score = Math.max(-2, Math.min(2, score));

  return {
    score,
    label: moodLabelFromScore(score),
  };
}

function moodLabelFromScore(score) {
  if (score >= 1.5) {
    return 'great';
  }
  if (score >= 0.5) {
    return 'good';
  }
  if (score <= -1.5) {
    return 'tough';
  }
  if (score <= -0.5) {
    return 'low';
  }
  return 'neutral';
}

function updateConversationMood(conversationId) {
  const aggregate = db
    .prepare(
      `SELECT
          AVG(mood_score) AS average_score,
          COUNT(*) AS entries
        FROM messages
        WHERE conversation_id = ? AND sender = 'user' AND mood_score IS NOT NULL`
    )
    .get(conversationId);

  const averageScore = aggregate.entries ? Number(aggregate.average_score) : 0;
  const moodLabel = moodLabelFromScore(averageScore);

  db.prepare(
    `UPDATE conversations
      SET mood_score = ?, mood_label = ?, updated_at = ?
      WHERE id = ?`
  ).run(averageScore, moodLabel, nowIso(), conversationId);
}

function buildAssistantReply({ userName, userText, moodLabel, userMessageCount }) {
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
    return {
      reply: `No problem. I can close today\'s chat now. Click “End today\'s conversation” when you are ready.`,
      promptToEnd: true,
    };
  }

  if (userMessageCount >= 4) {
    return {
      reply: `${reply} If you are ready, I can also help you wrap up this conversation for today.`,
      promptToEnd: true,
    };
  }

  return {
    reply,
    promptToEnd: false,
  };
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
  if (!rows.length) {
    return 0;
  }

  let streak = 1;
  let prevDate = dayjs(rows[0].date);

  for (let index = 1; index < rows.length; index += 1) {
    const currentDate = dayjs(rows[index].date);
    const gap = prevDate.diff(currentDate, 'day');
    if (gap === 1) {
      streak += 1;
      prevDate = currentDate;
    } else {
      break;
    }
  }

  return streak;
}

function pick(list) {
  const index = Math.floor(Math.random() * list.length);
  return list[index];
}

function mapUser(row) {
  return {
    id: row.id,
    name: row.name,
    checkInTime: row.check_in_time,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapConversation(row) {
  return {
    id: row.id,
    userId: row.user_id,
    date: row.date,
    moodLabel: row.mood_label,
    moodScore: Number(Number(row.mood_score || 0).toFixed(2)),
    isEnded: Boolean(row.is_ended),
    startedAt: row.started_at,
    endedAt: row.ended_at,
    updatedAt: row.updated_at,
    userMessageCount: Number(row.user_message_count || 0),
    assistantMessageCount: Number(row.assistant_message_count || 0),
  };
}

function mapMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sender: row.sender,
    content: row.content,
    moodLabel: row.mood_label,
    moodScore: row.mood_score,
    createdAt: row.created_at,
  };
}
