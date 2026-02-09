import { useMemo, useState } from 'react';

function formatMonthLabel(monthDate) {
  return monthDate.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

function buildCalendarCells(viewMonth, photosByDate) {
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = firstDay.getDay();
  const totalCells = Math.ceil((offset + daysInMonth) / 7) * 7;

  return Array.from({ length: totalCells }, (_, index) => {
    const dayNumber = index - offset + 1;
    if (dayNumber < 1 || dayNumber > daysInMonth) {
      return { key: `empty-${index}`, isEmpty: true };
    }

    const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;
    return {
      key: dateKey,
      isEmpty: false,
      dateKey,
      dayNumber,
      photos: photosByDate[dateKey] || [],
    };
  });
}

function DiaryPage({
  diaryStats,
  diaryDate,
  setDiaryDate,
  diaryType,
  setDiaryType,
  diaryTitle,
  setDiaryTitle,
  diaryDetails,
  setDiaryDetails,
  diaryPhotos,
  diaryPhotoError,
  handleDiaryPhotoSelect,
  removeSelectedDiaryPhoto,
  addDiaryEntry,
  diaryQuery,
  setDiaryQuery,
  diaryFilterType,
  setDiaryFilterType,
  diaryFilterDate,
  setDiaryFilterDate,
  clearDiaryFilters,
  removeDiaryEntry,
  filteredDiaryEntries,
  diaryEntries,
  diaryMeta,
  formatDate,
  formatTime,
}) {
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedPhoto, setSelectedPhoto] = useState(null);

  const photosByDate = useMemo(() => {
    const map = {};

    for (const entry of diaryEntries) {
      if (!Array.isArray(entry.photos) || entry.photos.length === 0) {
        continue;
      }

      if (!map[entry.date]) {
        map[entry.date] = [];
      }

      for (const photo of entry.photos) {
        map[entry.date].push({
          ...photo,
          entryId: entry.id,
          entryTitle: entry.title,
          entryType: entry.type,
        });
      }
    }

    return map;
  }, [diaryEntries]);

  const calendarCells = useMemo(
    () => buildCalendarCells(calendarMonth, photosByDate),
    [calendarMonth, photosByDate]
  );

  const openPhotoViewer = (photo, fallbackDate) => {
    if (!photo?.dataUrl) {
      return;
    }
    setSelectedPhoto({
      dataUrl: photo.dataUrl,
      name: photo.name || 'Photo',
      entryTitle: photo.entryTitle || '',
      date: fallbackDate || photo.date || '',
    });
  };

  const closePhotoViewer = () => {
    setSelectedPhoto(null);
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Diary Dashboard</h2>
          <p>Enter your good and bad things each day, then search them anytime.</p>
        </div>
      </div>

      <div className="diary-kpi-grid">
        <div className="kpi-card">
          <p>Total entries</p>
          <h3>{diaryStats.total}</h3>
        </div>
        <div className="kpi-card">
          <p>Good things</p>
          <h3>{diaryStats.goodCount}</h3>
        </div>
        <div className="kpi-card">
          <p>Bad things</p>
          <h3>{diaryStats.badCount}</h3>
        </div>
        <div className="kpi-card">
          <p>Uploaded photos</p>
          <h3>{diaryStats.photoCount}</h3>
        </div>
      </div>

      <div className="split-grid diary-split">
        <div className="card">
          <h3>Add diary entry</h3>

          <div className="diary-form-grid">
            <label>
              Date
              <input
                type="date"
                value={diaryDate}
                onChange={(event) => setDiaryDate(event.target.value)}
              />
            </label>

            <label>
              Type
              <select value={diaryType} onChange={(event) => setDiaryType(event.target.value)}>
                <option value="good">Good thing</option>
                <option value="bad">Bad thing</option>
              </select>
            </label>
          </div>

          <label className="diary-field">
            Title
            <input
              type="text"
              value={diaryTitle}
              onChange={(event) => setDiaryTitle(event.target.value)}
              placeholder="Short title..."
            />
          </label>

          <label className="diary-field">
            Notes
            <textarea
              value={diaryDetails}
              onChange={(event) => setDiaryDetails(event.target.value)}
              placeholder="What happened?"
            />
          </label>

          <label className="diary-field">
            Upload photos
            <input type="file" accept="image/*" multiple onChange={handleDiaryPhotoSelect} />
          </label>

          {diaryPhotoError && <p className="error-text">{diaryPhotoError}</p>}

          {diaryPhotos.length > 0 && (
            <div className="selected-photo-list">
              {diaryPhotos.map((photo) => (
                <article key={photo.id} className="selected-photo-item">
                  <img src={photo.dataUrl} alt={photo.name} />
                  <button
                    className="delete-btn"
                    onClick={() => removeSelectedDiaryPhoto(photo.id)}
                  >
                    Remove
                  </button>
                </article>
              ))}
            </div>
          )}

          <button onClick={addDiaryEntry}>Save Entry</button>
        </div>

        <div className="card">
          <h3>Search</h3>
          <div className="diary-search-grid">
            <label>
              Keyword
              <input
                type="text"
                value={diaryQuery}
                onChange={(event) => setDiaryQuery(event.target.value)}
                placeholder="Search title or notes..."
              />
            </label>

            <label>
              Type
              <select
                value={diaryFilterType}
                onChange={(event) => setDiaryFilterType(event.target.value)}
              >
                <option value="all">All types</option>
                <option value="good">Good only</option>
                <option value="bad">Bad only</option>
              </select>
            </label>

            <label>
              Date
              <input
                type="date"
                value={diaryFilterDate}
                onChange={(event) => setDiaryFilterDate(event.target.value)}
              />
            </label>

            <button className="ghost-btn" onClick={clearDiaryFilters}>
              Clear Filters
            </button>
          </div>

          <p className="muted">
            Showing {filteredDiaryEntries.length} / {diaryEntries.length} entries.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="calendar-header">
          <h3>Photo Gallery Calendar</h3>
          <div className="calendar-controls">
            <button
              className="ghost-btn"
              onClick={() =>
                setCalendarMonth(
                  (previous) => new Date(previous.getFullYear(), previous.getMonth() - 1, 1)
                )
              }
            >
              Prev
            </button>
            <strong>{formatMonthLabel(calendarMonth)}</strong>
            <button
              className="ghost-btn"
              onClick={() =>
                setCalendarMonth(
                  (previous) => new Date(previous.getFullYear(), previous.getMonth() + 1, 1)
                )
              }
            >
              Next
            </button>
          </div>
        </div>

        <div className="calendar-scroll">
          <div className="calendar-weekdays">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((weekday) => (
              <span key={weekday}>{weekday}</span>
            ))}
          </div>

          <div className="calendar-grid">
            {calendarCells.map((cell) => {
              if (cell.isEmpty) {
                return <div key={cell.key} className="calendar-day empty" />;
              }

              const overflowCount = Math.max(0, cell.photos.length - 3);
              return (
                <article key={cell.key} className="calendar-day">
                  <header>
                    <strong>{cell.dayNumber}</strong>
                    <span>{cell.photos.length ? `${cell.photos.length} photo(s)` : ''}</span>
                  </header>
                  <div className="calendar-photo-strip">
                    {cell.photos.slice(0, 3).map((photo) => (
                      <button
                        key={photo.id}
                        className="photo-thumb-btn"
                        onClick={() => openPhotoViewer(photo, cell.dateKey)}
                      >
                        <img src={photo.dataUrl} alt={photo.entryTitle || photo.name} />
                      </button>
                    ))}
                    {overflowCount > 0 && (
                      <button
                        className="more-photos"
                        onClick={() => openPhotoViewer(cell.photos[3], cell.dateKey)}
                      >
                        +{overflowCount}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Entries</h3>
        {diaryEntries.length === 0 && (
          <p className="muted">No entries yet. Add your first good or bad thing above.</p>
        )}
        {diaryEntries.length > 0 && filteredDiaryEntries.length === 0 && (
          <p className="muted">No entries match your search filters.</p>
        )}

        <div className="diary-list">
          {filteredDiaryEntries.map((entry) => (
            <article key={entry.id} className="diary-item">
              <header className="diary-item-header">
                <div className="diary-item-meta">
                  <span className={`diary-type-chip diary-${entry.type}`}>
                    {diaryMeta[entry.type].marker} {diaryMeta[entry.type].label}
                  </span>
                  <span className="mono">
                    {formatDate(entry.date)} at {formatTime(entry.createdAt)}
                  </span>
                </div>
                <button className="delete-btn" onClick={() => removeDiaryEntry(entry.id)}>
                  Delete
                </button>
              </header>
              <h4>{entry.title}</h4>
              {entry.details && <p>{entry.details}</p>}
              {Array.isArray(entry.photos) && entry.photos.length > 0 && (
                <div className="entry-photo-grid">
                  {entry.photos.map((photo) => (
                    <button
                      key={photo.id}
                      className="photo-thumb-btn"
                      onClick={() =>
                        openPhotoViewer(
                          {
                            ...photo,
                            entryTitle: entry.title,
                            date: entry.date,
                          },
                          entry.date
                        )
                      }
                    >
                      <img src={photo.dataUrl} alt={photo.name || entry.title} />
                    </button>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      </div>

      {selectedPhoto && (
        <div
          className="photo-viewer-backdrop"
          onClick={closePhotoViewer}
          role="presentation"
        >
          <article className="photo-viewer" onClick={(event) => event.stopPropagation()}>
            <button className="photo-viewer-close" onClick={closePhotoViewer}>
              Close
            </button>
            <img src={selectedPhoto.dataUrl} alt={selectedPhoto.name || selectedPhoto.entryTitle} />
            <p>
              {selectedPhoto.entryTitle || selectedPhoto.name}
              {selectedPhoto.date ? ` • ${formatDate(selectedPhoto.date)}` : ''}
            </p>
          </article>
        </div>
      )}
    </section>
  );
}

export default DiaryPage;
