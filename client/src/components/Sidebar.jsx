const TABS = ['chat', 'diary', 'dashboard', 'settings'];

function Sidebar({ activeUser, reminderText, tab, setTab }) {
  return (
    <aside className="left-panel">
      <h1 className="brand">DayPulse AI</h1>
      <p className="brand-sub">
        Personal check-in chatbot UI with local database, analytics dashboard, and time-based prompts.
      </p>

      <div className="user-card">
        <p className="muted">Active user</p>
        <h2>{activeUser.name}</h2>
        <p className="mono">{activeUser.id}</p>
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
    </aside>
  );
}

export default Sidebar;
