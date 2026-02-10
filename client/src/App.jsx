/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from 'react';
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
  serverTimestamp,
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
  buildDefaultDateBucket,
  buildDefaultProfile,
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

function normalizeDiaryEntry(entry, fallbackDateKey = toIsoDate(), fallbackIndex = 0) {
  const title = String(entry?.title || '').trim();
  const details = String(entry?.details || '').trim();
  const photos = Array.isArray(entry?.photos)
    ? entry.photos
        .map((photo, index) =>
          normalizePhoto(photo, `${entry?.id || 'entry'}-photo-${index}`, `Photo ${index + 1}`)
        )
        .filter(Boolean)
    : [];

  if (!title && !details && photos.length === 0) {
    return null;
  }

  const dateKey = isValidDateKey(entry?.date) ? String(entry.date) : fallbackDateKey;

  return {
    id: String(entry?.id || `${dateKey}-${title || details || fallbackIndex}`),
    date: dateKey,
    type: entry?.type === 'bad' ? 'bad' : 'good',
    title: title || details.slice(0, 80),
    details,
    photos,
    createdAt: String(entry?.createdAt || `${dateKey}T12:00:00.000Z`),
  };
}

function normalizeDiaryEntries(rawValue) {
  if (Array.isArray(rawValue)) {
    return sortDiaryEntries(
      rawValue
        .map((entry, index) => normalizeDiaryEntry(entry, toIsoDate(), index))
        .filter(Boolean)
    );
  }

  if (!rawValue || typeof rawValue !== 'object') {
    return [];
  }

  const entries = [];
  Object.entries(rawValue).forEach(([dateKey, bucket]) => {
    const diaries = Array.isArray(bucket?.diaries) ? bucket.diaries : [];
    diaries.forEach((entry, index) => {
      const normalized = normalizeDiaryEntry(entry, dateKey, index);
      if (normalized) {
        entries.push(normalized);
      }
    });
  });

  return sortDiaryEntries(entries);
}

function parseDateFromKey(key) {
  if (isValidDateKey(key)) {
    return key;
  }
  if (typeof key === 'string') {
    const maybeDate = key.slice(0, 10);
    if (isValidDateKey(maybeDate)) {
      return maybeDate;
    }
  }
  return toIsoDate();
}

function parseSequenceFromKey(key) {
  if (typeof key !== 'string') {
    return 1;
  }
  const parts = key.split('-');
  const maybeNumber = parts[parts.length - 1];
  const parsed = Number.parseInt(maybeNumber, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return 1;
}

function normalizeConversationMap(rawValue) {
  const result = {};

  const assignConversation = (key, conversation = {}) => {
    const fallbackKey = parseDateFromKey(key);
    const dateKey = isValidDateKey(conversation?.date)
      ? conversation.date
      : isValidDateKey(conversation?.startDate)
      ? conversation.startDate
      : fallbackKey;
    const base = buildEmptyConversation(dateKey);
    const conversationId = String(conversation?.conversationId || conversation?.id || key || dateKey);
    const sequenceNumber = Number(
      conversation?.sequenceNumber ?? conversation?.sequence ?? parseSequenceFromKey(conversationId)
    );

    const normalized = {
      ...base,
      ...conversation,
      date: dateKey,
      startDate: dateKey,
      conversationId,
      sequenceNumber: Number.isFinite(sequenceNumber) && sequenceNumber > 0 ? sequenceNumber : 1,
      startedAt: conversation?.startedAt || conversation?.started_at || base.startedAt,
      endedAt: conversation?.endedAt || conversation?.ended_at || base.endedAt,
      ended: Boolean(conversation?.ended ?? conversation?.isEnded ?? base.ended),
      checkInPrompted: Boolean(
        conversation?.checkInPrompted ?? conversation?.checkInPromptSent ?? base.checkInPrompted
      ),
    };

    normalized.messages = Array.isArray(conversation?.messages)
      ? conversation.messages
          .map((message, index) => {
            const text = String(message?.text || message?.content || '').trim();
            if (!text) {
              return null;
            }
            return {
              id: String(message?.id || `${dateKey}-message-${index}` || randomId()),
              sender: message?.sender === 'assistant' ? 'assistant' : 'user',
              text,
              moodLabel:
                typeof message?.moodLabel === 'string'
                  ? message.moodLabel
                  : typeof message?.mood_label === 'string'
                  ? message.mood_label
                  : null,
              moodScore:
                typeof message?.moodScore === 'number'
                  ? Number(message.moodScore)
                  : typeof message?.mood_score === 'number'
                  ? Number(message.mood_score)
                  : null,
              createdAt: String(
                message?.createdAt ||
                  message?.created_at ||
                  message?.timestamp ||
                  message?.sentAt ||
                  new Date().toISOString()
              ),
            };
          })
          .filter(Boolean)
      : [];

    updateConversationMood(normalized);

    const existing = result[dateKey];
    if (!existing || normalized.sequenceNumber >= (existing.sequenceNumber || 0)) {
      result[dateKey] = normalized;
    }
  };

  if (Array.isArray(rawValue)) {
    rawValue.forEach((conversation, index) => {
      assignConversation(conversation?.date || String(index), conversation || {});
    });
    return result;
  }

  Object.entries(rawValue || {}).forEach(([key, conversation]) => {
    assignConversation(key, conversation || {});
  });

  return result;
}

function ensureDateBucket(dateMap, dateKey) {
  const safeDate = isValidDateKey(dateKey) ? dateKey : toIsoDate();
  if (!dateMap[safeDate]) {
    dateMap[safeDate] = buildDefaultDateBucket();
    return dateMap[safeDate];
  }

  const bucket = dateMap[safeDate];
  if (!bucket.dashboard || !Array.isArray(bucket.diaries)) {
    dateMap[safeDate] = buildDefaultDateBucket(bucket);
    return dateMap[safeDate];
  }

  return bucket;
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
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
  const [syncError, setSyncError] = useState('');

  const getUserDocumentRef = (userId) => doc(firestoreDb, 'users', userId);
  const getConversationDocumentRef = (userId, conversationId) =>
    doc(firestoreDb, 'users', userId, 'conversations', conversationId);
  const getDiaryDocumentRef = (userId, dateKey) => doc(firestoreDb, 'users', userId, 'diaries', dateKey);
  const getDashboardDocumentRef = (userId, dateKey) =>
    doc(firestoreDb, 'users', userId, 'dashboard', dateKey);

  const persistDateBucket = (userId, rawDateKey, bucket) => {
    const safeUserId = String(userId || '').trim();
    const safeDateKey = isValidDateKey(rawDateKey) ? rawDateKey : toIsoDate();
    if (!safeUserId || !safeDateKey) {
      return Promise.resolve();
    }

    const normalizedBucket = buildDefaultDateBucket(bucket);
    return Promise.all([
      setDoc(
        getDiaryDocumentRef(safeUserId, safeDateKey),
        {
          date: safeDateKey,
          diaries: Array.isArray(normalizedBucket.diaries) ? normalizedBucket.diaries : [],
        },
        { merge: true }
      ),
      setDoc(
        getDashboardDocumentRef(safeUserId, safeDateKey),
        {
          date: safeDateKey,
          ...normalizedBucket.dashboard,
        },
        { merge: true }
      ),
    ]);
  };

  const buildConversationDraft = (user, rawDateKey) => {
    const safeDate = isValidDateKey(rawDateKey) ? rawDateKey : toIsoDate();
    const existing = user?.conversations?.[safeDate];
    if (existing) {
      const cloned = clone(existing);
      if (!cloned.conversationId) {
        const sequences = user?.conversationSequences || {};
        const nextSequence = Number(sequences[safeDate] || 0) + 1;
        cloned.conversationId = `${safeDate}-${String(nextSequence).padStart(2, '0')}`;
        cloned.sequenceNumber = nextSequence;
        cloned.startDate = safeDate;
        return {
          conversation: cloned,
          dateKey: safeDate,
          conversationId: cloned.conversationId,
          sequenceNumber: nextSequence,
          isNew: true,
        };
      }
      return {
        conversation: cloned,
        dateKey: safeDate,
        conversationId: cloned.conversationId,
        sequenceNumber:
          Number(cloned.sequenceNumber || parseSequenceFromKey(cloned.conversationId)) || 1,
        isNew: false,
      };
    }

    const sequences = user?.conversationSequences || {};
    const nextSequence = Number(sequences[safeDate] || 0) + 1;
    const conversationId = `${safeDate}-${String(nextSequence).padStart(2, '0')}`;

    return {
      conversation: buildEmptyConversation(safeDate, {
        conversationId,
        sequenceNumber: nextSequence,
        startDate: safeDate,
      }),
      dateKey: safeDate,
      conversationId,
      sequenceNumber: nextSequence,
      isNew: true,
    };
  };

  useEffect(() => {
    const authId = String(authUser?.uid || '').trim();
    if (!authId) {
      return;
    }

    setSyncError('');
    setConversationsLoaded(false);

    setDb((previous) => {
      if (previous.users[authId]) {
        return {
          ...previous,
          activeUserId: authId,
        };
      }
      const starterUser = buildDefaultUser(authId);
      starterUser.profile.name = String(authUser.displayName || authUser.email || 'Friend');
      starterUser.profile.email = String(authUser.email || '');
      starterUser.profile.emailLower = String(authUser.email || '').toLowerCase();
      starterUser.profile.avatarUrl = String(authUser.photoURL || '');
      return {
        ...previous,
        activeUserId: authId,
        users: {
          ...previous.users,
          [authId]: starterUser,
        },
      };
    });

    const starterProfile = buildDefaultProfile({
      name: String(authUser.displayName || authUser.email || 'Friend'),
      email: String(authUser.email || ''),
      emailLower: String(authUser.email || '').toLowerCase(),
      avatarUrl: String(authUser.photoURL || ''),
    });

    const userRef = getUserDocumentRef(authId);
    const conversationsRef = collection(userRef, 'conversations');
    const diariesRef = collection(userRef, 'diaries');
    const dashboardRef = collection(userRef, 'dashboard');
    const wallPostsQuery = query(
      collection(firestoreDb, 'wallPosts'),
      orderBy('createdAtMs', 'desc')
    );

    const ensureUserDoc = async () => {
      try {
        const snapshot = await getDoc(userRef);
        if (!snapshot.exists()) {
          await setDoc(userRef, {
            id: authId,
            userId: authId,
            ...starterProfile,
            createdAt: serverTimestamp(),
          });
        }
      } catch {
        setSyncError('Cannot create root user document in Firestore. Check database rules.');
      }
    };
    void ensureUserDoc();

    const unsubscribeUserDoc = onSnapshot(
      userRef,
      async (snapshot) => {
        if (!snapshot.exists()) {
          await ensureUserDoc();
          return;
        }

        const data = snapshot.data() || {};
        const normalizedProfile = buildDefaultProfile({
          name: data.name || authUser.displayName || authUser.email || 'Friend',
          email: data.email || authUser.email || '',
          emailLower: String(data.email || authUser.email || '').toLowerCase(),
          avatarUrl: data.avatarUrl || authUser.photoURL || '',
          bio: String(data.bio || ''),
          checkInTime: data.checkInTime || '20:00',
          notificationEnabled: Boolean(data.notificationEnabled),
          completedChallenges: Array.isArray(data.completedChallenges)
            ? data.completedChallenges
            : [],
          friends: Array.isArray(data.friends) ? data.friends.map(String) : [],
          friendRequestsIncoming: Array.isArray(data.friendRequestsIncoming)
            ? data.friendRequestsIncoming.map(String)
            : [],
          friendRequestsOutgoing: Array.isArray(data.friendRequestsOutgoing)
            ? data.friendRequestsOutgoing.map(String)
            : [],
          hiddenPostIds: Array.isArray(data.hiddenPostIds)
            ? data.hiddenPostIds.map(String)
            : [],
        });
        const incomingSequences =
          data.conversationSequences && typeof data.conversationSequences === 'object'
            ? data.conversationSequences
            : null;

        setDb((previous) => {
          const next = clone(previous);
          next.activeUserId = authId;
          const user = next.users[authId] || buildDefaultUser(authId);
          user.profile = normalizedProfile;
          if (incomingSequences) {
            user.conversationSequences = incomingSequences;
          }
          next.users[authId] = user;
          return next;
        });
      },
      () => {
        setSyncError('Cannot read your user document. Check Firestore rules/permissions.');
      }
    );

    const unsubscribeConversations = onSnapshot(
      conversationsRef,
      (snapshot) => {
        const rawConversations = {};
        const sequenceMap = {};
        snapshot.forEach((conversationDoc) => {
          const data = conversationDoc.data() || {};
          const docId = conversationDoc.id;
          const startDate = isValidDateKey(data.startDate)
            ? data.startDate
            : parseDateFromKey(docId);
          const sequenceNumber = Number(
            data.sequenceNumber ?? data.sequence ?? parseSequenceFromKey(docId)
          );
          rawConversations[docId] = {
            ...data,
            conversationId: docId,
            startDate,
            date: data.date || startDate,
            sequenceNumber: Number.isFinite(sequenceNumber) && sequenceNumber > 0 ? sequenceNumber : 1,
          };
          const dateKey = rawConversations[docId].date;
          sequenceMap[dateKey] = Math.max(sequenceMap[dateKey] || 0, rawConversations[docId].sequenceNumber);
        });

        const normalized = normalizeConversationMap(rawConversations);

        setDb((previous) => {
          const next = clone(previous);
          next.activeUserId = authId;
          const user = next.users[authId] || buildDefaultUser(authId);
          user.conversations = normalized;
          user.conversationSequences = sequenceMap;
          next.users[authId] = user;
          return next;
        });

        setConversationsLoaded(true);
      },
      () => {
        setSyncError('Cannot read conversations. Check Firestore rules/permissions.');
        setConversationsLoaded(false);
      }
    );

    const unsubscribeDiaries = onSnapshot(
      diariesRef,
      (snapshot) => {
        setDb((previous) => {
          const next = clone(previous);
          next.activeUserId = authId;
          const user = next.users[authId] || buildDefaultUser(authId);
          const updatedDates = { ...user.dates };
          const seenDates = new Set();

          snapshot.forEach((diaryDoc) => {
            const data = diaryDoc.data() || {};
            const dateKey = isValidDateKey(data.date) ? data.date : parseDateFromKey(diaryDoc.id);
            seenDates.add(dateKey);
            const existingBucket = updatedDates[dateKey] || buildDefaultDateBucket();
            const normalizedEntries = Array.isArray(data.diaries)
              ? data.diaries
                  .map((entry, index) => normalizeDiaryEntry(entry, dateKey, index))
                  .filter(Boolean)
              : [];

            updatedDates[dateKey] = buildDefaultDateBucket({
              dashboard: existingBucket.dashboard,
              diaries: normalizedEntries,
            });
          });

          Object.keys(updatedDates).forEach((dateKey) => {
            if (!seenDates.has(dateKey)) {
              const bucket = updatedDates[dateKey] || buildDefaultDateBucket();
              updatedDates[dateKey] = buildDefaultDateBucket({
                dashboard: bucket.dashboard,
                diaries: [],
              });
            }
          });

          user.dates = updatedDates;
          next.users[authId] = user;
          return next;
        });
      },
      () => {
        setSyncError('Cannot read diaries. Check Firestore rules/permissions.');
      }
    );

    const unsubscribeDashboard = onSnapshot(
      dashboardRef,
      (snapshot) => {
        setDb((previous) => {
          const next = clone(previous);
          next.activeUserId = authId;
          const user = next.users[authId] || buildDefaultUser(authId);
          const updatedDates = { ...user.dates };

          snapshot.forEach((dashboardDoc) => {
            const data = dashboardDoc.data() || {};
            const dateKey = isValidDateKey(data.date)
              ? data.date
              : parseDateFromKey(dashboardDoc.id);
            const existingBucket = updatedDates[dateKey] || buildDefaultDateBucket();
            updatedDates[dateKey] = buildDefaultDateBucket({
              diaries: existingBucket.diaries,
              dashboard: {
                ...existingBucket.dashboard,
                ...data,
                date: undefined,
              },
            });
          });

          user.dates = updatedDates;
          next.users[authId] = user;
          return next;
        });
      },
      () => {
        setSyncError('Cannot read dashboard insights. Check Firestore rules/permissions.');
      }
    );

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
      unsubscribeUserDoc();
      unsubscribeConversations();
      unsubscribeDiaries();
      unsubscribeDashboard();
      unsubscribeWall();
    };
  }, [authUser?.uid, authUser?.displayName, authUser?.email, authUser?.photoURL]);

  const hasActiveUser = Boolean(db.activeUserId && db.users[db.activeUserId]);
  const activeUser = hasActiveUser
    ? db.users[db.activeUserId]
    : buildDefaultUser(db.activeUserId || String(authUser?.uid || ''));
  const activeProfile = activeUser.profile || buildDefaultProfile();
  const activeDates = activeUser.dates || {};

  const conversation = getOrCreateConversation(activeUser, chatDate);
  const todayConversation = getOrCreateConversation(activeUser, toIsoDate());
  const reminderText = getReminderText(activeProfile, todayConversation);

  const dashboard = analyzeConversations(activeUser);
  const diaryEntries = normalizeDiaryEntries(activeDates);
  const wallPosts = normalizeWallPosts(db.wallPosts);
  const todayIso = toIsoDate();
  const dailyChallenge = getChallengeForDate(todayIso);
  const challengeCompleted = Array.isArray(activeProfile.completedChallenges)
    ? activeProfile.completedChallenges.includes(todayIso)
    : false;
  const diaryStreakDays = computeDateStreak(diaryEntries.map((entry) => entry.date));
  const friendIds = uniqueStrings(Array.isArray(activeProfile.friends) ? [...activeProfile.friends] : []);
  const incomingFriendRequests = uniqueStrings(
    Array.isArray(activeProfile.friendRequestsIncoming) ? [...activeProfile.friendRequestsIncoming] : []
  );
  const outgoingFriendRequests = uniqueStrings(
    Array.isArray(activeProfile.friendRequestsOutgoing) ? [...activeProfile.friendRequestsOutgoing] : []
  );
  const hiddenPostIds = Array.isArray(activeProfile.hiddenPostIds)
    ? activeProfile.hiddenPostIds
    : [];

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
    if (!hasActiveUser) {
      return;
    }
    setSettingsName(activeProfile.name);
    setSettingsBio(activeProfile.bio || '');
    setSettingsAvatarUrl(activeProfile.avatarUrl || '');
    setSettingsTime(activeProfile.checkInTime);
    setSettingsNotificationEnabled(Boolean(activeProfile.notificationEnabled));
  }, [
    hasActiveUser,
    activeProfile.name,
    activeProfile.bio,
    activeProfile.avatarUrl,
    activeProfile.checkInTime,
    activeProfile.notificationEnabled,
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
        const snapshot = await getDoc(getUserDocumentRef(userId));
        if (!snapshot.exists()) {
          return null;
        }

        const profile = snapshot.data() || {};
        return [
          userId,
          {
            id: userId,
            name: String(profile.name || 'Friend'),
            avatarUrl: String(profile.avatarUrl || ''),
            bio: String(profile.bio || ''),
            friendsCount: Array.isArray(profile.friends) ? profile.friends.length : 0,
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
      const { conversation, dateKey, sequenceNumber, isNew } = buildConversationDraft(
        user,
        chatDate
      );
      if (!user.conversations[dateKey] || isNew) {
        user.conversations[dateKey] = conversation;
        const sequences = user.conversationSequences || {};
        sequences[dateKey] = Math.max(sequences[dateKey] || 0, sequenceNumber);
        user.conversationSequences = sequences;
        next.users[next.activeUserId] = user;
        return next;
      }
      return previous;
    });
  }, [chatDate, db.activeUserId]);

  useEffect(() => {
    const maybeRunReminder = () => {
      if (!conversationsLoaded) {
        return;
      }

      const activeUserId = db.activeUserId;
      const userSnapshot = db.users[activeUserId];
      if (!activeUserId || !userSnapshot) {
        return;
      }

      const profile = userSnapshot.profile || buildDefaultProfile();
      if (!isCheckInWindowOpen(profile.checkInTime)) {
        return;
      }

      const today = toIsoDate();
      const { conversation: draftConversation, dateKey, sequenceNumber } = buildConversationDraft(
        userSnapshot,
        today
      );

      if (draftConversation.ended || draftConversation.checkInPrompted) {
        return;
      }

      draftConversation.date = dateKey;
      draftConversation.startDate = dateKey;
      draftConversation.sequenceNumber = sequenceNumber;
      draftConversation.messages.push({
        id: randomId(),
        sender: 'assistant',
        text: `Hi ${profile.name}, how was your day today?`,
        createdAt: new Date().toISOString(),
        moodLabel: null,
        moodScore: null,
      });
      draftConversation.checkInPrompted = true;

      setDb((previous) => {
        const next = clone(previous);
        const user = next.users[next.activeUserId];
        if (!user) {
          return previous;
        }
        user.conversations[dateKey] = draftConversation;
        const sequences = user.conversationSequences || {};
        sequences[dateKey] = Math.max(sequences[dateKey] || 0, draftConversation.sequenceNumber || 1);
        user.conversationSequences = sequences;
        next.users[next.activeUserId] = user;
        return next;
      });

      if (
        profile.notificationEnabled &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted'
      ) {
        new Notification('DayPulse check-in', {
          body: `Hi ${profile.name}, your daily check-in is ready.`,
        });
      }

      const conversationRef = getConversationDocumentRef(activeUserId, draftConversation.conversationId);
      void setDoc(conversationRef, draftConversation).catch(() => {
        setSyncError('Cannot deliver your automated reminder. Check database rules/permissions.');
      });
    };

    maybeRunReminder();
    const timer = setInterval(maybeRunReminder, REMINDER_POLL_MS);
    return () => clearInterval(timer);
  }, [db.activeUserId, db.users, activeProfile.checkInTime, activeProfile.name, conversationsLoaded]);

  const sendMessage = (customText) => {
    const text = String(customText ?? draft).trim();
    if (!text || conversation.ended || !conversationsLoaded) {
      return;
    }

    setDraft('');

    const activeUserId = db.activeUserId;
    const userSnapshot = db.users[activeUserId];
    if (!activeUserId || !userSnapshot) {
      return;
    }

    const profile = userSnapshot.profile || buildDefaultProfile();
    const { conversation: draftConversation, dateKey, sequenceNumber } = buildConversationDraft(
      userSnapshot,
      chatDate
    );

    draftConversation.date = dateKey;
    draftConversation.startDate = dateKey;
    draftConversation.sequenceNumber = sequenceNumber;

    const mood = scoreMood(text);

    draftConversation.messages.push({
      id: randomId(),
      sender: 'user',
      text,
      moodLabel: mood.label,
      moodScore: mood.score,
      createdAt: new Date().toISOString(),
    });

    const userTurns = draftConversation.messages.filter((message) => message.sender === 'user').length;

    draftConversation.messages.push({
      id: randomId(),
      sender: 'assistant',
      text: buildAiReply({
        userName: profile.name,
        userText: text,
        moodLabel: mood.label,
        userTurns,
      }),
      moodLabel: null,
      moodScore: null,
      createdAt: new Date().toISOString(),
    });

    draftConversation.checkInPrompted = true;
    updateConversationMood(draftConversation);

    setDb((previous) => {
      const next = clone(previous);
      const user = next.users[next.activeUserId];
      if (!user) {
        return previous;
      }
      user.conversations[dateKey] = draftConversation;
      const sequences = user.conversationSequences || {};
      sequences[dateKey] = Math.max(sequences[dateKey] || 0, draftConversation.sequenceNumber || 1);
      user.conversationSequences = sequences;
      next.users[next.activeUserId] = user;
      return next;
    });

    const conversationRef = getConversationDocumentRef(activeUserId, draftConversation.conversationId);
    void setDoc(conversationRef, draftConversation).catch(() => {
      setSyncError('Cannot save your conversation right now. Check database rules/permissions.');
    });
  };

  const endConversation = () => {
    if (conversation.ended || !conversationsLoaded) {
      return;
    }

    const activeUserId = db.activeUserId;
    const userSnapshot = db.users[activeUserId];
    if (!activeUserId || !userSnapshot) {
      return;
    }

    const profile = userSnapshot.profile || buildDefaultProfile();
    const { conversation: draftConversation, dateKey, sequenceNumber } = buildConversationDraft(
      userSnapshot,
      chatDate
    );

    draftConversation.date = dateKey;
    draftConversation.startDate = dateKey;
    draftConversation.sequenceNumber = sequenceNumber;
    draftConversation.ended = true;
    draftConversation.endedAt = new Date().toISOString();
    draftConversation.messages.push({
      id: randomId(),
      sender: 'assistant',
      text: `Nice check-in today, ${profile.name}. I will ask again at ${profile.checkInTime} tomorrow.`,
      moodLabel: null,
      moodScore: null,
      createdAt: new Date().toISOString(),
    });

    setDb((previous) => {
      const next = clone(previous);
      const user = next.users[next.activeUserId];
      if (!user) {
        return previous;
      }
      user.conversations[dateKey] = draftConversation;
      const sequences = user.conversationSequences || {};
      sequences[dateKey] = Math.max(sequences[dateKey] || 0, draftConversation.sequenceNumber || 1);
      user.conversationSequences = sequences;
      next.users[next.activeUserId] = user;
      return next;
    });

    const conversationRef = getConversationDocumentRef(activeUserId, draftConversation.conversationId);
    void setDoc(conversationRef, draftConversation).catch(() => {
      setSyncError('Cannot close your conversation right now. Check database rules/permissions.');
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

    let bucketSnapshot = null;
    setDb((previous) => {
      const next = clone(previous);
      const user = next.users[next.activeUserId];
      if (!user) {
        return previous;
      }
      if (!user.dates || typeof user.dates !== 'object') {
        user.dates = {};
      }
      const bucket = ensureDateBucket(user.dates, entry.date);
      const existingEntries = Array.isArray(bucket.diaries) ? bucket.diaries : [];
      bucket.diaries = sortDiaryEntries([entry, ...existingEntries]).filter(
        (diary) => diary.date === entry.date
      );
      bucketSnapshot = buildDefaultDateBucket(bucket);
      return next;
    });

    if (bucketSnapshot && activeUser.id) {
      void persistDateBucket(activeUser.id, entry.date, bucketSnapshot).catch(() => {
        setSyncError('Cannot save your diary entry to Firestore. Check database rules/permissions.');
      });
    }

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
    if (challengeCompleted || !activeUser.id) {
      return;
    }

    const previousCompleted = Array.isArray(activeProfile.completedChallenges)
      ? activeProfile.completedChallenges
      : [];
    const nextCompleted = uniqueStrings([...previousCompleted, todayIso]);

    setDb((previous) => {
      const next = clone(previous);
      const user = next.users[next.activeUserId];
      if (!user) {
        return previous;
      }
      const profile = user.profile || buildDefaultProfile();
      profile.completedChallenges = nextCompleted;
      user.profile = profile;
      return next;
    });

    void updateDoc(getUserDocumentRef(activeUser.id), {
      completedChallenges: nextCompleted,
    }).catch(() => {
      setSyncError('Cannot save your challenge progress. Check Firestore rules/permissions.');
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

    const bucketsToPersist = [];
    setDb((previous) => {
      const next = clone(previous);
      const user = next.users[next.activeUserId];
      if (!user) {
        return previous;
      }
      if (!user.dates || typeof user.dates !== 'object') {
        return previous;
      }

      Object.entries(user.dates).forEach(([dateKey, bucket]) => {
        if (!bucket || !Array.isArray(bucket.diaries)) {
          return;
        }
        const filtered = bucket.diaries.filter((entry) => String(entry?.id) !== String(entryId));
        if (filtered.length !== bucket.diaries.length) {
          bucket.diaries = filtered;
          bucketsToPersist.push({ dateKey, bucket: buildDefaultDateBucket(bucket) });
        }
      });
      return next;
    });

    if (bucketsToPersist.length && activeUser.id) {
      bucketsToPersist.forEach(({ dateKey, bucket }) => {
        void persistDateBucket(activeUser.id, dateKey, bucket).catch(() => {
          setSyncError('Cannot delete this diary entry in Firestore. Check database rules/permissions.');
        });
      });
    }
  };

  const savePreferences = () => {
    const cleanTime = /^([01]\d|2[0-3]):([0-5]\d)$/.test(settingsTime)
      ? settingsTime
      : '20:00';

    if (!activeUser.id) {
      return;
    }

    const cleanName = settingsName.trim() || 'Friend';
    const cleanBio = settingsBio.trim().slice(0, 240);
    const cleanAvatar = settingsAvatarUrl.trim();
    const cleanNotification = Boolean(settingsNotificationEnabled);

    setDb((previous) => {
      const next = clone(previous);
      const user = next.users[next.activeUserId];
      if (!user) {
        return previous;
      }
      const profile = user.profile || buildDefaultProfile();
      profile.name = cleanName;
      profile.bio = cleanBio;
      profile.avatarUrl = cleanAvatar;
      profile.checkInTime = cleanTime;
      profile.notificationEnabled = cleanNotification;
      const fallbackEmail = String(profile.email || authUser.email || '');
      profile.email = fallbackEmail;
      profile.emailLower = fallbackEmail.toLowerCase();
      user.profile = profile;
      return next;
    });

    const fallbackEmail = String(activeProfile.email || authUser.email || '');
    const emailLower = fallbackEmail.toLowerCase();

    void updateDoc(getUserDocumentRef(activeUser.id), {
      name: cleanName,
      bio: cleanBio,
      avatarUrl: cleanAvatar,
      checkInTime: cleanTime,
      notificationEnabled: cleanNotification,
      email: fallbackEmail,
      emailLower,
    }).catch(() => {
      setSyncError('Cannot save your preferences. Check Firestore rules/permissions.');
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

    const snapshot = await getDoc(getUserDocumentRef(trimmed));
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

      await updateDoc(getUserDocumentRef(activeUser.id), {
        friendRequestsOutgoing: arrayUnion(targetId),
      });
      await updateDoc(getUserDocumentRef(targetId), {
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
      await updateDoc(getUserDocumentRef(activeUser.id), {
        friendRequestsIncoming: arrayRemove(requesterId),
        friends: arrayUnion(requesterId),
      });

      await updateDoc(getUserDocumentRef(requesterId), {
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
      await updateDoc(getUserDocumentRef(activeUser.id), {
        friendRequestsIncoming: arrayRemove(requesterId),
      });
      await updateDoc(getUserDocumentRef(requesterId), {
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
      await updateDoc(getUserDocumentRef(activeUser.id), {
        friends: arrayRemove(friendId),
      });
      await updateDoc(getUserDocumentRef(friendId), {
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
      authorName: activeProfile.name,
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
      authorName: activeProfile.name,
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
    if (!postId || !activeUser.id) {
      return;
    }

    const currentHidden = Array.isArray(activeProfile.hiddenPostIds)
      ? activeProfile.hiddenPostIds
      : [];
    const nextHiddenIds = currentHidden.includes(postId)
      ? currentHidden.filter((id) => id !== postId)
      : uniqueStrings([...currentHidden, postId]);

    setDb((previous) => {
      const next = clone(previous);
      const user = next.users[next.activeUserId];
      if (!user) {
        return previous;
      }
      const profile = user.profile || buildDefaultProfile();
      profile.hiddenPostIds = nextHiddenIds;
      user.profile = profile;
      return next;
    });

    void updateDoc(getUserDocumentRef(activeUser.id), {
      hiddenPostIds: nextHiddenIds,
    }).catch(() => {
      setSyncError('Cannot update your hidden post list. Check Firestore rules/permissions.');
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
            activeUserEmail={activeProfile.email}
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
