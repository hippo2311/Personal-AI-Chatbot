import { useState } from 'react';

const REACTION_LABELS = {
  support: 'Support',
  celebrate: 'Celebrate',
  care: 'Care',
};

function CommunityWallPage({
  activeUser,
  wallDraft,
  setWallDraft,
  wallAnonymous,
  setWallAnonymous,
  wallPhotos,
  wallPhotoError,
  handleWallPhotoSelect,
  removeSelectedWallPhoto,
  createWallPost,
  wallPosts,
  toggleWallReaction,
  wallCommentDrafts,
  setWallCommentDraft,
  addWallComment,
  formatTime,
}) {
  const [selectedPhoto, setSelectedPhoto] = useState(null);

  const openPhotoViewer = (photo, post) => {
    if (!photo?.dataUrl) {
      return;
    }
    setSelectedPhoto({
      dataUrl: photo.dataUrl,
      name: photo.name || 'Photo',
      authorName: post?.anonymous ? 'Anonymous' : post?.authorName || '',
      createdAt: post?.createdAt || '',
      postText: post?.text || '',
    });
  };

  const closePhotoViewer = () => {
    setSelectedPhoto(null);
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Public Gratitude Wall</h2>
          <p>Share one good thing with the community and support others.</p>
        </div>
      </div>

      <div className="card wall-create-card">
        <h3>Share A Good Thing</h3>
        <label className="wall-field">
          Good thing
          <textarea
            value={wallDraft}
            onChange={(event) => setWallDraft(event.target.value)}
            placeholder="What positive thing happened today?"
          />
        </label>

        <label className="wall-field">
          Upload photos
          <input type="file" accept="image/*" multiple onChange={handleWallPhotoSelect} />
        </label>

        {wallPhotoError && <p className="error-text">{wallPhotoError}</p>}

        {wallPhotos.length > 0 && (
          <div className="selected-photo-list wall-selected-photos">
            {wallPhotos.map((photo) => (
              <article key={photo.id} className="selected-photo-item">
                <img src={photo.dataUrl} alt={photo.name} />
                <button className="delete-btn" onClick={() => removeSelectedWallPhoto(photo.id)}>
                  Remove
                </button>
              </article>
            ))}
          </div>
        )}

        <label className="wall-anon-toggle">
          <input
            type="checkbox"
            checked={wallAnonymous}
            onChange={(event) => setWallAnonymous(event.target.checked)}
          />
          Post anonymously
        </label>

        <button onClick={createWallPost}>Share To Wall</button>
      </div>

      <div className="wall-list">
        {wallPosts.length === 0 && (
          <div className="card">
            <p className="muted">No shared posts yet. Be the first one to post a good thing.</p>
          </div>
        )}

        {wallPosts.map((post) => (
          <article key={post.id} className="card wall-post">
            <header className="wall-post-header">
              <strong>{post.anonymous ? 'Anonymous' : post.authorName}</strong>
              <span className="mono">{formatTime(post.createdAt)}</span>
            </header>

            {post.text && <p className="wall-post-text">{post.text}</p>}

            {Array.isArray(post.photos) && post.photos.length > 0 && (
              <div className={`wall-media-grid wall-media-${Math.min(post.photos.length, 4)}`}>
                {post.photos.map((photo) => (
                  <button
                    key={photo.id}
                    className="photo-thumb-btn wall-photo-btn"
                    onClick={() => openPhotoViewer(photo, post)}
                  >
                    <img src={photo.dataUrl} alt={photo.name || post.text || 'Wall photo'} />
                  </button>
                ))}
              </div>
            )}

            <div className="wall-reactions">
              {Object.entries(REACTION_LABELS).map(([reactionKey, label]) => {
                const users = post.reactions[reactionKey] || [];
                const isActive = users.includes(activeUser.id);
                return (
                  <button
                    key={reactionKey}
                    className={`reaction-btn ${isActive ? 'active' : ''}`}
                    onClick={() => toggleWallReaction(post.id, reactionKey)}
                  >
                    {label} ({users.length})
                  </button>
                );
              })}
            </div>

            <div className="wall-comment-compose">
              <input
                type="text"
                value={wallCommentDrafts[post.id] || ''}
                onChange={(event) => setWallCommentDraft(post.id, event.target.value)}
                placeholder="Leave a supportive comment..."
              />
              <button onClick={() => addWallComment(post.id)}>Comment</button>
            </div>

            <div className="wall-comments">
              {post.comments.length === 0 && <p className="muted">No comments yet.</p>}
              {post.comments.map((comment) => (
                <div key={comment.id} className="wall-comment-item">
                  <header>
                    <strong>{comment.authorName}</strong>
                    <span className="mono">{formatTime(comment.createdAt)}</span>
                  </header>
                  <p>{comment.text}</p>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>

      {selectedPhoto && (
        <div className="photo-viewer-backdrop" onClick={closePhotoViewer} role="presentation">
          <article className="photo-viewer" onClick={(event) => event.stopPropagation()}>
            <button className="photo-viewer-close" onClick={closePhotoViewer}>
              Close
            </button>
            <img src={selectedPhoto.dataUrl} alt={selectedPhoto.name} />
            <p>
              {selectedPhoto.authorName ? `${selectedPhoto.authorName}` : ''}
              {selectedPhoto.createdAt ? ` • ${formatTime(selectedPhoto.createdAt)}` : ''}
            </p>
            {selectedPhoto.postText && <p>{selectedPhoto.postText}</p>}
          </article>
        </div>
      )}
    </section>
  );
}

export default CommunityWallPage;
