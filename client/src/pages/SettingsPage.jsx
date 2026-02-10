function SettingsPage({
  activeUserId,
  activeUserEmail,
  settingsName,
  setSettingsName,
  settingsBio,
  setSettingsBio,
  settingsAvatarUrl,
  setSettingsAvatarUrl,
  settingsTime,
  setSettingsTime,
  settingsNotificationEnabled,
  setSettingsNotificationEnabled,
  notificationPermission,
  requestNotificationPermission,
  friendIdentifier,
  setFriendIdentifier,
  sendFriendRequest,
  friendMessage,
  friendError,
  incomingRequestProfiles,
  outgoingRequestProfiles,
  friendProfiles,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriend,
  savePreferences,
}) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Settings</h2>
          <p>Profile, reminders, notifications, and friend management.</p>
        </div>
      </div>

      <div className="split-grid">
        <div className="card">
          <h3>Profile & Reminder</h3>
          <div className="form-grid">
            <label>
              User ID (Firebase UID)
              <input type="text" value={activeUserId} readOnly />
            </label>

            <label>
              Email
              <input type="text" value={activeUserEmail || ''} readOnly />
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
              Bio (public profile)
              <textarea
                value={settingsBio}
                onChange={(event) => setSettingsBio(event.target.value)}
                placeholder="A short intro for your public profile"
              />
            </label>

            <label>
              Avatar URL (optional)
              <input
                type="text"
                value={settingsAvatarUrl}
                onChange={(event) => setSettingsAvatarUrl(event.target.value)}
                placeholder="https://..."
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

            <label className="settings-checkbox-row">
              <input
                type="checkbox"
                checked={settingsNotificationEnabled}
                onChange={(event) => setSettingsNotificationEnabled(event.target.checked)}
              />
              Enable browser notification when check-in opens
            </label>

            <p className="muted">Notification permission: {notificationPermission}</p>
            <button className="ghost-btn" onClick={requestNotificationPermission}>
              Request Notification Permission
            </button>

            <button onClick={savePreferences}>Save Preferences</button>
          </div>
        </div>

        <div className="card">
          <h3>Friends</h3>
          <div className="friend-add-row">
            <input
              type="text"
              value={friendIdentifier}
              onChange={(event) => setFriendIdentifier(event.target.value)}
              placeholder="Friend UID or email"
            />
            <button onClick={() => sendFriendRequest(friendIdentifier)}>Send Request</button>
          </div>

          {friendError && <p className="error-text">{friendError}</p>}
          {friendMessage && <p className="success-text">{friendMessage}</p>}

          <h4>Incoming Requests</h4>
          {incomingRequestProfiles.length === 0 && (
            <p className="muted">No incoming requests.</p>
          )}
          <div className="friend-list">
            {incomingRequestProfiles.map((profile) => (
              <article key={profile.id} className="friend-item">
                <div>
                  <strong>{profile.name}</strong>
                  <p className="mono">{profile.id}</p>
                </div>
                <div className="friend-actions">
                  <button onClick={() => acceptFriendRequest(profile.id)}>Accept</button>
                  <button className="delete-btn" onClick={() => declineFriendRequest(profile.id)}>
                    Decline
                  </button>
                </div>
              </article>
            ))}
          </div>

          <h4>Outgoing Requests</h4>
          {outgoingRequestProfiles.length === 0 && (
            <p className="muted">No outgoing requests.</p>
          )}
          <div className="friend-list">
            {outgoingRequestProfiles.map((profile) => (
              <article key={profile.id} className="friend-item">
                <div>
                  <strong>{profile.name}</strong>
                  <p className="mono">{profile.id}</p>
                </div>
                <span className="friend-pill">Requested</span>
              </article>
            ))}
          </div>

          <h4>My Friends ({friendProfiles.length})</h4>
          {friendProfiles.length === 0 && (
            <p className="muted">No friends yet.</p>
          )}
          <div className="friend-list">
            {friendProfiles.map((profile) => (
              <article key={profile.id} className="friend-item">
                <div>
                  <strong>{profile.name}</strong>
                  <p className="mono">{profile.id}</p>
                  {profile.bio && <p>{profile.bio}</p>}
                </div>
                <button className="delete-btn" onClick={() => removeFriend(profile.id)}>
                  Remove
                </button>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default SettingsPage;
