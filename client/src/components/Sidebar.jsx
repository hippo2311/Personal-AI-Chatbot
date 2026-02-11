const TABS = ['chat', 'diary', 'graph', 'community', 'dashboard', 'settings'];

function resolveMoodTone(moodLabel) {
  if (moodLabel === 'great' || moodLabel === 'good') {
    return 'happy';
  }
  if (moodLabel === 'low' || moodLabel === 'tough') {
    return 'sad';
  }
  return 'neutral';
}

function getMoodSummary(tone) {
  if (tone === 'happy') {
    return 'Mood now: positive';
  }
  if (tone === 'sad') {
    return 'Mood now: low';
  }
  return 'Mood now: steady';
}

function Sidebar({ activeUser, reminderText, tab, setTab, onLogout, currentMoodLabel }) {
  const profile = activeUser?.profile || {};
  const moodTone = resolveMoodTone(currentMoodLabel);
  return (
    <aside className="left-panel">
      <h1 className="brand">DayPulse AI</h1>
      <p className="brand-sub">
        Personal check-in chatbot with Firebase sync, analytics dashboard, and time-based prompts.
      </p>

      <div className="user-card">
        <p className="muted">Active user</p>
        <h2>{profile.name || 'Friend'}</h2>
        <div className={`user-mood-chip mood-${moodTone}`}>
          <span className="user-mood-dot" aria-hidden />
          <span>{getMoodSummary(moodTone)}</span>
        </div>
        <p className="status">{reminderText}</p>
      </div>

      <nav className="tabs">
        {TABS.map((tabId) => (
          <button
            key={tabId}
            className={`tab-btn ${tab === tabId ? 'active' : ''}`}
            onClick={() => setTab(tabId)}
          >
            {tabId}
          </button>
        ))}
      </nav>

      <button className="logout-btn" onClick={onLogout}>Logout</button>
    </aside>
  );
}

export default Sidebar;
