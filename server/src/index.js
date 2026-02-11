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
const OPENAI_EXTRACTION_MODEL = 'o3'; // Best reasoning model for knowledge graph extraction
const OPENAI_CHAT_MODEL = 'gpt-4o'; // For conversation & context traversal
const OPENAI_MINI_MODEL = 'gpt-4o-mini'; // For simple checks
const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small'; // Cheap & fast embeddings
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

  // ─── INTELLIGENT CONTEXT RETRIEVAL ──────────────────────────────────────
  let knowledgeContext = '';
  
  try {
    // Step 1: Check if context retrieval is needed
    const needsContext = await checkIfContextNeeded(text);
    console.log(`🤔 Context needed: ${needsContext}`);
    
    if (needsContext) {
      // Step 2-4: Retrieve and filter relevant context
      knowledgeContext = await getRelevantKnowledgeContext(userId, text);
      console.log(`📚 Context retrieved:`, knowledgeContext ? 'Yes' : 'No relevant context');
    }
  } catch (err) {
    console.error('⚠️ Context retrieval failed:', err.message);
    // Continue without context if retrieval fails
  }
  // ────────────────────────────────────────────────────────────────────────

  let assistantReply;
  try {
    assistantReply = await buildAssistantReplyAI({
      userName: user.name,
      userText: text,
      moodLabel: mood.label,
      userMessageCount: sessionMessages.filter(m => m.sender === 'user').length,
      allMessages: sessionMessages,
      knowledgeContext,
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
// OPENAI & EMBEDDINGS
// ═════════════════════════════════════════════════════════════════════════════

function callOpenAI(messages, temperature = 0.7, maxTokens = 600, model = OPENAI_CHAT_MODEL) {
  return new Promise((resolve, reject) => {
    if (!OPENAI_API_KEY) {
      reject(new Error('OPENAI_API_KEY not set'));
      return;
    }

    // o1/o3 models use max_completion_tokens and don't support temperature
    const isReasoningModel = model.startsWith('o1') || model.startsWith('o3');
    const requestBody = isReasoningModel
      ? { model, messages, max_completion_tokens: maxTokens }
      : { model, messages, temperature, max_tokens: maxTokens };

    const body = JSON.stringify(requestBody);

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

async function generateEmbedding(text) {
  return new Promise((resolve, reject) => {
    if (!OPENAI_API_KEY) {
      reject(new Error('OPENAI_API_KEY not set'));
      return;
    }

    const body = JSON.stringify({
      model: OPENAI_EMBEDDING_MODEL,
      input: text.substring(0, 8000), // Limit to 8k chars
    });

    const options = {
      hostname: 'api.openai.com',
      path: '/v1/embeddings',
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
          resolve(parsed.data[0].embedding);
        } catch (e) {
          reject(new Error('Failed to parse embedding response'));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.write(body);
    req.end();
  });
}

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ═════════════════════════════════════════════════════════════════════════════
// INTELLIGENT CONTEXT RETRIEVAL
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Step 1: Determine if context retrieval is needed
 */
async function checkIfContextNeeded(userMessage) {
  const prompt = `You are analyzing a user's diary message to determine if they are referring to past events or memories.

User message: "${userMessage}"

Does this message reference or ask about past events, experiences, places, people, or things they've mentioned before?

Examples of messages that NEED context:
- "I miss that spicy noodle place"
- "Tell me about when I went to Chongqing"
- "What did I do last time I was there?"
- "I want to go back to that restaurant"
- "Remember when I told you about..."

Examples of messages that DON'T need context (current/new experiences):
- "I got scolded by my boss today"
- "I just broke up with my girlfriend"
- "I had a great day at work"
- "I'm feeling stressed about the exam"

Respond with ONLY "yes" or "no".`;

  try {
    const response = await callOpenAI([
      { role: 'user', content: prompt }
    ], 0.3, 10, OPENAI_MINI_MODEL); // Use mini for simple yes/no check
    
    return response.toLowerCase().includes('yes');
  } catch (err) {
    console.error('Error checking context need:', err);
    return false; // Default to no context if check fails
  }
}

/**
 * Steps 2-4: Retrieve relevant context using embeddings + graph traversal + filtering
 */
async function getRelevantKnowledgeContext(userId, query) {
  console.log(`🔍 Retrieving context for: "${query}"`);
  
  // Step 2: Find top 3 similar nodes using embeddings
  const startNodes = await findSimilarNodesWithEmbeddings(userId, query, 3);
  
  if (startNodes.length === 0) {
    console.log('📭 No similar nodes found');
    return '';
  }
  
  console.log(`📍 Starting from ${startNodes.length} nodes:`, 
    startNodes.map(n => `${n.name} (${(n.similarity * 100).toFixed(1)}%)`));
  
  // Step 3: Perform 2-hop graph traversal from these nodes
  const subgraphs = [];
  for (const startNode of startNodes) {
    // Only traverse from highly similar nodes (>70% similarity)
    if (startNode.similarity < 0.3) continue;
    
    const subgraph = traverseGraphFromNode(userId, startNode, 2);
    subgraphs.push({ startNode, subgraph });
  }
  
  if (subgraphs.length === 0) {
    console.log('📭 No subgraphs with sufficient similarity');
    return '';
  }
  
  // Step 4: Let AI determine relevance and extract only relevant context
  const rawContext = formatSubgraphsForFiltering(subgraphs);
  const relevantContext = await filterRelevantContext(query, rawContext);
  
  return relevantContext;
}

/**
 * Find similar nodes using vector embeddings
 */
async function findSimilarNodesWithEmbeddings(userId, query, topK = 3) {
  try {
    // Generate embedding for query
    const queryEmbedding = await generateEmbedding(query);
    
    // Get all entities and events with embeddings
    const entities = db.prepare(
      `SELECT id, name, entity_type, embedding FROM kg_entities 
       WHERE user_id = ? AND embedding IS NOT NULL`
    ).all(userId);
    
    const events = db.prepare(
      `SELECT id, summary, event_date, importance, embedding FROM kg_events 
       WHERE user_id = ? AND embedding IS NOT NULL`
    ).all(userId);
    
    // Calculate similarity for each
    const scoredNodes = [];
    
    for (const entity of entities) {
      const embedding = JSON.parse(entity.embedding);
      const similarity = cosineSimilarity(queryEmbedding, embedding);
      scoredNodes.push({
        id: `entity:${entity.id}`,
        type: 'entity',
        name: entity.name,
        entityType: entity.entity_type,
        similarity,
      });
    }
    
    for (const event of events) {
      const embedding = JSON.parse(event.embedding);
      const similarity = cosineSimilarity(queryEmbedding, embedding);
      scoredNodes.push({
        id: `event:${event.id}`,
        type: 'event',
        name: event.summary,
        eventDate: event.event_date,
        importance: event.importance,
        similarity,
      });
    }
    
    // Return top K most similar
    return scoredNodes
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
      
  } catch (err) {
    console.error('Error finding similar nodes:', err);
    return [];
  }
}

/**
 * Traverse graph using BFS from a starting node
 */
function traverseGraphFromNode(userId, startNode, maxHops = 2) {
  const visited = new Set();
  const results = { events: [], entities: [], relationships: [] };
  const queue = [{ id: startNode.id, hop: 0 }];
  
  while (queue.length > 0) {
    const { id, hop } = queue.shift();
    
    if (visited.has(id) || hop > maxHops) continue;
    visited.add(id);
    
    // Get all relationships from/to this node
    const rels = db.prepare(
      `SELECT * FROM kg_relationships 
       WHERE from_id = ? OR to_id = ?
       ORDER BY strength DESC`
    ).all(id, id);
    
    for (const rel of rels) {
      results.relationships.push(rel);
      
      const neighborId = rel.from_id === id ? rel.to_id : rel.from_id;
      
      if (!visited.has(neighborId)) {
        queue.push({ id: neighborId, hop: hop + 1 });
        
        // Fetch neighbor details
        if (neighborId.startsWith('event:')) {
          const eventId = neighborId.split(':')[1];
          const event = db.prepare(
            `SELECT * FROM kg_events WHERE id = ?`
          ).get(eventId);
          if (event) {
            results.events.push({
              ...event,
              domains: safeJsonParse(event.domains, []),
              keywords: safeJsonParse(event.keywords, []),
            });
          }
        } else if (neighborId.startsWith('entity:')) {
          const entityId = neighborId.split(':')[1];
          const entity = db.prepare(
            `SELECT * FROM kg_entities WHERE id = ?`
          ).get(entityId);
          if (entity) {
            results.entities.push({
              ...entity,
              attributes: safeJsonParse(entity.attributes, {}),
            });
          }
        }
      }
    }
  }
  
  return results;
}

/**
 * Format subgraphs for AI filtering
 */
function formatSubgraphsForFiltering(subgraphs) {
  let formatted = '';
  
  for (const { startNode, subgraph } of subgraphs) {
    formatted += `\n=== Starting from: ${startNode.name} ===\n`;
    
    // Events (sorted by recency)
    const sortedEvents = subgraph.events.sort((a, b) => 
      new Date(b.event_date) - new Date(a.event_date)
    );
    
    for (const event of sortedEvents) {
      formatted += `Event: ${event.summary} (${event.event_date}, importance: ${event.importance}/5)\n`;
    }
    
    // Entities
    for (const entity of subgraph.entities) {
      formatted += `Entity: ${entity.name} (${entity.entity_type})\n`;
    }
    
    // Key relationships
    for (const rel of subgraph.relationships.slice(0, 5)) {
      formatted += `Relationship: ${rel.from_id} --[${rel.relationship_type}]--> ${rel.to_id}\n`;
    }
    
    formatted += '\n';
  }
  
  return formatted;
}

/**
 * Step 4: Filter relevant context using AI
 */
async function filterRelevantContext(userQuery, rawContext) {
  const prompt = `You are analyzing context from a user's past diary entries to determine what's relevant to their current message.

User's current message: "${userQuery}"

Available context from past memories:
${rawContext}

Task: Extract ONLY the information that is directly relevant to answering or responding to the user's current message. Remove any unrelated memories or details.

If the context IS relevant, provide a concise summary (2-4 sentences) of the relevant memories.
If the context is NOT relevant or doesn't help, respond with exactly: "NO_RELEVANT_CONTEXT"

Relevant summary:`;

  try {
    const response = await callOpenAI([
      { role: 'user', content: prompt }
    ], 0.3, 200, OPENAI_CHAT_MODEL); // Use gpt-4o for context filtering
    
    if (response.includes('NO_RELEVANT_CONTEXT')) {
      console.log('🚫 AI determined context is not relevant');
      return '';
    }
    
    console.log('✅ AI filtered relevant context');
    return response;
    
  } catch (err) {
    console.error('Error filtering context:', err);
    return ''; // Fallback to no context
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// ASSISTANT REPLY
// ═════════════════════════════════════════════════════════════════════════════

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

${knowledgeContext ? `\nRelevant memories from ${userName}'s past:\n${knowledgeContext}\n` : ''}

Suggest ending if ${userMessageCount} >= 6 messages.`;

  const reply = await callOpenAI([
    { role: 'system', content: systemPrompt },
    ...history,
  ], 0.75, 300, OPENAI_CHAT_MODEL); // Use gpt-4o for chat

  return { reply, promptToEnd: userMessageCount >= 5 };
}

// ═════════════════════════════════════════════════════════════════════════════
// KNOWLEDGE GRAPH EXTRACTION
// ═════════════════════════════════════════════════════════════════════════════

async function extractKnowledgeGraphFromConversation(sessionMessages, userId, date) {
  const conversation = sessionMessages.map(m => `${m.sender.toUpperCase()}: ${m.content}`).join('\n');

  console.log('🤖 Calling OpenAI o3-mini for knowledge graph extraction...');

  // o1 models don't support system messages, so we merge the prompt into user message
  const fullPrompt = `You are a knowledge graph extractor for a personal diary app.

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

REMEMBER:
- Extract EVERY distinct event separately
- Include all entities mentioned
- Create relationships between events and entities
- Be thorough - missing events means losing memories!

Conversation to extract from:
${conversation}`;

  const raw = await callOpenAI([
    { role: 'user', content: fullPrompt },
  ], 0.1, 3000, OPENAI_EXTRACTION_MODEL); // Use o1 for best extraction quality

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

  const entityIdMap = {};
  const eventIdMap = {};

  // Save entities with embeddings
  for (const entity of entities) {
    const text = `${entity.name} ${JSON.stringify(entity.attributes)}`;
    const embedding = await generateEmbedding(text);
    
    const result = db.prepare(
      `INSERT OR REPLACE INTO kg_entities (user_id, entity_id, entity_type, name, attributes, embedding, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      entity.id,
      entity.type,
      entity.name,
      JSON.stringify(entity.attributes || {}),
      JSON.stringify(embedding),
      nowIso()
    );
    entityIdMap[entity.id] = `entity:${result.lastInsertRowid}`;
    console.log(`  💾 Entity saved: ${entity.name} (DB ID: ${result.lastInsertRowid})`);
  }

  // Save events with embeddings
  for (const event of events) {
    const text = `${event.summary} ${event.keywords?.join(' ')}`;
    const embedding = await generateEmbedding(text);
    
    const result = db.prepare(
      `INSERT INTO kg_events (user_id, event_date, summary, event_type, domains, emotional_tone, importance, related_entities, keywords, embedding, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      JSON.stringify(embedding),
      nowIso()
    );
    eventIdMap[event.id] = `event:${result.lastInsertRowid}`;
    console.log(`  💾 Event saved: ${event.summary.substring(0, 50)}... (DB ID: ${result.lastInsertRowid})`);
  }

  // Save relationships
  for (const rel of relationships) {
    const fromId = eventIdMap[rel.from_id] || entityIdMap[rel.from_id] || rel.from_id;
    const toId = eventIdMap[rel.to_id] || entityIdMap[rel.to_id] || rel.to_id;

    db.prepare(
      `INSERT INTO kg_relationships (user_id, from_id, to_id, relationship_type, strength, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(userId, fromId, toId, rel.relationship_type, rel.strength || 3, nowIso());
  }

  console.log(`✅ Saved knowledge graph with embeddings`);
}

// ═════════════════════════════════════════════════════════════════════════════
// GRAPH VISUALIZATION
// ═════════════════════════════════════════════════════════════════════════════

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

  return [...domainNodes, ...eventNodes, ...entityNodes];
}

function buildGraphEdges(events, relationships) {
  const edges = [];
  const lastEventPerDomain = {};

  for (const rel of relationships) {
    edges.push({
      source: rel.from_id,
      target: rel.to_id,
      type: rel.relationship_type.toUpperCase().replace(/_/g, ' '),
      strength: rel.strength,
    });
  }

  for (const ev of events) {
    for (const domain of ev.domains) {
      edges.push({ 
        source: `event:${ev.id}`, 
        target: `domain:${domain}`, 
        type: 'BELONGS TO' 
      });
      
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
      embedding TEXT,
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
      embedding TEXT,
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
