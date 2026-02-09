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
                <button
                  className="delete-btn"
                  onClick={() => removeDiaryEntry(entry.id)}
                >
                  Delete
                </button>
              </header>
              <h4>{entry.title}</h4>
              {entry.details && <p>{entry.details}</p>}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export default DiaryPage;
