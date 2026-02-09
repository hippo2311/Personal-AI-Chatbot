import { useEffect, useState } from 'react';
import './App.css';
import Sidebar from './components/Sidebar.jsx';
import ChatPage from './pages/ChatPage.jsx';
import DiaryPage from './pages/DiaryPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import {
  analyzeConversations,
  buildAiReply,
  buildDefaultUser,
  buildEmptyConversation,
  clone,
  DIARY_META,
  formatDate,
  formatTime,
  getOrCreateConversation,
  getReminderText,
  isCheckInWindowOpen,
  isValidDateKey,
  loadDb,
  MOOD_META,
  randomId,
  REMINDER_POLL_MS,
  sanitizeUserId,
  saveDb,
  scoreMood,
  sortDiaryEntries,
  toIsoDate,
  updateConversationMood,
} from './lib/chatbotUtils.js';

const QUICK_REPLIES = [
  'Today was good and productive.',
  'I feel stressed and tired today.',
  'I had an awesome day!',
];

function normalizeDiaryEntries(rawEntries) {
  const source = Array.isArray(rawEntries) ? rawEntries : [];
  return sortDiaryEntries(
    source
      .map((entry) => {
        const title = String(entry?.title || '').trim();
        const details = String(entry?.details || '').trim();
        if (!title && !details) {
          return null;
        }

        return {
          id: String(entry?.id || `${entry?.date || toIsoDate()}-${title || details}`),
          date: isValidDateKey(entry?.date) ? String(entry.date) : toIsoDate(),
          type: entry?.type === 'bad' ? 'bad' : 'good',
          title: title || details.slice(0, 80),
          details,
          createdAt: String(entry?.createdAt || `${toIsoDate()}T12:00:00.000Z`),
        };
      })
      .filter(Boolean)
  );
}

function App() {
  const [db, setDb] = useState(loadDb);
  const [tab, setTab] = useState('chat');
  const [chatDate, setChatDate] = useState(toIsoDate());
  const [draft, setDraft] = useState('');
  const [diaryDate, setDiaryDate] = useState(toIsoDate());
  const [diaryType, setDiaryType] = useState('good');
  const [diaryTitle, setDiaryTitle] = useState('');
  const [diaryDetails, setDiaryDetails] = useState('');
  const [diaryQuery, setDiaryQuery] = useState('');
  const [diaryFilterType, setDiaryFilterType] = useState('all');
  const [diaryFilterDate, setDiaryFilterDate] = useState('');
  const [settingsUserId, setSettingsUserId] = useState('');
  const [settingsName, setSettingsName] = useState('');
  const [settingsTime, setSettingsTime] = useState('20:00');

  const activeUser = db.users[db.activeUserId] || buildDefaultUser(db.activeUserId);
  const conversation = getOrCreateConversation(activeUser, chatDate);
  const todayConversation = getOrCreateConversation(activeUser, toIsoDate());
  const reminderText = getReminderText(activeUser, todayConversation);

  const dashboard = analyzeConversations(activeUser);
  const diaryEntries = normalizeDiaryEntries(activeUser.diaryEntries);

  const diaryStats = diaryEntries.reduce(
    (stats, entry) => {
      stats.total += 1;
      if (entry.type === 'bad') {
        stats.badCount += 1;
      } else {
        stats.goodCount += 1;
      }
      return stats;
    },
    { total: 0, goodCount: 0, badCount: 0 }
  );

  const query = diaryQuery.trim().toLowerCase();
  const filteredDiaryEntries = diaryEntries.filter((entry) => {
    if (diaryFilterType !== 'all' && entry.type !== diaryFilterType) {
      return false;
    }

    if (diaryFilterDate && entry.date !== diaryFilterDate) {
      return false;
    }

    if (!query) {
      return true;
    }

    return `${entry.title} ${entry.details}`.toLowerCase().includes(query);
  });

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

        if (!isCheckInWindowOpen(user.checkInTime)) {
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

  const addDiaryEntry = () => {
    const title = diaryTitle.trim();
    const details = diaryDetails.trim();
    if (!title && !details) {
      return;
    }

    const entry = {
      id: randomId(),
      date: isValidDateKey(diaryDate) ? diaryDate : toIsoDate(),
      type: diaryType === 'bad' ? 'bad' : 'good',
      title: title || details.slice(0, 80),
      details,
      createdAt: new Date().toISOString(),
    };

    setDb((previous) => {
      const next = clone(previous);
      const user = next.users[next.activeUserId];
      const existingEntries = Array.isArray(user.diaryEntries) ? user.diaryEntries : [];
      user.diaryEntries = sortDiaryEntries([entry, ...existingEntries]);
      return next;
    });

    setDiaryTitle('');
    setDiaryDetails('');
  };

  const clearDiaryFilters = () => {
    setDiaryQuery('');
    setDiaryFilterType('all');
    setDiaryFilterDate('');
  };

  const removeDiaryEntry = (entryId) => {
    if (!entryId) {
      return;
    }

    const shouldDelete = window.confirm('Delete this diary entry?');
    if (!shouldDelete) {
      return;
    }

    setDb((previous) => {
      const next = clone(previous);
      const user = next.users[next.activeUserId];
      const existingEntries = Array.isArray(user.diaryEntries) ? user.diaryEntries : [];
      user.diaryEntries = existingEntries.filter((entry) => String(entry?.id) !== String(entryId));
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
    setDiaryDate(toIsoDate());
    setDiaryType('good');
    setDiaryTitle('');
    setDiaryDetails('');
    clearDiaryFilters();
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

  return (
    <div className="app-shell">
      <Sidebar activeUser={activeUser} reminderText={reminderText} tab={tab} setTab={setTab} />

      <main className="main-panel">
        {tab === 'chat' && (
          <ChatPage
            activeUser={activeUser}
            chatDate={chatDate}
            setChatDate={setChatDate}
            conversation={conversation}
            draft={draft}
            setDraft={setDraft}
            sendMessage={sendMessage}
            endConversation={endConversation}
            quickReplies={QUICK_REPLIES}
            formatDate={formatDate}
            formatTime={formatTime}
            moodMeta={MOOD_META}
          />
        )}

        {tab === 'diary' && (
          <DiaryPage
            diaryStats={diaryStats}
            diaryDate={diaryDate}
            setDiaryDate={setDiaryDate}
            diaryType={diaryType}
            setDiaryType={setDiaryType}
            diaryTitle={diaryTitle}
            setDiaryTitle={setDiaryTitle}
            diaryDetails={diaryDetails}
            setDiaryDetails={setDiaryDetails}
            addDiaryEntry={addDiaryEntry}
            diaryQuery={diaryQuery}
            setDiaryQuery={setDiaryQuery}
            diaryFilterType={diaryFilterType}
            setDiaryFilterType={setDiaryFilterType}
            diaryFilterDate={diaryFilterDate}
            setDiaryFilterDate={setDiaryFilterDate}
            clearDiaryFilters={clearDiaryFilters}
            removeDiaryEntry={removeDiaryEntry}
            filteredDiaryEntries={filteredDiaryEntries}
            diaryEntries={diaryEntries}
            diaryMeta={DIARY_META}
            formatDate={formatDate}
            formatTime={formatTime}
          />
        )}

        {tab === 'dashboard' && (
          <DashboardPage
            dashboard={dashboard}
            activeUser={activeUser}
            moodMeta={MOOD_META}
            formatDate={formatDate}
          />
        )}

        {tab === 'settings' && (
          <SettingsPage
            settingsUserId={settingsUserId}
            setSettingsUserId={setSettingsUserId}
            settingsName={settingsName}
            setSettingsName={setSettingsName}
            settingsTime={settingsTime}
            setSettingsTime={setSettingsTime}
            switchUser={switchUser}
            savePreferences={savePreferences}
          />
        )}
      </main>
    </div>
  );
}

export default App;
