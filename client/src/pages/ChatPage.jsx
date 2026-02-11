import ReadyPlayerMoodAvatar from '../components/ReadyPlayerMoodAvatar.jsx';

function ChatPage({
  activeUser,
  chatDate,
  setChatDate,
  conversation,
  draft,
  setDraft,
  sendMessage,
  endConversation,
  quickReplies,
  formatDate,
  formatTime,
  moodMeta,
  currentMoodLabel = 'neutral',
  avatarModelUrl = '',
}) {
  const profile = activeUser?.profile || {};
  const moodLabel = currentMoodLabel || conversation?.moodLabel || 'neutral';
  const moodDetails = moodMeta[moodLabel] || { marker: 'NEU', label: 'Neutral' };
  const lastMessage = conversation.messages[conversation.messages.length - 1];
  const lastUpdateTime = lastMessage ? formatTime(lastMessage.createdAt) : null;
  const moodHelperText = conversation.messages.length === 0
    ? `No messages yet. Start a check-in to animate today's avatar.`
    : conversation.ended
    ? `Ended at ${lastUpdateTime || '--:--'}. Come back tomorrow for a fresh prompt at ${profile.checkInTime || '20:00'}.`
    : `Last update at ${lastUpdateTime || '--:--'}. Share one more detail to refine today's mood.`;
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Daily Chat</h2>
          <p>AI asks about your day and responds based on mood.</p>
        </div>
        <input
          className="date-input"
          type="date"
          value={chatDate}
          onChange={(event) => setChatDate(event.target.value)}
        />
      </div>

      <div className="mood-face-row">
        <ReadyPlayerMoodAvatar moodLabel={moodLabel} avatarModelUrl={avatarModelUrl} />
        <div className="mood-face-copy">
          <h3>
            {moodDetails.marker} {moodDetails.label}
          </h3>
          <p>{moodHelperText}</p>
        </div>
      </div>

      <div className="chat-meta">
        <span className={`mood-chip mood-${moodLabel}`}>
          Mood: {moodDetails.marker} {moodDetails.label}
        </span>
        <span className="mood-chip">Date: {formatDate(chatDate)}</span>
        <span className="mood-chip">Status: {conversation.ended ? 'Closed' : 'Open'}</span>
      </div>

      <div className="messages">
        {conversation.messages.length === 0 && (
          <div className="empty-state">
            <p>No messages yet.</p>
            <p>Wait for {profile.checkInTime || '20:00'} or start now by sending your first message.</p>
          </div>
        )}

        {conversation.messages.map((message) => (
          <article
            key={message.id}
            className={`message ${message.sender === 'assistant' ? 'assistant' : 'user'}`}
          >
            <header>
              <strong>{message.sender === 'assistant' ? 'AI' : profile.name || 'You'}</strong>
              <span>{formatTime(message.createdAt)}</span>
            </header>
            <p>{message.text}</p>
            {message.sender === 'user' && message.moodLabel && (
              <span className={`tiny-mood mood-${message.moodLabel}`}>
                {moodMeta[message.moodLabel]?.marker} {moodMeta[message.moodLabel]?.label}
              </span>
            )}
          </article>
        ))}
      </div>

      <div className="quick-actions">
        {quickReplies.map((reply) => (
          <button key={reply} onClick={() => sendMessage(reply)}>
            {reply}
          </button>
        ))}
      </div>

      <div className="composer">
        <input
          type="text"
          placeholder="Tell AI about your day..."
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              sendMessage();
            }
          }}
          disabled={conversation.ended}
        />
        <button onClick={() => sendMessage()} disabled={conversation.ended}>
          Send
        </button>
        <button className="ghost" onClick={endConversation} disabled={conversation.ended}>
          End today's conversation
        </button>
      </div>
    </section>
  );
}

export default ChatPage;
