import { useEffect, useState } from 'react';
import './App.css';
import Sidebar from './components/Sidebar.jsx';
import ChatPage from './pages/ChatPage.jsx';
import DiaryPage from './pages/DiaryPage.jsx';
import CommunityWallPage from './pages/CommunityWallPage.jsx';
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
const MAX_PHOTOS_PER_ENTRY = 6;
const MAX_PHOTO_SIZE_BYTES = 4 * 1024 * 1024;
const MAX_WALL_PHOTOS_PER_POST = 4;

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

function normalizeDiaryEntries(rawEntries) {
  const source = Array.isArray(rawEntries) ? rawEntries : [];
  return sortDiaryEntries(
    source
      .map((entry) => {
        const title = String(entry?.title || '').trim();
        const details = String(entry?.details || '').trim();
        const photos = Array.isArray(entry?.photos)
          ? entry.photos
              .map((photo, index) => {
                const dataUrl =
                  typeof photo === 'string' ? photo : String(photo?.dataUrl || '');
                if (!dataUrl.startsWith('data:image')) {
                  return null;
                }
                return {
                  id: String(photo?.id || `${entry?.id || 'entry'}-photo-${index}`),
                  name: String(photo?.name || `Photo ${index + 1}`),
                  dataUrl,
                };
              })
              .filter(Boolean)
          : [];

        if (!title && !details && photos.length === 0) {
          return null;
        }

        return {
          id: String(entry?.id || `${entry?.date || toIsoDate()}-${title || details}`),
          date: isValidDateKey(entry?.date) ? String(entry.date) : toIsoDate(),
          type: entry?.type === 'bad' ? 'bad' : 'good',
          title: title || details.slice(0, 80),
          details,
          photos,
          createdAt: String(entry?.createdAt || `${toIsoDate()}T12:00:00.000Z`),
        };
      })
      .filter(Boolean)
  );
}

function normalizeWallPosts(rawPosts) {
  const source = Array.isArray(rawPosts) ? rawPosts : [];
  return source
    .map((post) => {
      const text = String(post?.text || '').trim();
      const photos = Array.isArray(post?.photos)
        ? post.photos
            .map((photo, index) => {
              const dataUrl =
                typeof photo === 'string' ? photo : String(photo?.dataUrl || '');
              if (!dataUrl.startsWith('data:image')) {
                return null;
              }
              return {
                id: String(photo?.id || `${post?.id || 'post'}-photo-${index}`),
                name: String(photo?.name || `Photo ${index + 1}`),
                dataUrl,
              };
            })
            .filter(Boolean)
        : [];

      if (!text && photos.length === 0) {
        return null;
      }

      const comments = Array.isArray(post?.comments)
        ? post.comments
            .map((comment) => {
              const commentText = String(comment?.text || '').trim();
              if (!commentText) {
                return null;
              }
              return {
                id: String(comment?.id || randomId()),
                authorName: String(comment?.authorName || 'Friend'),
                text: commentText,
                createdAt: String(comment?.createdAt || new Date().toISOString()),
              };
            })
            .filter(Boolean)
            .sort((first, second) => String(first.createdAt).localeCompare(String(second.createdAt)))
        : [];

      const reactions = post?.reactions || {};
      return {
        id: String(post?.id || randomId()),
        text,
        authorName: String(post?.authorName || 'Friend'),
        anonymous: Boolean(post?.anonymous),
        createdAt: String(post?.createdAt || new Date().toISOString()),
        photos,
        reactions: {
          support: Array.isArray(reactions.support) ? reactions.support.map(String) : [],
          celebrate: Array.isArray(reactions.celebrate) ? reactions.celebrate.map(String) : [],
          care: Array.isArray(reactions.care) ? reactions.care.map(String) : [],
        },
        comments,
      };
    })
    .filter(Boolean)
    .sort((first, second) => String(second.createdAt).localeCompare(String(first.createdAt)));
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
  const [diaryPhotos, setDiaryPhotos] = useState([]);
  const [diaryPhotoError, setDiaryPhotoError] = useState('');
  const [diaryQuery, setDiaryQuery] = useState('');
  const [diaryFilterType, setDiaryFilterType] = useState('all');
  const [diaryFilterDate, setDiaryFilterDate] = useState('');
  const [wallDraft, setWallDraft] = useState('');
  const [wallAnonymous, setWallAnonymous] = useState(false);
  const [wallPhotos, setWallPhotos] = useState([]);
  const [wallPhotoError, setWallPhotoError] = useState('');
  const [wallCommentDrafts, setWallCommentDrafts] = useState({});
  const [settingsUserId, setSettingsUserId] = useState('');
  const [settingsName, setSettingsName] = useState('');
  const [settingsTime, setSettingsTime] = useState('20:00');

  const activeUser = db.users[db.activeUserId] || buildDefaultUser(db.activeUserId);
  const conversation = getOrCreateConversation(activeUser, chatDate);
  const todayConversation = getOrCreateConversation(activeUser, toIsoDate());
  const reminderText = getReminderText(activeUser, todayConversation);

  const dashboard = analyzeConversations(activeUser);
  const diaryEntries = normalizeDiaryEntries(activeUser.diaryEntries);
  const wallPosts = normalizeWallPosts(db.wallPosts);

  const diaryStats = diaryEntries.reduce(
    (stats, entry) => {
      stats.total += 1;
      if (entry.type === 'bad') {
        stats.badCount += 1;
      } else {
        stats.goodCount += 1;
      }
      stats.photoCount += Array.isArray(entry.photos) ? entry.photos.length : 0;
      return stats;
    },
    { total: 0, goodCount: 0, badCount: 0, photoCount: 0 }
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

  const handleDiaryPhotoSelect = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    setDiaryPhotoError('');

    if (!files.length) {
      return;
    }

    const allowedSlots = Math.max(0, MAX_PHOTOS_PER_ENTRY - diaryPhotos.length);
    if (allowedSlots === 0) {
      setDiaryPhotoError(`You can upload up to ${MAX_PHOTOS_PER_ENTRY} photos per entry.`);
      return;
    }

    const nextFiles = files.slice(0, allowedSlots);
    const convertedPhotos = [];

    for (const file of nextFiles) {
      if (!String(file.type || '').startsWith('image/')) {
        setDiaryPhotoError('Only image files are supported.');
        continue;
      }

      if (file.size > MAX_PHOTO_SIZE_BYTES) {
        setDiaryPhotoError('Each photo must be 4MB or smaller.');
        continue;
      }

      try {
        const dataUrl = await fileToDataUrl(file);
        convertedPhotos.push({
          id: randomId(),
          name: file.name || 'Photo',
          dataUrl,
        });
      } catch {
        setDiaryPhotoError('Could not read one of the selected photos.');
      }
    }

    if (convertedPhotos.length) {
      setDiaryPhotos((previous) => [...previous, ...convertedPhotos].slice(0, MAX_PHOTOS_PER_ENTRY));
    }
  };

  const removeSelectedDiaryPhoto = (photoId) => {
    setDiaryPhotos((previous) => previous.filter((photo) => photo.id !== photoId));
  };

  const addDiaryEntry = () => {
    const title = diaryTitle.trim();
    const details = diaryDetails.trim();
    if (!title && !details && diaryPhotos.length === 0) {
      return;
    }

    const entry = {
      id: randomId(),
      date: isValidDateKey(diaryDate) ? diaryDate : toIsoDate(),
      type: diaryType === 'bad' ? 'bad' : 'good',
      title: title || details.slice(0, 80),
      details,
      photos: diaryPhotos.map((photo) => ({
        id: photo.id,
        name: photo.name,
        dataUrl: photo.dataUrl,
      })),
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
    setDiaryPhotos([]);
    setDiaryPhotoError('');
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
    setDiaryPhotos([]);
    setDiaryPhotoError('');
    setWallDraft('');
    setWallAnonymous(false);
    setWallPhotos([]);
    setWallPhotoError('');
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

  const handleWallPhotoSelect = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    setWallPhotoError('');

    if (!files.length) {
      return;
    }

    const allowedSlots = Math.max(0, MAX_WALL_PHOTOS_PER_POST - wallPhotos.length);
    if (allowedSlots === 0) {
      setWallPhotoError(`You can upload up to ${MAX_WALL_PHOTOS_PER_POST} photos per post.`);
      return;
    }

    const nextFiles = files.slice(0, allowedSlots);
    const convertedPhotos = [];

    for (const file of nextFiles) {
      if (!String(file.type || '').startsWith('image/')) {
        setWallPhotoError('Only image files are supported.');
        continue;
      }

      if (file.size > MAX_PHOTO_SIZE_BYTES) {
        setWallPhotoError('Each photo must be 4MB or smaller.');
        continue;
      }

      try {
        const dataUrl = await fileToDataUrl(file);
        convertedPhotos.push({
          id: randomId(),
          name: file.name || 'Photo',
          dataUrl,
        });
      } catch {
        setWallPhotoError('Could not read one of the selected photos.');
      }
    }

    if (convertedPhotos.length) {
      setWallPhotos((previous) => [...previous, ...convertedPhotos].slice(0, MAX_WALL_PHOTOS_PER_POST));
    }
  };

  const removeSelectedWallPhoto = (photoId) => {
    setWallPhotos((previous) => previous.filter((photo) => photo.id !== photoId));
  };

  const createWallPost = () => {
    const text = wallDraft.trim();
    if (!text && wallPhotos.length === 0) {
      return;
    }

    const post = {
      id: randomId(),
      text,
      authorName: activeUser.name,
      anonymous: wallAnonymous,
      createdAt: new Date().toISOString(),
      photos: wallPhotos.map((photo) => ({
        id: photo.id,
        name: photo.name,
        dataUrl: photo.dataUrl,
      })),
      reactions: {
        support: [],
        celebrate: [],
        care: [],
      },
      comments: [],
    };

    setDb((previous) => {
      const next = clone(previous);
      const existingPosts = Array.isArray(next.wallPosts) ? next.wallPosts : [];
      next.wallPosts = [post, ...existingPosts];
      return next;
    });

    setWallDraft('');
    setWallAnonymous(false);
    setWallPhotos([]);
    setWallPhotoError('');
  };

  const toggleWallReaction = (postId, reactionKey) => {
    if (!postId || !['support', 'celebrate', 'care'].includes(reactionKey)) {
      return;
    }

    setDb((previous) => {
      const next = clone(previous);
      const existingPosts = Array.isArray(next.wallPosts) ? next.wallPosts : [];
      next.wallPosts = existingPosts.map((post) => {
        if (String(post?.id) !== String(postId)) {
          return post;
        }

        const reactions = post.reactions || {};
        const users = Array.isArray(reactions[reactionKey]) ? reactions[reactionKey].map(String) : [];
        const currentUserId = String(next.activeUserId);
        const hasReacted = users.includes(currentUserId);

        return {
          ...post,
          reactions: {
            support: Array.isArray(reactions.support) ? reactions.support.map(String) : [],
            celebrate: Array.isArray(reactions.celebrate) ? reactions.celebrate.map(String) : [],
            care: Array.isArray(reactions.care) ? reactions.care.map(String) : [],
            [reactionKey]: hasReacted
              ? users.filter((userId) => userId !== currentUserId)
              : [...users, currentUserId],
          },
        };
      });
      return next;
    });
  };

  const setWallCommentDraft = (postId, value) => {
    setWallCommentDrafts((previous) => ({
      ...previous,
      [postId]: value,
    }));
  };

  const addWallComment = (postId) => {
    const text = String(wallCommentDrafts[postId] || '').trim();
    if (!postId || !text) {
      return;
    }

    const comment = {
      id: randomId(),
      authorName: activeUser.name,
      text,
      createdAt: new Date().toISOString(),
    };

    setDb((previous) => {
      const next = clone(previous);
      const existingPosts = Array.isArray(next.wallPosts) ? next.wallPosts : [];
      next.wallPosts = existingPosts.map((post) => {
        if (String(post?.id) !== String(postId)) {
          return post;
        }

        const existingComments = Array.isArray(post.comments) ? post.comments : [];
        return {
          ...post,
          comments: [...existingComments, comment],
        };
      });
      return next;
    });

    setWallCommentDrafts((previous) => {
      const next = { ...previous };
      delete next[postId];
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
            diaryPhotos={diaryPhotos}
            diaryPhotoError={diaryPhotoError}
            handleDiaryPhotoSelect={handleDiaryPhotoSelect}
            removeSelectedDiaryPhoto={removeSelectedDiaryPhoto}
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

        {tab === 'community' && (
          <CommunityWallPage
            activeUser={activeUser}
            wallDraft={wallDraft}
            setWallDraft={setWallDraft}
            wallAnonymous={wallAnonymous}
            setWallAnonymous={setWallAnonymous}
            wallPhotos={wallPhotos}
            wallPhotoError={wallPhotoError}
            handleWallPhotoSelect={handleWallPhotoSelect}
            removeSelectedWallPhoto={removeSelectedWallPhoto}
            createWallPost={createWallPost}
            wallPosts={wallPosts}
            toggleWallReaction={toggleWallReaction}
            wallCommentDrafts={wallCommentDrafts}
            setWallCommentDraft={setWallCommentDraft}
            addWallComment={addWallComment}
            formatTime={formatTime}
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
