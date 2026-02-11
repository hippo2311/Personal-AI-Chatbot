export const STORAGE_KEY = 'personal-ai-chat-ui-v1';
export const REMINDER_POLL_MS = 30000;

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

export const MOOD_META = {
  great: { label: 'Great', marker: 'GRT' },
  good: { label: 'Good', marker: 'GOOD' },
  neutral: { label: 'Neutral', marker: 'NEU' },
  low: { label: 'Low', marker: 'LOW' },
  tough: { label: 'Tough', marker: 'TGH' },
};

const MOOD_VALUE_MAP = {
  great: 1,
  good: 1,
  neutral: 0,
  low: -1,
  tough: -1,
  bad: -1,
};

export function moodLabelToValue(label) {
  const key = String(label || '').toLowerCase();
  if (Object.prototype.hasOwnProperty.call(MOOD_VALUE_MAP, key)) {
    return MOOD_VALUE_MAP[key];
  }
  return 0;
}

export function valueToMoodLabel(value) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || Math.abs(normalized) < 0.2) {
    return 'neutral';
  }
  if (normalized > 0) {
    return 'good';
  }
  return 'tough';
}

export const DIARY_META = {
  good: { label: 'Good thing', marker: 'GOOD' },
  bad: { label: 'Bad thing', marker: 'BAD' },
};

export function buildDefaultProfile(overrides = {}) {
  return {
    name: 'Friend',
    email: '',
    emailLower: '',
    bio: '',
    avatarUrl: '',
    checkInTime: '20:00',
    notificationEnabled: false,
    completedChallenges: [],
    friends: [],
    friendRequestsIncoming: [],
    friendRequestsOutgoing: [],
    hiddenPostIds: [],
    ...overrides,
  };
}

export function buildDefaultUser(id = 'user-001') {
  return {
    id,
    profile: buildDefaultProfile(),
    conversations: {},
    dates: {},
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

export function clone(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

export function loadDb() {
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
  } catch {
    return buildInitialDb();
  }
}

export function saveDb(db) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

export function toIsoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function buildDefaultDateBucket(overrides = {}) {
  const base = {
    dashboard: {
      moodLabel: 'neutral',
      moodScore: 0,
      ended: false,
      insights: [],
      reminderTriggered: false,
    },
    diaries: [],
  };

  const incomingDashboard = overrides?.dashboard || {};
  return {
    dashboard: {
      ...base.dashboard,
      ...incomingDashboard,
    },
    diaries: Array.isArray(overrides?.diaries) ? overrides.diaries : base.diaries,
  };
}

export function isValidDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

export function sanitizeUserId(raw) {
  const cleaned = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  return cleaned.slice(0, 24);
}

export function randomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function sortDiaryEntries(entries) {
  return [...entries].sort((first, second) => {
    const dateCompare = String(second.date || '').localeCompare(String(first.date || ''));
    if (dateCompare !== 0) {
      return dateCompare;
    }
    return String(second.createdAt || '').localeCompare(String(first.createdAt || ''));
  });
}

export function buildEmptyConversation(date) {
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

export function formatDate(dateKey) {
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

export function formatTime(iso) {
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

export function scoreMood(text) {
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

export function updateConversationMood(conversation) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  const userMessages = messages.filter(
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

export function buildAiReply({ userName, userText, moodLabel, userTurns }) {
  const lower = userText.toLowerCase();
  const userEnding = /\b(bye|good night|done|end|stop|wrap up)\b/.test(lower);

  if (userEnding) {
    return `Got it, ${userName}. If you are done for today, tap "End today's conversation" below.`;
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

  return 'How did the rest of your day feel after that?';
}

export function getOrCreateConversation(user, dateKey) {
  const safeDate = isValidDateKey(dateKey) ? dateKey : toIsoDate();
  const conversations =
    user && user.conversations && typeof user.conversations === 'object'
      ? user.conversations
      : {};
  return conversations[safeDate] || buildEmptyConversation(safeDate);
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

export function analyzeConversations(user) {
  const conversations =
    user && user.conversations && typeof user.conversations === 'object'
      ? user.conversations
      : {};
  const logs = Object.values(conversations)
    .filter((conversation) =>
      Array.isArray(conversation?.messages)
        ? conversation.messages.some((message) => message.sender === 'user')
        : false
    )
    .sort((first, second) => String(second.date).localeCompare(String(first.date)));

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
    ? Number((((logs.filter((conversation) => conversation.ended).length / totalDays) * 100).toFixed(1)))
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

export function getReminderText(user, todayConversation) {
  if (todayConversation?.checkInPrompted) {
    return "Today's check-in already sent.";
  }

  const now = getNowMinutes();
  const target = timeToMinutes(user.checkInTime);

  if (now >= target) {
    return 'Check-in window is open now.';
  }

  return `Next check-in at ${user.checkInTime}.`;
}

export function isCheckInWindowOpen(checkInTime) {
  return getNowMinutes() >= timeToMinutes(checkInTime);
}
