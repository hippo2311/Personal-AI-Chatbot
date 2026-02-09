import { useEffect, useMemo, useState } from 'react';
import './App.css';

const STORAGE_KEY = 'personal-ai-chat-ui-v1';
const REMINDER_POLL_MS = 30000;

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
  'calm',
  'grateful',
  'fun',
  'better',
]);

const NEGATIVE_WORDS = new Set([
  'bad',
  'sad',
  'tired',
  'stressed',
  'anxious',
  'angry',
  'upset',
  'lonely',
  'worried',
  'overwhelmed',
  'burned',
  'burnt',
  'awful',
  'terrible',
]);

const MOOD_META = {
  great: { label: 'Great', marker: 'GRT' },
  good: { label: 'Good', marker: 'GOOD' },
  neutral: { label: 'Neutral', marker: 'NEU' },
  low: { label: 'Low', marker: 'LOW' },
  tough: { label: 'Tough', marker: 'TGH' },
};

function buildDefaultUser(id = 'user-001') {
  return {
    id,
    name: 'Friend',
    checkInTime: '20:00',
    conversations: {},
  };
}

function buildInitialDb() {
  return {
    activeUserId: 'user-001',
    users: {
      'user-001': buildDefaultUser('user-001'),
    },
  };
}

function clone(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function loadDb() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return buildInitialDb();
    }
    const parsed = JSON.parse(raw);
    if (!parsed?.users || !parsed?.activeUserId) {
      return buildInitialDb();
    }
    return parsed;
  } catch (_error) {
    return buildInitialDb();
  }
}

function saveDb(db) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

function toIsoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function sanitizeUserId(raw) {
  const cleaned = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  return cleaned.slice(0, 24);
}

function randomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildEmptyConversation(date) {
  return {
    date,
    moodLabel: 'neutral',
    moodScore: 0,
    ended: false,
    checkInPrompted: false,
    startedAt: new Date().toISOString(),
    endedAt: null,
    messages: [],
  };
}

function getNowMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function timeToMinutes(hhmm) {
  const [h = '0', m = '0'] = String(hhmm || '0:0').split(':');
  return Number(h) * 60 + Number(m);
}

function formatDate(dateKey) {
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return dateKey;
  }
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '--:--';
  }
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function labelFromMoodScore(score) {
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

function scoreMood(text) {
  const words = String(text || '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);

  let score = 0;
  for (const word of words) {
    if (POSITIVE_WORDS.has(word)) {
      score += 1;
    }
    if (NEGATIVE_WORDS.has(word)) {
      score -= 1;
    }
  }

  if (/rough day|not good|too much|burned out|burnt out/.test(text.toLowerCase())) {
    score -= 1;
  }
  if (/great day|really good|very productive|feeling better/.test(text.toLowerCase())) {
    score += 1;
  }

  score = Math.max(-2, Math.min(2, score));
  return { score, label: labelFromMoodScore(score) };
}

function updateConversationMood(conversation) {
  const userMessages = conversation.messages.filter(
    (message) => message.sender === 'user' && typeof message.moodScore === 'number'
  );

  if (!userMessages.length) {
    conversation.moodScore = 0;
    conversation.moodLabel = 'neutral';
    return;
  }

  const average =
    userMessages.reduce((total, message) => total + message.moodScore, 0) /
    userMessages.length;

  conversation.moodScore = Number(average.toFixed(2));
  conversation.moodLabel = labelFromMoodScore(average);
}

function buildAiReply({ userName, userText, moodLabel, userTurns }) {
  const lower = userText.toLowerCase();
  const userEnding = /\b(bye|good night|done|end|stop|wrap up)\b/.test(lower);

  if (userEnding) {
    return `Got it, ${userName}. If you are done for today, tap \"End today's conversation\" below.`;
  }

  if (moodLabel === 'tough') {
    return `That sounds heavy, ${userName}. What felt hardest today? If you want, we can wrap up after this.`;
  }

  if (moodLabel === 'low') {
    return `Thanks for sharing that. What would help tomorrow feel even a little lighter?`;
  }

  if (moodLabel === 'great') {
    return `Love hearing that. What is one win from today you want to repeat tomorrow?`;
  }

  if (moodLabel === 'good') {
    return `Nice. Solid day. What was one highlight for you?`;
  }

  if (userTurns >= 4) {
    return `Thanks for checking in, ${userName}. If you are ready, I can help you close this day now.`;
  }

  return `How did the rest of your day feel after that?`;
}

function getOrCreateConversation(user, dateKey) {
  return user.conversations[dateKey] || buildEmptyConversation(dateKey);
}

function dateDiffInDays(laterDateKey, earlierDateKey) {
  const later = new Date(`${laterDateKey}T00:00:00`).getTime();
  const earlier = new Date(`${earlierDateKey}T00:00:00`).getTime();
  return Math.round((later - earlier) / 86400000);
}

function computeStreak(conversations) {
  if (!conversations.length) {
    return 0;
  }

  let streak = 1;
  for (let index = 1; index < conversations.length; index += 1) {
    const previous = conversations[index - 1];
    const current = conversations[index];
    const gap = dateDiffInDays(previous.date, current.date);
    if (gap === 1) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}

function buildInsights(summary, moodBreakdown) {
  if (summary.totalDays === 0) {
    return ['No chat logs yet. Start a conversation and the dashboard will auto-populate.'];
  }

  const insights = [];

  if (summary.averageMoodScore >= 0.5) {
    insights.push('Mood trend is positive overall. Keep the routines that worked on good days.');
  } else if (summary.averageMoodScore <= -0.5) {
    insights.push('Mood trend is below neutral. Consider shorter check-ins with one small recovery goal.');
  } else {
    insights.push('Mood trend is stable. Adding more detail in chats improves pattern detection.');
  }

  if (summary.completionRate < 60) {
    insights.push('Many days are left open. Ending each day makes your dashboard cleaner.');
  } else {
    insights.push('Daily closure rate is strong, so your trend data is reliable.');
  }

  if (moodBreakdown.tough >= 3) {
    insights.push('Several tough days were detected recently. Plan lighter goals for tomorrow.');
  }

  return insights.slice(0, 3);
}

function analyzeConversations(user) {
  const logs = Object.values(user.conversations)
    .filter((conversation) =>
      conversation.messages.some((message) => message.sender === 'user')
    )
    .sort((first, second) => second.date.localeCompare(first.date));

  const moodBreakdown = {
    great: 0,
    good: 0,
    neutral: 0,
    low: 0,
    tough: 0,
  };

  for (const conversation of logs) {
    const key = conversation.moodLabel || 'neutral';
    if (moodBreakdown[key] !== undefined) {
      moodBreakdown[key] += 1;
    }
  }

  const totalDays = logs.length;
  const averageMoodScore = totalDays
    ? Number(
        (
          logs.reduce((sum, conversation) => sum + Number(conversation.moodScore || 0), 0) /
          totalDays
        ).toFixed(2)
      )
    : 0;

  const completionRate = totalDays
    ? Number(
        (
          (logs.filter((conversation) => conversation.ended).length / totalDays) *
          100
        ).toFixed(1)
      )
    : 0;

  const checkInsLast7Days = logs.filter((conversation) => {
    const diff = dateDiffInDays(toIsoDate(), conversation.date);
    return diff >= 0 && diff <= 6;
  }).length;

  const summary = {
    totalDays,
    averageMoodScore,
    averageMoodLabel: labelFromMoodScore(averageMoodScore),
    completionRate,
    checkInsLast7Days,
    streakDays: computeStreak(logs),
  };

  return {
    summary,
    moodBreakdown,
    trend: [...logs].slice(0, 14).reverse(),
    recent: logs.slice(0, 6),
    insights: buildInsights(summary, moodBreakdown),
  };
}

function getReminderText(user, todayConversation) {
  if (todayConversation?.checkInPrompted) {
    return `Today's check-in already sent.`;
  }

  const now = getNowMinutes();
  const target = timeToMinutes(user.checkInTime);

  if (now >= target) {
    return 'Check-in window is open now.';
  }

  return `Next check-in at ${user.checkInTime}.`;
}

function App() {
  const [db, setDb] = useState(loadDb);
  const [tab, setTab] = useState('chat');
  const [chatDate, setChatDate] = useState(toIsoDate());
  const [draft, setDraft] = useState('');
  const [settingsUserId, setSettingsUserId] = useState('');
  const [settingsName, setSettingsName] = useState('');
  const [settingsTime, setSettingsTime] = useState('20:00');

  const activeUser = db.users[db.activeUserId] || buildDefaultUser(db.activeUserId);
  const conversation = getOrCreateConversation(activeUser, chatDate);
  const todayConversation = getOrCreateConversation(activeUser, toIsoDate());

  const dashboard = useMemo(() => analyzeConversations(activeUser), [activeUser]);

  useEffect(() => {
    saveDb(db);
  }, [db]);

  useEffect(() => {
    setSettingsUserId(activeUser.id);
    setSettingsName(activeUser.name);
    setSettingsTime(activeUser.checkInTime);
  }, [activeUser.id, activeUser.name, activeUser.checkInTime]);

  useEffect(() => {
    setDb((previous) => {
      const next = clone(previous);
      const user = next.users[next.activeUserId];
      if (!user.conversations[chatDate]) {
        user.conversations[chatDate] = buildEmptyConversation(chatDate);
        return next;
      }
      return previous;
    });
  }, [chatDate, db.activeUserId]);

  useEffect(() => {
    const maybeRunReminder = () => {
      setDb((previous) => {
        const next = clone(previous);
        const user = next.users[next.activeUserId];
        const today = toIsoDate();

        if (!user.conversations[today]) {
          user.conversations[today] = buildEmptyConversation(today);
        }

        const todayLog = user.conversations[today];
        if (todayLog.ended || todayLog.checkInPrompted) {
          return previous;
        }

        if (getNowMinutes() < timeToMinutes(user.checkInTime)) {
          return previous;
        }

        todayLog.messages.push({
          id: randomId(),
          sender: 'assistant',
          text: `Hi ${user.name}, how was your day today?`,
          createdAt: new Date().toISOString(),
          moodLabel: null,
          moodScore: null,
        });
        todayLog.checkInPrompted = true;
        return next;
      });
    };

    maybeRunReminder();
    const timer = setInterval(maybeRunReminder, REMINDER_POLL_MS);
    return () => clearInterval(timer);
  }, [db.activeUserId, activeUser.checkInTime, activeUser.name]);

  const sendMessage = (customText) => {
    const text = String(customText ?? draft).trim();
    if (!text || conversation.ended) {
      return;
    }

    setDraft('');

    setDb((previous) => {
      const next = clone(previous);
      const user = next.users[next.activeUserId];
      if (!user.conversations[chatDate]) {
        user.conversations[chatDate] = buildEmptyConversation(chatDate);
      }

      const currentConversation = user.conversations[chatDate];
      const mood = scoreMood(text);

      currentConversation.messages.push({
        id: randomId(),
        sender: 'user',
        text,
        moodLabel: mood.label,
        moodScore: mood.score,
        createdAt: new Date().toISOString(),
      });

      const userTurns = currentConversation.messages.filter(
        (message) => message.sender === 'user'
      ).length;

      currentConversation.messages.push({
        id: randomId(),
        sender: 'assistant',
        text: buildAiReply({
          userName: user.name,
          userText: text,
          moodLabel: mood.label,
          userTurns,
        }),
        moodLabel: null,
        moodScore: null,
        createdAt: new Date().toISOString(),
      });

      currentConversation.checkInPrompted = true;
      updateConversationMood(currentConversation);
      return next;
    });
  };

  const endConversation = () => {
    if (conversation.ended) {
      return;
    }

    setDb((previous) => {
      const next = clone(previous);
      const user = next.users[next.activeUserId];
      if (!user.conversations[chatDate]) {
        user.conversations[chatDate] = buildEmptyConversation(chatDate);
      }

      const currentConversation = user.conversations[chatDate];
      currentConversation.ended = true;
      currentConversation.endedAt = new Date().toISOString();
      currentConversation.messages.push({
        id: randomId(),
        sender: 'assistant',
        text: `Nice check-in today, ${user.name}. I will ask again at ${user.checkInTime} tomorrow.`,
        moodLabel: null,
        moodScore: null,
        createdAt: new Date().toISOString(),
      });
      return next;
    });
  };

  const switchUser = () => {
    const targetUserId = sanitizeUserId(settingsUserId);
    if (!targetUserId) {
      return;
    }

    setDb((previous) => {
      const next = clone(previous);
      if (!next.users[targetUserId]) {
        next.users[targetUserId] = buildDefaultUser(targetUserId);
      }
      next.activeUserId = targetUserId;
      return next;
    });

    setChatDate(toIsoDate());
    setDraft('');
  };

  const savePreferences = () => {
    const cleanTime = /^([01]\d|2[0-3]):([0-5]\d)$/.test(settingsTime)
      ? settingsTime
      : '20:00';

    setDb((previous) => {
      const next = clone(previous);
      const user = next.users[next.activeUserId];
      user.name = settingsName.trim() || 'Friend';
      user.checkInTime = cleanTime;
      return next;
    });
  };

  const quickReplies = [
    'Today was good and productive.',
    'I feel stressed and tired today.',
    'I had an awesome day!',
  ];

  return (
    <div className="app-shell">
      <aside className="left-panel">
        <h1 className="brand">DayPulse AI</h1>
        <p className="brand-sub">
          Personal check-in chatbot UI with local database, analytics dashboard, and time-based prompts.
        </p>

        <div className="user-card">
          <p className="muted">Active user</p>
          <h2>{activeUser.name}</h2>
          <p className="mono">{activeUser.id}</p>
          <p className="status">{getReminderText(activeUser, todayConversation)}</p>
        </div>

        <nav className="tabs">
          {['chat', 'dashboard', 'settings'].map((tabId) => (
            <button
              key={tabId}
              className={`tab-btn ${tab === tabId ? 'active' : ''}`}
              onClick={() => setTab(tabId)}
            >
              {tabId}
            </button>
          ))}
        </nav>
      </aside>

      <main className="main-panel">
        {tab === 'chat' && (
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Daily Chat</h2>
                <p>AI asks about your day and responds based on mood.</p>
              </div>
              <input
                className="date-input"
                type="date"
                value={chatDate}
                onChange={(event) => setChatDate(event.target.value)}
              />
            </div>

            <div className="chat-meta">
              <span className={`mood-chip mood-${conversation.moodLabel}`}>
                Mood: {MOOD_META[conversation.moodLabel]?.marker} {MOOD_META[conversation.moodLabel]?.label}
              </span>
              <span className="mood-chip">Date: {formatDate(chatDate)}</span>
              <span className="mood-chip">
                Status: {conversation.ended ? 'Closed' : 'Open'}
              </span>
            </div>

            <div className="messages">
              {conversation.messages.length === 0 && (
                <div className="empty-state">
                  <p>No messages yet.</p>
                  <p>
                    Wait for {activeUser.checkInTime} or start now by sending your first message.
                  </p>
                </div>
              )}

              {conversation.messages.map((message) => (
                <article
                  key={message.id}
                  className={`message ${message.sender === 'assistant' ? 'assistant' : 'user'}`}
                >
                  <header>
                    <strong>{message.sender === 'assistant' ? 'AI' : activeUser.name}</strong>
                    <span>{formatTime(message.createdAt)}</span>
                  </header>
                  <p>{message.text}</p>
                  {message.sender === 'user' && message.moodLabel && (
                    <span className={`tiny-mood mood-${message.moodLabel}`}>
                      {MOOD_META[message.moodLabel]?.marker} {MOOD_META[message.moodLabel]?.label}
                    </span>
                  )}
                </article>
              ))}
            </div>

            <div className="quick-actions">
              {quickReplies.map((reply) => (
                <button key={reply} onClick={() => sendMessage(reply)}>
                  {reply}
                </button>
              ))}
            </div>

            <div className="composer">
              <input
                type="text"
                placeholder="Tell AI about your day..."
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    sendMessage();
                  }
                }}
                disabled={conversation.ended}
              />
              <button onClick={() => sendMessage()} disabled={conversation.ended}>
                Send
              </button>
              <button className="ghost" onClick={endConversation} disabled={conversation.ended}>
                End today's conversation
              </button>
            </div>
          </section>
        )}

        {tab === 'dashboard' && (
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Dashboard</h2>
                <p>Auto-analysis from chat logs (userID to date to conversation to mood).</p>
              </div>
            </div>

            <div className="kpi-grid">
              <div className="kpi-card">
                <p>Total days</p>
                <h3>{dashboard.summary.totalDays}</h3>
              </div>
              <div className="kpi-card">
                <p>Avg mood</p>
                <h3>
                  {MOOD_META[dashboard.summary.averageMoodLabel].marker}{' '}
                  {MOOD_META[dashboard.summary.averageMoodLabel].label}
                </h3>
              </div>
              <div className="kpi-card">
                <p>Completion rate</p>
                <h3>{dashboard.summary.completionRate}%</h3>
              </div>
              <div className="kpi-card">
                <p>7-day check-ins</p>
                <h3>{dashboard.summary.checkInsLast7Days}</h3>
              </div>
              <div className="kpi-card">
                <p>Current streak</p>
                <h3>{dashboard.summary.streakDays} day(s)</h3>
              </div>
            </div>

            <div className="split-grid">
              <div className="card">
                <h3>Mood Trend (last 14 logs)</h3>
                {dashboard.trend.length === 0 && <p className="muted">No trend data yet.</p>}
                {dashboard.trend.map((item) => {
                  const width = `${Math.max(8, ((Number(item.moodScore) + 2) / 4) * 100)}%`;
                  return (
                    <div key={item.date} className="trend-row">
                      <span className="date-label">{formatDate(item.date)}</span>
                      <div className="bar-track">
                        <div className={`bar-fill mood-${item.moodLabel}`} style={{ width }} />
                      </div>
                      <span className="mood-label">
                        {MOOD_META[item.moodLabel]?.marker} {MOOD_META[item.moodLabel]?.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="card">
                <h3>Mood Breakdown</h3>
                {Object.entries(dashboard.moodBreakdown).map(([key, count]) => (
                  <div key={key} className="breakdown-row">
                    <span>
                      {MOOD_META[key].marker} {MOOD_META[key].label}
                    </span>
                    <strong>{count}</strong>
                  </div>
                ))}

                <h3 className="insight-title">AI Insights</h3>
                <ul className="insights">
                  {dashboard.insights.map((insight) => (
                    <li key={insight}>{insight}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="card">
              <h3>Recent Log Rows (local DB view)</h3>
              {dashboard.recent.length === 0 && <p className="muted">No rows yet.</p>}
              {dashboard.recent.map((item) => (
                <div key={item.date} className="db-row">
                  <span className="mono">{activeUser.id}</span>
                  <span>{item.date}</span>
                  <span>
                    {MOOD_META[item.moodLabel]?.marker} {MOOD_META[item.moodLabel]?.label}
                  </span>
                  <span>{item.messages.length} msg</span>
                  <span>{item.ended ? 'Closed' : 'Open'}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === 'settings' && (
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Settings</h2>
                <p>Set user profile and daily reminder time.</p>
              </div>
            </div>

            <div className="form-grid">
              <label>
                User ID
                <input
                  type="text"
                  value={settingsUserId}
                  onChange={(event) => setSettingsUserId(event.target.value)}
                  placeholder="e.g. user-001"
                />
              </label>
              <button onClick={switchUser}>Switch / Create User</button>

              <label>
                Display name
                <input
                  type="text"
                  value={settingsName}
                  onChange={(event) => setSettingsName(event.target.value)}
                  placeholder="Your name"
                />
              </label>

              <label>
                Daily check-in time
                <input
                  type="time"
                  value={settingsTime}
                  onChange={(event) => setSettingsTime(event.target.value)}
                />
              </label>

              <button onClick={savePreferences}>Save Preferences</button>
            </div>

            <div className="card">
              <h3>System Requirements Covered</h3>
              <ul className="requirements">
                <li>Time-sensitive reminder asks about your day at configured time.</li>
                <li>AI prompts user to end conversation for each day.</li>
                <li>Dashboard is populated by chat-log analysis.</li>
                <li>Local database structure: userID to date to conversation + mood.</li>
              </ul>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
