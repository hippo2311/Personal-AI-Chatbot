import { useState } from 'react';

const REACTION_LABELS = {
  support: 'Support',
  celebrate: 'Celebrate',
  care: 'Care',
};

function getInitial(name) {
  const text = String(name || '').trim();
  return text ? text.charAt(0).toUpperCase() : 'U';
}

function resolvePhotoSrc(photo) {
  return photo?.src || photo?.url || photo?.dataUrl || photo?.previewUrl || '';
}

function CommunityWallPage({
  activeUser,
  wallDraft,
  setWallDraft,
  wallAnonymous,
  setWallAnonymous,
  wallVisibility,
  setWallVisibility,
  wallTagsDraft,
  setWallTagsDraft,
  wallSearchQuery,
  setWallSearchQuery,
  wallSearchTag,
  setWallSearchTag,
  wallScopeFilter,
  setWallScopeFilter,
  allWallTags,
  wallPhotos,
  wallPhotoError,
  wallComposeError,
  handleWallPhotoSelect,
  removeSelectedWallPhoto,
  createWallPost,
  wallPosts,
  toggleWallReaction,
  wallCommentDrafts,
  setWallCommentDraft,
  addWallComment,
  hiddenPostIds,
  toggleHideWallPost,
  reportWallPost,
  authorProfiles,
  friendIds,
  incomingFriendRequests,
  outgoingFriendRequests,
  sendFriendRequest,
  acceptFriendRequest,
  formatTime,
}) {
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const safeWallTags = Array.isArray(allWallTags) ? allWallTags : [];
  const safeWallPosts = Array.isArray(wallPosts) ? wallPosts : [];
  const safeHiddenPostIds = Array.isArray(hiddenPostIds) ? hiddenPostIds : [];
  const safeFriendIds = Array.isArray(friendIds) ? friendIds : [];
  const safeIncomingRequests = Array.isArray(incomingFriendRequests)
    ? incomingFriendRequests
    : [];
  const safeOutgoingRequests = Array.isArray(outgoingFriendRequests)
    ? outgoingFriendRequests
    : [];

  const openPhotoViewer = (photo, post) => {
    const src = resolvePhotoSrc(photo);
    if (!src) {
      return;
    }

    setSelectedPhoto({
      src,
      name: photo?.name || 'Photo',
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
          <p>Share one good thing, connect with friends, and support the community.</p>
        </div>
      </div>

      <div className="wall-layout">
        <div className="wall-compose-column">
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
              Tags (comma separated)
              <input
                type="text"
                value={wallTagsDraft}
                onChange={(event) => setWallTagsDraft(event.target.value)}
                placeholder="gratitude, study, family"
              />
            </label>

            <div className="wall-compose-grid">
              <label className="wall-field">
                Visibility
                <select
                  value={wallVisibility}
                  onChange={(event) => setWallVisibility(event.target.value)}
                >
                  <option value="public">Public</option>
                  <option value="friends">Friends only</option>
                </select>
              </label>

              <label className="wall-field">
                Upload photos
                <input type="file" accept="image/*" multiple onChange={handleWallPhotoSelect} />
              </label>
            </div>

            {wallPhotoError && <p className="error-text">{wallPhotoError}</p>}
            {wallComposeError && <p className="error-text">{wallComposeError}</p>}

            {wallPhotos.length > 0 && (
              <div className="selected-photo-list wall-selected-photos">
                {wallPhotos.map((photo) => (
                  <article key={photo.id} className="selected-photo-item">
                    <img src={resolvePhotoSrc(photo)} alt={photo.name} />
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

          <div className="card wall-filter-card">
            <h3>Search & Filter</h3>
            <div className="wall-filter-grid">
              <label className="wall-field">
                Keyword
                <input
                  type="text"
                  value={wallSearchQuery}
                  onChange={(event) => setWallSearchQuery(event.target.value)}
                  placeholder="Search posts or comments"
                />
              </label>

              <label className="wall-field">
                Scope
                <select
                  value={wallScopeFilter}
                  onChange={(event) => setWallScopeFilter(event.target.value)}
                >
                  <option value="all">All visible</option>
                  <option value="public">Public only</option>
                  <option value="friends">Friends circle only</option>
                  <option value="mine">My posts</option>
                  <option value="hidden">Hidden posts</option>
                </select>
              </label>

              <label className="wall-field">
                Tag
                <select value={wallSearchTag} onChange={(event) => setWallSearchTag(event.target.value)}>
                  <option value="">All tags</option>
                  {safeWallTags.map((tag) => (
                    <option key={tag} value={tag}>
                      #{tag}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </div>

        <div className="wall-feed-column">
          <div className="wall-list">
            {safeWallPosts.length === 0 && (
              <div className="card">
                <p className="muted">No matching posts. Try a different filter or share your first post.</p>
              </div>
            )}

            {safeWallPosts.map((post) => {
              const profile = authorProfiles[post.authorId] || {};
              const isMine = post.authorId === activeUser.id;
              const isHidden = safeHiddenPostIds.includes(post.id);
              const isFriend = safeFriendIds.includes(post.authorId);
              const hasIncomingRequest = safeIncomingRequests.includes(post.authorId);
              const hasOutgoingRequest = safeOutgoingRequests.includes(post.authorId);

              return (
                <article key={post.id} className="card wall-post">
                  <header className="wall-post-header">
                    <div className="wall-author">
                      <div className="wall-avatar">
                        {post.anonymous
                          ? getInitial('Anonymous')
                          : profile.avatarUrl
                            ? <img src={profile.avatarUrl} alt={post.authorName} className="wall-avatar-img" />
                            : getInitial(post.authorName)}
                      </div>

                      <div>
                        <strong>{post.anonymous ? 'Anonymous' : post.authorName}</strong>
                        {!post.anonymous && profile.bio && (
                          <p className="muted wall-author-bio">{profile.bio}</p>
                        )}
                      </div>
                    </div>

                    <div className="wall-post-meta">
                      <span className="mono">{formatTime(post.createdAt)}</span>
                      <span className="friend-pill">{post.visibility === 'friends' ? 'Friends' : 'Public'}</span>
                    </div>
                  </header>

                  {post.text && <p className="wall-post-text">{post.text}</p>}

                  {Array.isArray(post.tags) && post.tags.length > 0 && (
                    <div className="wall-tags-row">
                      {post.tags.map((tag) => (
                        <button key={`${post.id}-${tag}`} className="wall-tag-chip" onClick={() => setWallSearchTag(tag)}>
                          #{tag}
                        </button>
                      ))}
                    </div>
                  )}

                  {Array.isArray(post.photos) && post.photos.length > 0 && (
                    <div className={`wall-media-grid wall-media-${Math.min(post.photos.length, 4)}`}>
                      {post.photos.map((photo) => (
                        <button
                          key={photo.id}
                          className="photo-thumb-btn wall-photo-btn"
                          onClick={() => openPhotoViewer(photo, post)}
                        >
                          <img src={resolvePhotoSrc(photo)} alt={photo.name || post.text || 'Wall photo'} />
                        </button>
                      ))}
                    </div>
                  )}

                  {!post.anonymous && !isMine && post.authorId && (
                    <div className="friend-row-inline">
                      {isFriend && <span className="friend-pill">Friend</span>}
                      {!isFriend && hasOutgoingRequest && <span className="friend-pill">Requested</span>}
                      {!isFriend && hasIncomingRequest && (
                        <button className="ghost-btn" onClick={() => acceptFriendRequest(post.authorId)}>
                          Accept friend request
                        </button>
                      )}
                      {!isFriend && !hasIncomingRequest && !hasOutgoingRequest && (
                        <button className="ghost-btn" onClick={() => sendFriendRequest(post.authorId)}>
                          Add friend
                        </button>
                      )}
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

                    <button className="ghost-btn" onClick={() => toggleHideWallPost(post.id)}>
                      {isHidden ? 'Unhide' : 'Hide'}
                    </button>
                    <button className="delete-btn" onClick={() => reportWallPost(post.id)}>
                      Report
                    </button>
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
              );
            })}
          </div>
        </div>
      </div>

      {selectedPhoto && (
        <div className="photo-viewer-backdrop" onClick={closePhotoViewer} role="presentation">
          <article className="photo-viewer" onClick={(event) => event.stopPropagation()}>
            <button className="photo-viewer-close" onClick={closePhotoViewer}>
              Close
            </button>
            <img src={selectedPhoto.src} alt={selectedPhoto.name} />
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
