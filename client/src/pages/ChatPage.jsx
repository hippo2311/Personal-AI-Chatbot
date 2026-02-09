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
}) {
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

      <div className="chat-meta">
        <span className={`mood-chip mood-${conversation.moodLabel}`}>
          Mood: {moodMeta[conversation.moodLabel]?.marker} {moodMeta[conversation.moodLabel]?.label}
        </span>
        <span className="mood-chip">Date: {formatDate(chatDate)}</span>
        <span className="mood-chip">Status: {conversation.ended ? 'Closed' : 'Open'}</span>
      </div>

      <div className="messages">
        {conversation.messages.length === 0 && (
          <div className="empty-state">
            <p>No messages yet.</p>
            <p>Wait for {activeUser.checkInTime} or start now by sending your first message.</p>
          </div>
        )}

        {conversation.messages.map((message) => (
          <article
            key={message.id}
            className={`message ${message.sender === 'assistant' ? 'assistant' : 'user'}`}
          >
            <header>
              <strong>{message.sender === 'assistant' ? 'AI' : activeUser.name}</strong>
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
