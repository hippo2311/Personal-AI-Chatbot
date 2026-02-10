/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import './App.css';
import Sidebar from './components/Sidebar.jsx';
import ChatPage from './pages/ChatPage.jsx';
import DiaryPage from './pages/DiaryPage.jsx';
import CommunityWallPage from './pages/CommunityWallPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import AuthPage from './pages/AuthPage.jsx';
import LandingPage from './pages/LandingPage.jsx';
import { auth, db as firestoreDb, storage } from './lib/firebase.js';
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
const SENSITIVE_TERMS = [
  'kill yourself',
  'nude',
  'racist',
  'hate speech',
  'f***',
  'bitch',
];
const DAILY_CHALLENGES = [
  'Write one thing you are grateful for today.',
  'Take a short walk and note one detail you enjoyed.',
  'Share one encouraging comment on the community wall.',
  'List one stress trigger and one tiny next step.',
  'Capture one meaningful photo from today.',
  'Write three words that describe your mood.',
  'Message a friend and ask how they are doing.',
];

function sanitizeFileName(name) {
  return String(name || 'photo')
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '-')
    .slice(0, 80);
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function containsSensitiveContent(text) {
  const normalized = String(text || '').toLowerCase();
  return SENSITIVE_TERMS.some((term) => normalized.includes(term));
}

function extractTags(text, manualTagsInput = '') {
  const hashtags = String(text || '')
    .toLowerCase()
    .match(/#[a-z0-9_]+/g);

  const manualTags = String(manualTagsInput || '')
    .split(',')
    .map((tag) => tag.trim().toLowerCase().replace(/[^a-z0-9_]/g, ''))
    .filter(Boolean);

  const merged = [
    ...(hashtags || []).map((tag) => tag.replace('#', '')),
    ...manualTags,
  ];

  return uniqueStrings(merged).slice(0, 6);
}

function getChallengeForDate(dateKey) {
  const seed = String(dateKey || '')
    .split('')
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return DAILY_CHALLENGES[seed % DAILY_CHALLENGES.length];
}

function shiftDateKey(dateKey, dayOffset) {
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return dateKey;
  }
  date.setDate(date.getDate() + dayOffset);
  return date.toISOString().slice(0, 10);
}

function computeDateStreak(dateKeys) {
  const dateSet = new Set(
    (Array.isArray(dateKeys) ? dateKeys : [])
      .map((dateKey) => String(dateKey || ''))
      .filter(isValidDateKey)
  );

  if (!dateSet.size) {
    return 0;
  }

  const today = toIsoDate();
  let cursor = today;
  if (!dateSet.has(cursor)) {
    const yesterday = shiftDateKey(today, -1);
    if (!dateSet.has(yesterday)) {
      return 0;
    }
    cursor = yesterday;
  }

  let streak = 0;
  while (dateSet.has(cursor)) {
    streak += 1;
    cursor = shiftDateKey(cursor, -1);
  }

  return streak;
}

function getStorageUploadErrorMessage(error) {
  const code = String(error?.code || '');
  if (code.includes('storage/unauthorized')) {
    return 'Storage permission denied. Update Firebase Storage rules.';
  }
  if (code.includes('storage/bucket-not-found')) {
    return 'Storage bucket not found. Check VITE_FIREBASE_STORAGE_BUCKET and Firebase Storage setup.';
  }
  if (code.includes('storage/quota-exceeded')) {
    return 'Storage quota exceeded on Firebase plan.';
  }
  if (code.includes('storage/retry-limit-exceeded')) {
    return 'Upload timeout. Check your network and try again.';
  }
  if (code.includes('storage/invalid-checksum')) {
    return 'Upload corrupted. Try selecting the image again.';
  }
  if (code.includes('storage/canceled')) {
    return 'Upload canceled.';
  }
  return `Storage upload failed${code ? ` (${code})` : ''}.`;
}

async function uploadPhotoToStorage(file, bucketPath) {
  const storagePath = `${bucketPath}/${Date.now()}-${randomId()}-${sanitizeFileName(file?.name)}`;
  const storageRef = ref(storage, storagePath);
  let url = '';
  try {
    await uploadBytes(storageRef, file);
    url = await getDownloadURL(storageRef);
  } catch (error) {
    throw new Error(getStorageUploadErrorMessage(error));
  }
  return {
    id: randomId(),
    name: file?.name || 'Photo',
    url,
    storagePath,
  };
}

function normalizePhoto(photo, fallbackId, fallbackName) {
  const dataUrl =
    typeof photo === 'string' && photo.startsWith('data:image')
      ? photo
      : String(photo?.dataUrl || '');
  const url = String(photo?.url || '');
  if (!dataUrl.startsWith('data:image') && !url.startsWith('http')) {
    return null;
  }

  return {
    id: String(photo?.id || fallbackId),
    name: String(photo?.name || fallbackName),
    dataUrl: dataUrl.startsWith('data:image') ? dataUrl : '',
    url: url.startsWith('http') ? url : '',
    storagePath: String(photo?.storagePath || ''),
    src: url.startsWith('http') ? url : dataUrl,
  };
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
                return normalizePhoto(
                  photo,
                  `${entry?.id || 'entry'}-photo-${index}`,
                  `Photo ${index + 1}`
                );
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
              return normalizePhoto(
                photo,
                `${post?.id || 'post'}-photo-${index}`,
                `Photo ${index + 1}`
              );
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
                authorId: String(comment?.authorId || ''),
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
        authorId: String(post?.authorId || ''),
        anonymous: Boolean(post?.anonymous),
        createdAt: String(post?.createdAt || new Date().toISOString()),
        createdAtMs: Number(post?.createdAtMs || Date.now()),
        photos,
        tags: Array.isArray(post?.tags) ? post.tags.map(String) : [],
        visibility: post?.visibility === 'friends' ? 'friends' : 'public',
        audienceUserIds: Array.isArray(post?.audienceUserIds)
          ? post.audienceUserIds.map(String)
          : [],
        reactions: {
          support: Array.isArray(reactions.support) ? reactions.support.map(String) : [],
          celebrate: Array.isArray(reactions.celebrate) ? reactions.celebrate.map(String) : [],
          care: Array.isArray(reactions.care) ? reactions.care.map(String) : [],
        },
        comments,
        reports: Array.isArray(post?.reports)
          ? post.reports
              .map((report) => ({
                userId: String(report?.userId || ''),
                reason: String(report?.reason || ''),
                createdAt: String(report?.createdAt || new Date().toISOString()),
              }))
              .filter((report) => Boolean(report.userId))
          : [],
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
  const [wallVisibility, setWallVisibility] = useState('public');
  const [wallTagsDraft, setWallTagsDraft] = useState('');
  const [wallSearchQuery, setWallSearchQuery] = useState('');
  const [wallSearchTag, setWallSearchTag] = useState('');
  const [wallScopeFilter, setWallScopeFilter] = useState('all');
  const [wallPhotos, setWallPhotos] = useState([]);
  const [wallPhotoError, setWallPhotoError] = useState('');
  const [wallComposeError, setWallComposeError] = useState('');
  const [wallCommentDrafts, setWallCommentDrafts] = useState({});
  const [settingsName, setSettingsName] = useState('');
  const [settingsBio, setSettingsBio] = useState('');
  const [settingsAvatarUrl, setSettingsAvatarUrl] = useState('');
  const [settingsTime, setSettingsTime] = useState('20:00');
  const [settingsNotificationEnabled, setSettingsNotificationEnabled] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState(() => {
    if (typeof Notification === 'undefined') {
      return 'unsupported';
    }
    return Notification.permission;
  });
  const [friendIdentifier, setFriendIdentifier] = useState('');
  const [friendMessage, setFriendMessage] = useState('');
  const [friendError, setFriendError] = useState('');
  const [authorProfiles, setAuthorProfiles] = useState({});
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
      starterUser.email = String(authUser.email || '');
      starterUser.emailLower = String(authUser.email || '').toLowerCase();
      starterUser.avatarUrl = String(authUser.photoURL || '');
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
        initialUser.email = String(authUser.email || '');
        initialUser.emailLower = String(authUser.email || '').toLowerCase();
        initialUser.avatarUrl = String(authUser.photoURL || '');
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
        email: String(data.email || authUser.email || ''),
        emailLower: String(data.emailLower || authUser.email || '').toLowerCase(),
        bio: String(data.bio || ''),
        avatarUrl: String(data.avatarUrl || authUser.photoURL || ''),
        notificationEnabled: Boolean(data.notificationEnabled),
        completedChallenges: Array.isArray(data.completedChallenges) ? data.completedChallenges : [],
        friends: Array.isArray(data.friends) ? data.friends.map(String) : [],
        friendRequestsIncoming: Array.isArray(data.friendRequestsIncoming)
          ? data.friendRequestsIncoming.map(String)
          : [],
        friendRequestsOutgoing: Array.isArray(data.friendRequestsOutgoing)
          ? data.friendRequestsOutgoing.map(String)
          : [],
        hiddenPostIds: Array.isArray(data.hiddenPostIds) ? data.hiddenPostIds.map(String) : [],
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
  }, [authUser?.uid, authUser?.displayName, authUser?.email, authUser?.photoURL]);

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
  const todayIso = toIsoDate();
  const dailyChallenge = getChallengeForDate(todayIso);
  const challengeCompleted = Array.isArray(activeUser.completedChallenges)
    ? activeUser.completedChallenges.includes(todayIso)
    : false;
  const diaryStreakDays = computeDateStreak(diaryEntries.map((entry) => entry.date));
  const friendIds = Array.isArray(activeUser.friends) ? activeUser.friends : [];
  const incomingFriendRequests = Array.isArray(activeUser.friendRequestsIncoming)
    ? activeUser.friendRequestsIncoming
    : [];
  const outgoingFriendRequests = Array.isArray(activeUser.friendRequestsOutgoing)
    ? activeUser.friendRequestsOutgoing
    : [];
  const hiddenPostIds = Array.isArray(activeUser.hiddenPostIds) ? activeUser.hiddenPostIds : [];

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

  const visibleWallPosts = wallPosts.filter((post) => {
    if (post.authorId === activeUser.id) {
      return true;
    }

    if (post.visibility !== 'friends') {
      return true;
    }

    if (Array.isArray(post.audienceUserIds) && post.audienceUserIds.includes(activeUser.id)) {
      return true;
    }

    return friendIds.includes(post.authorId);
  });

  const allWallTags = uniqueStrings(
    visibleWallPosts.flatMap((post) => (Array.isArray(post.tags) ? post.tags : []))
  ).sort((first, second) => first.localeCompare(second));

  const wallQueryLower = wallSearchQuery.trim().toLowerCase();
  const filteredWallPosts = visibleWallPosts.filter((post) => {
    const isHidden = hiddenPostIds.includes(post.id);
    if (wallScopeFilter === 'hidden' && !isHidden) {
      return false;
    }

    if (wallScopeFilter !== 'hidden' && isHidden) {
      return false;
    }

    if (wallScopeFilter === 'public' && post.visibility !== 'public') {
      return false;
    }

    if (wallScopeFilter === 'friends' && post.visibility !== 'friends') {
      return false;
    }

    if (wallScopeFilter === 'mine' && post.authorId !== activeUser.id) {
      return false;
    }

    if (wallSearchTag && !post.tags.includes(wallSearchTag)) {
      return false;
    }

    if (!wallQueryLower) {
      return true;
    }

    const commentsText = Array.isArray(post.comments)
      ? post.comments.map((comment) => comment.text).join(' ')
      : '';

    return `${post.text} ${post.tags.join(' ')} ${commentsText}`
      .toLowerCase()
      .includes(wallQueryLower);
  });

  const friendProfiles = friendIds.map((userId) => ({
    id: userId,
    name: authorProfiles[userId]?.name || userId,
    bio: authorProfiles[userId]?.bio || '',
    avatarUrl: authorProfiles[userId]?.avatarUrl || '',
  }));

  const incomingRequestProfiles = incomingFriendRequests.map((userId) => ({
    id: userId,
    name: authorProfiles[userId]?.name || userId,
    bio: authorProfiles[userId]?.bio || '',
    avatarUrl: authorProfiles[userId]?.avatarUrl || '',
  }));

  const outgoingRequestProfiles = outgoingFriendRequests.map((userId) => ({
    id: userId,
    name: authorProfiles[userId]?.name || userId,
    bio: authorProfiles[userId]?.bio || '',
    avatarUrl: authorProfiles[userId]?.avatarUrl || '',
  }));

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
    setSettingsBio(activeUser.bio || '');
    setSettingsAvatarUrl(activeUser.avatarUrl || '');
    setSettingsTime(activeUser.checkInTime);
    setSettingsNotificationEnabled(Boolean(activeUser.notificationEnabled));
  }, [
    hasActiveUser,
    activeUser.name,
    activeUser.bio,
    activeUser.avatarUrl,
    activeUser.checkInTime,
    activeUser.notificationEnabled,
  ]);

  useEffect(() => {
    const idsToLookup = uniqueStrings([
      ...visibleWallPosts.map((post) => post.authorId),
      ...friendIds,
      ...incomingFriendRequests,
      ...outgoingFriendRequests,
    ]).filter((userId) => userId && userId !== activeUser.id);

    const missingIds = idsToLookup.filter((userId) => !authorProfiles[userId]);
    if (!missingIds.length) {
      return;
    }

    let isCancelled = false;

    void Promise.all(
      missingIds.map(async (userId) => {
        const snapshot = await getDoc(doc(firestoreDb, 'users', userId));
        if (!snapshot.exists()) {
          return null;
        }

        const data = snapshot.data() || {};
        return [
          userId,
          {
            id: userId,
            name: String(data.name || 'Friend'),
            avatarUrl: String(data.avatarUrl || ''),
            bio: String(data.bio || ''),
            friendsCount: Array.isArray(data.friends) ? data.friends.length : 0,
          },
        ];
      })
    )
      .then((rows) => {
        if (isCancelled) {
          return;
        }

        setAuthorProfiles((previous) => {
          const next = { ...previous };
          rows.forEach((row) => {
            if (!row) {
              return;
            }
            const [userId, profile] = row;
            next[userId] = profile;
          });
          return next;
        });
      })
      .catch(() => {
        setSyncError('Cannot fetch public profiles right now.');
      });

    return () => {
      isCancelled = true;
    };
  }, [
    visibleWallPosts,
    friendIds,
    incomingFriendRequests,
    outgoingFriendRequests,
    activeUser.id,
    authorProfiles,
  ]);

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

        if (
          user.notificationEnabled &&
          typeof Notification !== 'undefined' &&
          Notification.permission === 'granted'
        ) {
          // Browser-level check-in alert (client-side notification).
          new Notification('DayPulse check-in', {
            body: `Hi ${user.name}, your daily check-in is ready.`,
          });
        }
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

      convertedPhotos.push({
        id: randomId(),
        name: file.name || 'Photo',
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }

    if (convertedPhotos.length) {
      setDiaryPhotos((previous) => [...previous, ...convertedPhotos].slice(0, MAX_PHOTOS_PER_ENTRY));
    }
  };

  const removeSelectedDiaryPhoto = (photoId) => {
    setDiaryPhotos((previous) => {
      const target = previous.find((photo) => photo.id === photoId);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return previous.filter((photo) => photo.id !== photoId);
    });
  };

  const addDiaryEntry = async () => {
    const title = diaryTitle.trim();
    const details = diaryDetails.trim();
    if (!title && !details && diaryPhotos.length === 0) {
      return;
    }

    if (containsSensitiveContent(`${title} ${details}`)) {
      setDiaryPhotoError('Please remove sensitive language before saving your diary entry.');
      return;
    }

    let uploadedPhotos = [];
    try {
      uploadedPhotos = await Promise.all(
        diaryPhotos.map((photo) => {
          if (photo.file) {
            return uploadPhotoToStorage(photo.file, `diaryPhotos/${activeUser.id}`);
          }

          return Promise.resolve({
            id: photo.id,
            name: photo.name,
            url: String(photo.url || ''),
            dataUrl: String(photo.dataUrl || ''),
            storagePath: String(photo.storagePath || ''),
          });
        })
      );
    } catch (error) {
      setDiaryPhotoError(String(error?.message || 'Upload failed. Please try again.'));
      return;
    }

    const entry = {
      id: randomId(),
      date: isValidDateKey(diaryDate) ? diaryDate : toIsoDate(),
      type: diaryType === 'bad' ? 'bad' : 'good',
      title: title || details.slice(0, 80),
      details,
      photos: uploadedPhotos,
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
    diaryPhotos.forEach((photo) => {
      if (photo.previewUrl) {
        URL.revokeObjectURL(photo.previewUrl);
      }
    });
    setDiaryPhotos([]);
    setDiaryPhotoError('');
  };

  const clearDiaryFilters = () => {
    setDiaryQuery('');
    setDiaryFilterType('all');
    setDiaryFilterDate('');
  };

  const completeDailyChallenge = () => {
    if (challengeCompleted) {
      return;
    }

    setDb((previous) => {
      const next = clone(previous);
      const user = next.users[next.activeUserId];
      if (!user) {
        return previous;
      }
      const completedDates = Array.isArray(user.completedChallenges) ? user.completedChallenges : [];
      user.completedChallenges = uniqueStrings([...completedDates, todayIso]);
      return next;
    });
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
      user.bio = settingsBio.trim().slice(0, 240);
      user.avatarUrl = settingsAvatarUrl.trim();
      user.checkInTime = cleanTime;
      user.notificationEnabled = Boolean(settingsNotificationEnabled);
      user.email = String(user.email || authUser.email || '');
      user.emailLower = String(user.email || authUser.email || '').toLowerCase();
      return next;
    });
  };

  const requestNotificationPermission = async () => {
    if (typeof Notification === 'undefined') {
      setNotificationPermission('unsupported');
      return;
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  };

  const findUserByIdentifier = async (identifier) => {
    const trimmed = String(identifier || '').trim();
    if (!trimmed) {
      return null;
    }

    if (trimmed.includes('@')) {
      const lookupQuery = query(
        collection(firestoreDb, 'users'),
        where('emailLower', '==', trimmed.toLowerCase()),
        limit(1)
      );
      const snapshot = await getDocs(lookupQuery);
      if (snapshot.empty) {
        return null;
      }
      const foundDoc = snapshot.docs[0];
      return {
        id: foundDoc.id,
        data: foundDoc.data() || {},
      };
    }

    const snapshot = await getDoc(doc(firestoreDb, 'users', trimmed));
    if (!snapshot.exists()) {
      return null;
    }

    return {
      id: trimmed,
      data: snapshot.data() || {},
    };
  };

  const sendFriendRequest = async (identifier) => {
    const cleanedIdentifier = String(identifier || '').trim();
    if (!cleanedIdentifier) {
      setFriendError('Enter a friend UID or email first.');
      return;
    }

    setFriendError('');
    setFriendMessage('');

    try {
      const target = await findUserByIdentifier(cleanedIdentifier);
      if (!target?.id) {
        setFriendError('User not found.');
        return;
      }

      const targetId = String(target.id);
      if (targetId === activeUser.id) {
        setFriendError('You cannot add yourself.');
        return;
      }

      if (friendIds.includes(targetId)) {
        setFriendError('You are already friends.');
        return;
      }

      if (outgoingFriendRequests.includes(targetId)) {
        setFriendError('Request already sent.');
        return;
      }

      if (incomingFriendRequests.includes(targetId)) {
        setFriendError('This user already requested you. Accept it below.');
        return;
      }

      await updateDoc(doc(firestoreDb, 'users', activeUser.id), {
        friendRequestsOutgoing: arrayUnion(targetId),
      });
      await updateDoc(doc(firestoreDb, 'users', targetId), {
        friendRequestsIncoming: arrayUnion(activeUser.id),
      });

      setFriendIdentifier('');
      setFriendMessage('Friend request sent.');
    } catch {
      setFriendError('Cannot send friend request right now.');
    }
  };

  const acceptFriendRequest = async (requesterId) => {
    if (!requesterId) {
      return;
    }

    setFriendError('');
    setFriendMessage('');
    try {
      await updateDoc(doc(firestoreDb, 'users', activeUser.id), {
        friendRequestsIncoming: arrayRemove(requesterId),
        friends: arrayUnion(requesterId),
      });

      await updateDoc(doc(firestoreDb, 'users', requesterId), {
        friendRequestsOutgoing: arrayRemove(activeUser.id),
        friends: arrayUnion(activeUser.id),
      });

      setFriendMessage('Friend request accepted.');
    } catch {
      setFriendError('Cannot accept request right now.');
    }
  };

  const declineFriendRequest = async (requesterId) => {
    if (!requesterId) {
      return;
    }

    setFriendError('');
    setFriendMessage('');
    try {
      await updateDoc(doc(firestoreDb, 'users', activeUser.id), {
        friendRequestsIncoming: arrayRemove(requesterId),
      });
      await updateDoc(doc(firestoreDb, 'users', requesterId), {
        friendRequestsOutgoing: arrayRemove(activeUser.id),
      });
      setFriendMessage('Friend request declined.');
    } catch {
      setFriendError('Cannot decline request right now.');
    }
  };

  const removeFriend = async (friendId) => {
    if (!friendId) {
      return;
    }

    const shouldRemove = window.confirm('Remove this friend?');
    if (!shouldRemove) {
      return;
    }

    setFriendError('');
    setFriendMessage('');
    try {
      await updateDoc(doc(firestoreDb, 'users', activeUser.id), {
        friends: arrayRemove(friendId),
      });
      await updateDoc(doc(firestoreDb, 'users', friendId), {
        friends: arrayRemove(activeUser.id),
      });
      setFriendMessage('Friend removed.');
    } catch {
      setFriendError('Cannot remove friend right now.');
    }
  };

  const handleWallPhotoSelect = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    setWallPhotoError('');
    setWallComposeError('');

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

      convertedPhotos.push({
        id: randomId(),
        name: file.name || 'Photo',
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }

    if (convertedPhotos.length) {
      setWallPhotos((previous) => [...previous, ...convertedPhotos].slice(0, MAX_WALL_PHOTOS_PER_POST));
    }
  };

  const removeSelectedWallPhoto = (photoId) => {
    setWallPhotos((previous) => {
      const target = previous.find((photo) => photo.id === photoId);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return previous.filter((photo) => photo.id !== photoId);
    });
  };

  const createWallPost = async () => {
    const text = wallDraft.trim();
    if (!text && wallPhotos.length === 0) {
      return;
    }

    setWallPhotoError('');
    setWallComposeError('');

    if (containsSensitiveContent(text)) {
      setWallComposeError('Your post contains sensitive language. Please edit before sharing.');
      return;
    }

    const tags = extractTags(text, wallTagsDraft);
    const uniqueAudience = uniqueStrings([activeUser.id, ...friendIds]);
    if (wallVisibility === 'friends' && uniqueAudience.length <= 1) {
      setWallComposeError('You need at least one friend before posting to your private circle.');
      return;
    }

    let uploadedPhotos = [];
    try {
      uploadedPhotos = await Promise.all(
        wallPhotos.map((photo) => {
          if (photo.file) {
            return uploadPhotoToStorage(photo.file, `wallPhotos/${activeUser.id}`);
          }

          return Promise.resolve({
            id: photo.id,
            name: photo.name,
            url: String(photo.url || ''),
            dataUrl: String(photo.dataUrl || ''),
            storagePath: String(photo.storagePath || ''),
          });
        })
      );
    } catch (error) {
      setWallPhotoError(String(error?.message || 'Failed to upload photos. Please try again.'));
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
      photos: uploadedPhotos,
      tags,
      visibility: wallVisibility === 'friends' ? 'friends' : 'public',
      audienceUserIds: wallVisibility === 'friends' ? uniqueAudience : [],
      reactions: {
        support: [],
        celebrate: [],
        care: [],
      },
      comments: [],
      reports: [],
    };

    await setDoc(postRef, post);

    setWallDraft('');
    setWallAnonymous(false);
    setWallVisibility('public');
    setWallTagsDraft('');
    wallPhotos.forEach((photo) => {
      if (photo.previewUrl) {
        URL.revokeObjectURL(photo.previewUrl);
      }
    });
    setWallPhotos([]);
    setWallPhotoError('');
    setWallComposeError('');
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
    setWallComposeError('');
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
    setWallComposeError('');

    if (containsSensitiveContent(text)) {
      setWallComposeError('Comment blocked due to sensitive language.');
      return;
    }

    const comment = {
      id: randomId(),
      authorName: activeUser.name,
      authorId: activeUser.id,
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

  const toggleHideWallPost = (postId) => {
    if (!postId) {
      return;
    }

    setDb((previous) => {
      const next = clone(previous);
      const user = next.users[next.activeUserId];
      if (!user) {
        return previous;
      }
      const hiddenIds = Array.isArray(user.hiddenPostIds) ? user.hiddenPostIds : [];
      if (hiddenIds.includes(postId)) {
        user.hiddenPostIds = hiddenIds.filter((id) => id !== postId);
      } else {
        user.hiddenPostIds = uniqueStrings([...hiddenIds, postId]);
      }
      return next;
    });
  };

  const reportWallPost = async (postId) => {
    if (!postId) {
      return;
    }

    const reason = window.prompt('Reason for report (optional):', 'Spam or abusive content');
    if (reason === null) {
      return;
    }

    const postRef = doc(firestoreDb, 'wallPosts', String(postId));
    const snapshot = await getDoc(postRef);
    if (!snapshot.exists()) {
      return;
    }

    const post = snapshot.data() || {};
    const existingReports = Array.isArray(post.reports) ? post.reports : [];
    if (existingReports.some((report) => String(report?.userId) === activeUser.id)) {
      setWallComposeError('You already reported this post.');
      return;
    }

    await updateDoc(postRef, {
      reports: [
        ...existingReports,
        {
          userId: activeUser.id,
          reason: String(reason || '').trim().slice(0, 200),
          createdAt: new Date().toISOString(),
        },
      ],
    });
    setWallComposeError('Post reported. Thank you for helping keep the wall safe.');
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
            diaryStreakDays={diaryStreakDays}
            dailyChallenge={dailyChallenge}
            challengeCompleted={challengeCompleted}
            completeDailyChallenge={completeDailyChallenge}
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
            dailyChallenge={dailyChallenge}
            challengeCompleted={challengeCompleted}
            diaryStreakDays={diaryStreakDays}
            friendCount={friendIds.length}
            wallPostsCount={filteredWallPosts.length}
          />
        )}

        {tab === 'community' && (
          <CommunityWallPage
            activeUser={activeUser}
            wallDraft={wallDraft}
            setWallDraft={setWallDraft}
            wallAnonymous={wallAnonymous}
            setWallAnonymous={setWallAnonymous}
            wallVisibility={wallVisibility}
            setWallVisibility={setWallVisibility}
            wallTagsDraft={wallTagsDraft}
            setWallTagsDraft={setWallTagsDraft}
            wallSearchQuery={wallSearchQuery}
            setWallSearchQuery={setWallSearchQuery}
            wallSearchTag={wallSearchTag}
            setWallSearchTag={setWallSearchTag}
            wallScopeFilter={wallScopeFilter}
            setWallScopeFilter={setWallScopeFilter}
            allWallTags={allWallTags}
            wallPhotos={wallPhotos}
            wallPhotoError={wallPhotoError}
            wallComposeError={wallComposeError}
            handleWallPhotoSelect={handleWallPhotoSelect}
            removeSelectedWallPhoto={removeSelectedWallPhoto}
            createWallPost={createWallPost}
            wallPosts={filteredWallPosts}
            toggleWallReaction={toggleWallReaction}
            wallCommentDrafts={wallCommentDrafts}
            setWallCommentDraft={setWallCommentDraft}
            addWallComment={addWallComment}
            hiddenPostIds={hiddenPostIds}
            toggleHideWallPost={toggleHideWallPost}
            reportWallPost={reportWallPost}
            authorProfiles={authorProfiles}
            friendIds={friendIds}
            incomingFriendRequests={incomingFriendRequests}
            outgoingFriendRequests={outgoingFriendRequests}
            sendFriendRequest={sendFriendRequest}
            acceptFriendRequest={acceptFriendRequest}
            formatTime={formatTime}
          />
        )}

        {tab === 'settings' && (
          <SettingsPage
            activeUserId={activeUser.id}
            activeUserEmail={activeUser.email}
            settingsName={settingsName}
            setSettingsName={setSettingsName}
            settingsBio={settingsBio}
            setSettingsBio={setSettingsBio}
            settingsAvatarUrl={settingsAvatarUrl}
            setSettingsAvatarUrl={setSettingsAvatarUrl}
            settingsTime={settingsTime}
            setSettingsTime={setSettingsTime}
            settingsNotificationEnabled={settingsNotificationEnabled}
            setSettingsNotificationEnabled={setSettingsNotificationEnabled}
            notificationPermission={notificationPermission}
            requestNotificationPermission={requestNotificationPermission}
            friendIdentifier={friendIdentifier}
            setFriendIdentifier={setFriendIdentifier}
            sendFriendRequest={sendFriendRequest}
            friendMessage={friendMessage}
            friendError={friendError}
            incomingRequestProfiles={incomingRequestProfiles}
            outgoingRequestProfiles={outgoingRequestProfiles}
            friendProfiles={friendProfiles}
            acceptFriendRequest={acceptFriendRequest}
            declineFriendRequest={declineFriendRequest}
            removeFriend={removeFriend}
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
