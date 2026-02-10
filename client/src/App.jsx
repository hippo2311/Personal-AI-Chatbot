import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import './App.css';
import Sidebar from './components/Sidebar.jsx';
import ChatPage from './pages/ChatPage.jsx';
import DiaryPage from './pages/DiaryPage.jsx';
import CommunityWallPage from './pages/CommunityWallPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import AuthPage from './pages/AuthPage.jsx';
import LandingPage from './pages/LandingPage.jsx';
import { auth, db as firestoreDb } from './lib/firebase.js';
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
  MOOD_META,
  randomId,
  REMINDER_POLL_MS,
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

function MainApp({ authUser, onLogout }) {
  const [db, setDb] = useState({
    activeUserId: authUser?.uid || '',
    users: {},
    wallPosts: [],
  });
  const remoteUserHashRef = useRef('');
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
  const [settingsName, setSettingsName] = useState('');
  const [settingsTime, setSettingsTime] = useState('20:00');
  const [syncError, setSyncError] = useState('');

  useEffect(() => {
    const authId = String(authUser?.uid || '').trim();
    if (!authId) {
      return;
    }
    setSyncError('');

    setDb((previous) => {
      if (previous.users[authId]) {
        return {
          ...previous,
          activeUserId: authId,
        };
      }
      const starterUser = buildDefaultUser(authId);
      starterUser.name = String(authUser.displayName || authUser.email || 'Friend');
      return {
        ...previous,
        activeUserId: authId,
        users: {
          ...previous.users,
          [authId]: starterUser,
        },
      };
    });

    const userRef = doc(firestoreDb, 'users', authId);
    const wallPostsQuery = query(
      collection(firestoreDb, 'wallPosts'),
      orderBy('createdAtMs', 'desc')
    );

    const unsubscribeUser = onSnapshot(userRef, async (snapshot) => {
      if (!snapshot.exists()) {
        const initialUser = buildDefaultUser(authId);
        initialUser.name = String(authUser.displayName || authUser.email || 'Friend');
        try {
          await setDoc(userRef, initialUser);
        } catch {
          setSyncError(
            'Cannot create your Firestore user profile. Check Firestore database and security rules.'
          );
        }
        remoteUserHashRef.current = JSON.stringify(initialUser);
        setDb((previous) => ({
          ...previous,
          activeUserId: authId,
          users: {
            ...previous.users,
            [authId]: initialUser,
          },
        }));
        return;
      }

      const data = snapshot.data() || {};
      const normalizedUser = {
        ...buildDefaultUser(authId),
        ...data,
        id: authId,
        name: String(data.name || authUser.displayName || authUser.email || 'Friend'),
        conversations: data.conversations || {},
        diaryEntries: Array.isArray(data.diaryEntries) ? data.diaryEntries : [],
      };

      remoteUserHashRef.current = JSON.stringify(normalizedUser);
      setDb((previous) => ({
        ...previous,
        activeUserId: authId,
        users: {
          ...previous.users,
          [authId]: normalizedUser,
        },
      }));
    }, () => {
      setSyncError('Cannot read user data from Firestore. Check database rules/permissions.');
    });

    const unsubscribeWall = onSnapshot(
      wallPostsQuery,
      (snapshot) => {
        const posts = snapshot.docs.map((postDoc) => ({
          id: postDoc.id,
          ...postDoc.data(),
        }));

        setDb((previous) => ({
          ...previous,
          wallPosts: posts,
        }));
      },
      () => {
        setSyncError('Cannot read community wall from Firestore. Check database rules/permissions.');
      }
    );

    return () => {
      unsubscribeUser();
      unsubscribeWall();
    };
  }, [authUser?.uid, authUser?.displayName, authUser?.email]);

  const hasActiveUser = Boolean(db.activeUserId && db.users[db.activeUserId]);
  const activeUser = hasActiveUser
    ? db.users[db.activeUserId]
    : buildDefaultUser(db.activeUserId || String(authUser?.uid || ''));

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

  const diarySearchQuery = diaryQuery.trim().toLowerCase();
  const filteredDiaryEntries = diaryEntries.filter((entry) => {
    if (diaryFilterType !== 'all' && entry.type !== diaryFilterType) {
      return false;
    }

    if (diaryFilterDate && entry.date !== diaryFilterDate) {
      return false;
    }

    if (!diarySearchQuery) {
      return true;
    }

    return `${entry.title} ${entry.details}`.toLowerCase().includes(diarySearchQuery);
  });

  useEffect(() => {
    const activeUserId = db.activeUserId;
    if (!activeUserId) {
      return;
    }

    const user = db.users[activeUserId];
    if (!user) {
      return;
    }

    const localHash = JSON.stringify(user);
    if (localHash === remoteUserHashRef.current) {
      return;
    }

    remoteUserHashRef.current = localHash;
    void setDoc(doc(firestoreDb, 'users', activeUserId), user).catch(() => {
      setSyncError('Cannot sync your updates to Firestore. Check database rules/permissions.');
    });
  }, [db.activeUserId, db.users]);

  useEffect(() => {
    if (!hasActiveUser) {
      return;
    }
    setSettingsName(activeUser.name);
    setSettingsTime(activeUser.checkInTime);
  }, [hasActiveUser, activeUser.name, activeUser.checkInTime]);

  useEffect(() => {
    setDb((previous) => {
      const next = clone(previous);
      const user = next.users[next.activeUserId];
      if (!user) {
        return previous;
      }
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
        if (!user) {
          return previous;
        }
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
      if (!user) {
        return previous;
      }
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
      if (!user) {
        return previous;
      }
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
      if (!user) {
        return previous;
      }
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
      if (!user) {
        return previous;
      }
      const existingEntries = Array.isArray(user.diaryEntries) ? user.diaryEntries : [];
      user.diaryEntries = existingEntries.filter((entry) => String(entry?.id) !== String(entryId));
      return next;
    });
  };

  const savePreferences = () => {
    const cleanTime = /^([01]\d|2[0-3]):([0-5]\d)$/.test(settingsTime)
      ? settingsTime
      : '20:00';

    setDb((previous) => {
      const next = clone(previous);
      const user = next.users[next.activeUserId];
      if (!user) {
        return previous;
      }
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

  const createWallPost = async () => {
    const text = wallDraft.trim();
    if (!text && wallPhotos.length === 0) {
      return;
    }

    const postRef = doc(collection(firestoreDb, 'wallPosts'));
    const nowIso = new Date().toISOString();
    const post = {
      text,
      authorName: activeUser.name,
      anonymous: wallAnonymous,
      authorId: activeUser.id,
      createdAt: nowIso,
      createdAtMs: Date.now(),
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

    await setDoc(postRef, post);

    setWallDraft('');
    setWallAnonymous(false);
    setWallPhotos([]);
    setWallPhotoError('');
  };

  const toggleWallReaction = async (postId, reactionKey) => {
    if (!postId || !['support', 'celebrate', 'care'].includes(reactionKey)) {
      return;
    }

    const postRef = doc(firestoreDb, 'wallPosts', String(postId));
    const snapshot = await getDoc(postRef);
    if (!snapshot.exists()) {
      return;
    }

    const post = snapshot.data() || {};
    const reactions = post.reactions || {};
    const users = Array.isArray(reactions[reactionKey]) ? reactions[reactionKey].map(String) : [];
    const currentUserId = String(activeUser.id);
    const hasReacted = users.includes(currentUserId);

    await updateDoc(postRef, {
      reactions: {
        support: Array.isArray(reactions.support) ? reactions.support.map(String) : [],
        celebrate: Array.isArray(reactions.celebrate) ? reactions.celebrate.map(String) : [],
        care: Array.isArray(reactions.care) ? reactions.care.map(String) : [],
        [reactionKey]: hasReacted
          ? users.filter((userId) => userId !== currentUserId)
          : [...users, currentUserId],
      },
    });
  };

  const setWallCommentDraft = (postId, value) => {
    setWallCommentDrafts((previous) => ({
      ...previous,
      [postId]: value,
    }));
  };

  const addWallComment = async (postId) => {
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

    const postRef = doc(firestoreDb, 'wallPosts', String(postId));
    const snapshot = await getDoc(postRef);
    if (!snapshot.exists()) {
      return;
    }

    const post = snapshot.data() || {};
    const existingComments = Array.isArray(post.comments) ? post.comments : [];

    await updateDoc(postRef, {
      comments: [...existingComments, comment],
    });

    setWallCommentDrafts((previous) => {
      const next = { ...previous };
      delete next[postId];
      return next;
    });
  };

  if (!hasActiveUser) {
    return (
      <div className="auth-loading">
        <p>Syncing your data...</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar
        activeUser={activeUser}
        reminderText={reminderText}
        tab={tab}
        setTab={setTab}
        onLogout={onLogout}
      />

      <main className="main-panel">
        {syncError && (
          <section className="panel">
            <p className="error-text">{syncError}</p>
          </section>
        )}
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
            activeUserId={activeUser.id}
            settingsName={settingsName}
            setSettingsName={setSettingsName}
            settingsTime={settingsTime}
            setSettingsTime={setSettingsTime}
            savePreferences={savePreferences}
          />
        )}
      </main>
    </div>
  );
}

function App() {
  const [authUser, setAuthUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [publicView, setPublicView] = useState('home');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
  };

  if (!authReady) {
    return (
      <div className="auth-loading">
        <p>Loading...</p>
      </div>
    );
  }

  if (!authUser) {
    if (publicView === 'auth') {
      return (
        <AuthPage
          initialMode="login"
          onBack={() => setPublicView('home')}
        />
      );
    }

    if (publicView === 'register') {
      return (
        <AuthPage
          initialMode="register"
          onBack={() => setPublicView('home')}
        />
      );
    }

    return (
      <LandingPage
        onLogin={() => setPublicView('auth')}
        onRegister={() => setPublicView('register')}
      />
    );
  }

  return <MainApp authUser={authUser} onLogout={handleLogout} />;
}

export default App;
