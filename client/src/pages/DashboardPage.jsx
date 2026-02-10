function DashboardPage({
  dashboard,
  activeUser,
  moodMeta,
  formatDate,
  dailyChallenge,
  challengeCompleted,
  diaryStreakDays,
  friendCount,
  wallPostsCount,
}) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Dashboard</h2>
          <p>Auto-analysis from chat logs and community activity.</p>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <p>Total days</p>
          <h3>{dashboard.summary.totalDays}</h3>
        </div>
        <div className="kpi-card">
          <p>Avg mood</p>
          <h3>
            {moodMeta[dashboard.summary.averageMoodLabel].marker}{' '}
            {moodMeta[dashboard.summary.averageMoodLabel].label}
          </h3>
        </div>
        <div className="kpi-card">
          <p>Completion rate</p>
          <h3>{dashboard.summary.completionRate}%</h3>
        </div>
        <div className="kpi-card">
          <p>Chat streak</p>
          <h3>{dashboard.summary.streakDays} day(s)</h3>
        </div>
        <div className="kpi-card">
          <p>Diary streak</p>
          <h3>{diaryStreakDays} day(s)</h3>
        </div>
      </div>

      <div className="split-grid">
        <div className="card">
          <h3>Daily Challenge</h3>
          <p>{dailyChallenge}</p>
          <p className="muted">Status: {challengeCompleted ? 'Completed today' : 'Pending'}</p>

          <h3 className="insight-title">Community Snapshot</h3>
          <div className="breakdown-row">
            <span>Friends</span>
            <strong>{friendCount}</strong>
          </div>
          <div className="breakdown-row">
            <span>Visible wall posts</span>
            <strong>{wallPostsCount}</strong>
          </div>
        </div>

        <div className="card">
          <h3>Mood Breakdown</h3>
          {Object.entries(dashboard.moodBreakdown).map(([key, count]) => (
            <div key={key} className="breakdown-row">
              <span>
                {moodMeta[key].marker} {moodMeta[key].label}
              </span>
              <strong>{count}</strong>
            </div>
          ))}

          <h3 className="insight-title">AI Insights</h3>
          <ul className="insights">
            {dashboard.insights.map((insight) => (
              <li key={insight}>{insight}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="card">
        <h3>Mood Trend (last 14 logs)</h3>
        {dashboard.trend.length === 0 && <p className="muted">No trend data yet.</p>}
        {dashboard.trend.map((item) => {
          const width = `${Math.max(8, ((Number(item.moodScore) + 2) / 4) * 100)}%`;
          return (
            <div key={item.date} className="trend-row">
              <span className="date-label">{formatDate(item.date)}</span>
              <div className="bar-track">
                <div className={`bar-fill mood-${item.moodLabel}`} style={{ width }} />
              </div>
              <span className="mood-label">
                {moodMeta[item.moodLabel]?.marker} {moodMeta[item.moodLabel]?.label}
              </span>
            </div>
          );
        })}
      </div>

      <div className="card">
        <h3>Recent Log Rows (cloud DB view)</h3>
        {dashboard.recent.length === 0 && <p className="muted">No rows yet.</p>}
        {dashboard.recent.map((item) => (
          <div key={item.date} className="db-row">
            <span className="mono">{activeUser.id}</span>
            <span>{item.date}</span>
            <span>
              {moodMeta[item.moodLabel]?.marker} {moodMeta[item.moodLabel]?.label}
            </span>
            <span>{item.messages.length} msg</span>
            <span>{item.ended ? 'Closed' : 'Open'}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default DashboardPage;
