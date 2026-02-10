function SettingsPage({
  activeUserId,
  settingsName,
  setSettingsName,
  settingsTime,
  setSettingsTime,
  savePreferences,
}) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Settings</h2>
          <p>Set user profile and daily reminder time.</p>
        </div>
      </div>

      <div className="form-grid">
        <label>
          User ID (Firebase UID)
          <input type="text" value={activeUserId} readOnly />
        </label>

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
          <li>Cloud sync with Firebase Auth and Firestore per user.</li>
        </ul>
      </div>
    </section>
  );
}

export default SettingsPage;
