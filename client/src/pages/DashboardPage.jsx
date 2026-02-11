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
  const moodBreakdownEntries = Object.entries(dashboard.moodBreakdown || {});
  const moodBreakdownTotal = moodBreakdownEntries.reduce((sum, [, count]) => sum + Number(count || 0), 0);
  const pieSlices = moodBreakdownEntries.reduce((acc, [key, count]) => {
    const value = Number(count || 0);
    const startAngle = acc.currentAngle;
    const sliceAngle = moodBreakdownTotal ? (value / moodBreakdownTotal) * 360 : 0;
    const endAngle = startAngle + sliceAngle;
    acc.slices.push({
      key,
      value,
      startAngle,
      endAngle,
    });
    acc.currentAngle = endAngle;
    return acc;
  }, {
    currentAngle: -90,
    slices: [],
  }).slices;

  const polarToCartesian = (cx, cy, radius, angleInDegrees) => {
    const angleInRadians = (angleInDegrees * Math.PI) / 180.0;
    return {
      x: cx + radius * Math.cos(angleInRadians),
      y: cy + radius * Math.sin(angleInRadians),
    };
  };

  const describeArc = (cx, cy, radius, startAngle, endAngle) => {
    const start = polarToCartesian(cx, cy, radius, endAngle);
    const end = polarToCartesian(cx, cy, radius, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
    return [
      `M ${cx} ${cy}`,
      `L ${start.x} ${start.y}`,
      `A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`,
      'Z',
    ].join(' ');
  };

  const trendScores = (dashboard.trend || []).map((item) => Number(item.moodScore || 0));
  const moodColorMap = {
    great: '#5cdb55',
    good: '#7fd0d2',
    neutral: '#b8bfc7',
    low: '#f3d163',
    tough: '#e36e5c',
  };
  const getMoodColor = (key) => moodMeta[key]?.color || moodColorMap[key] || '#c4c4c4';
  const trendMin = Math.min(0, ...trendScores);
  const trendMax = Math.max(1, ...trendScores);
  const trendRange = Math.max(Math.abs(trendMin), Math.abs(trendMax), 1);
  const trendWithScore = (dashboard.trend || []).map((item) => ({
    date: item.date,
    score: Number(item.moodScore || 0),
    moodLabel: item.moodLabel,
    messages: Number(item.messages?.length || 0),
  }));
  const toDateObj = (date) => {
    if (!date) return new Date();
    if (/^\d{4}-\d{2}-\d{2}/.test(date)) {
      return new Date(`${date}T00:00:00`);
    }
    return new Date(date);
  };
  const toIsoDate = (date) => date.toISOString().slice(0, 10);
  const latestTrendDate = trendWithScore.length
    ? trendWithScore.reduce((latest, item) => {
        if (!latest) return item.date;
        return toDateObj(item.date) > toDateObj(latest) ? item.date : latest;
      }, null)
    : null;
  const anchorDate = latestTrendDate ? toDateObj(latestTrendDate) : new Date();
  const last14Dates = Array.from({ length: 14 }, (_, index) => {
    const day = new Date(anchorDate);
    day.setDate(anchorDate.getDate() - (13 - index));
    return toIsoDate(day);
  });
  const trendByDate = new Map(trendWithScore.map((item) => [String(item.date || ''), item]));
  const last14Entries = last14Dates.map((date) => {
    const match = trendByDate.get(date);
    return {
      date,
      score: match ? match.score : null,
      moodLabel: match?.moodLabel,
      messages: match ? match.messages : 0,
    };
  });
  const chartGap = 8;
  const chartBaseWidth = 100;
  const chartWidth = chartBaseWidth + (last14Entries.length - 1) * chartGap;
  const barOffset = 0.15;
  const barWidthRatio = 0.7;
  const trendBarTopPoints = last14Entries.map((item, index) => {
    const slotWidth = last14Entries.length > 0 ? chartBaseWidth / last14Entries.length : chartBaseWidth;
    const x = index * (slotWidth + chartGap) + slotWidth * 0.5;
    const normalized = item.score === null ? 0 : item.score / trendRange;
    const y = 50 - normalized * 35;
    return `${x},${y}`;
  }).join(' ');

  const bestScore = trendScores.length ? Math.max(...trendScores) : null;
  const bestDay = bestScore === null ? null : trendWithScore.find((item) => item.score === bestScore);
  let longestBestStreak = 0;
  let longestBestStart = null;
  let longestBestEnd = null;
  let currentStreak = 0;
  trendWithScore.forEach((item, index) => {
    if (item.score === bestScore) {
      currentStreak += 1;
      if (currentStreak > longestBestStreak) {
        longestBestStreak = currentStreak;
        longestBestEnd = item.date;
        longestBestStart = trendWithScore[index - currentStreak + 1]?.date || item.date;
      }
    } else {
      currentStreak = 0;
    }
  });
  const mostChattyDay = trendWithScore.length
    ? trendWithScore.reduce((best, item) => (item.messages > best.messages ? item : best), trendWithScore[0])
    : null;
  const mostNeutralDay = trendWithScore.length
    ? trendWithScore.reduce((best, item) => (Math.abs(item.score) < Math.abs(best.score) ? item : best), trendWithScore[0])
    : null;
  const getShortDateLabel = (date) => {
    const raw = String(date || '');
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
      return `${raw.slice(5, 7)}/${raw.slice(8, 10)}`;
    }
    return formatDate ? formatDate(date) : raw;
  };
  const maxMessageCount = Math.max(1, ...last14Entries.map((item) => item.messages));
  const formatScoreLabel = (score) => {
    if (score === null || Number.isNaN(score)) return '--';
    return Number.isInteger(score) ? String(score) : score.toFixed(1);
  };
  const chartWideStyle = { width: 'calc(100% + 1.2rem)', margin: '0 -0.6rem' };
  const moodChartHeight = 260;
  const chatChartHeight = 260;

  const moodStabilityPercent = trendScores.length
    ? Math.round(
        (trendScores.filter((score) => score >= 0).length / trendScores.length) * 100
      )
    : 0;
  const moodVolatility = trendScores.length > 1
    ? Math.round(
        (trendScores.slice(1).reduce((sum, score, index) => sum + Math.abs(score - trendScores[index]), 0) / (trendScores.length - 1)) * 100
      ) / 100
    : 0;

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
          <h3>Month at a glance</h3>
          {trendWithScore.length === 0 && <p className="muted">No monthly highlights yet.</p>}
          {trendWithScore.length > 0 && (
            <div style={{ display: 'grid', gap: '8px' }}>
              <div className="breakdown-row">
                <span>Best day</span>
                <strong>
                  {bestDay?.date ? formatDate(bestDay.date) : '—'}
                </strong>
              </div>
              <div className="breakdown-row">
                <span>Longest best-day streak</span>
                <strong>
                  {longestBestStreak > 0
                    ? `${longestBestStreak} day(s) (${formatDate(longestBestStart)} - ${formatDate(longestBestEnd)})`
                    : '—'}
                </strong>
              </div>
              <div className="breakdown-row">
                <span>Most chatty day</span>
                <strong>
                  {mostChattyDay?.date ? `${formatDate(mostChattyDay.date)} (${mostChattyDay.messages} msg)` : '—'}
                </strong>
              </div>
              <div className="breakdown-row">
                <span>Most neutral day</span>
                <strong>
                  {mostNeutralDay?.date ? formatDate(mostNeutralDay.date) : '—'}
                </strong>
              </div>
            </div>
          )}

          <h3 className="insight-title" style={{ marginTop: '30px' }}>Community Snapshot</h3>
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
          <div className="breakdown-row" style={{ gap: '24px', alignItems: 'center' }}>
            <svg width="160" height="160" viewBox="0 0 160 160" role="img" aria-label="Mood breakdown pie chart">
              <circle cx="80" cy="80" r="68" fill="#f2f2f2" />
              {pieSlices.map((slice) => (
                <path
                  key={slice.key}
                  d={describeArc(80, 80, 68, slice.startAngle, slice.endAngle)}
                  fill={getMoodColor(slice.key)}
                  stroke="#ffffff"
                  strokeWidth="1"
                />
              ))}
              <circle cx="80" cy="80" r="34" fill="#ffffff" />
              <text x="80" y="80" textAnchor="middle" dominantBaseline="middle" style={{ fontSize: '14px', fontWeight: 600 }}>
                {moodBreakdownTotal || 0}
              </text>
            </svg>

            <div style={{ flex: 1, minWidth: '160px' }}>
              {moodBreakdownEntries.map(([key, count]) => (
                <div key={key} className="breakdown-row" style={{ marginBottom: '8px' }}>
                  <span>
                    <span
                      aria-hidden="true"
                      style={{
                        display: 'inline-block',
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        background: getMoodColor(key),
                        marginRight: '8px',
                      }}
                    />
                    {moodMeta[key]?.marker} {moodMeta[key]?.label}
                  </span>
                  <strong>{count}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="breakdown-row" style={{ marginTop: '16px' }}>
            <span>Stability (neutral+)</span>
            <strong>{moodStabilityPercent}%</strong>
          </div>
          <div className="breakdown-row">
            <span>Volatility (avg delta)</span>
            <strong>{moodVolatility}</strong>
          </div>

          <h3 className="insight-title">AI Insights</h3>
          <ul className="insights">
            {dashboard.insights.map((insight) => (
              <li key={insight}>{insight}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="card">
        <h3>Mood Score Bars (last 14 days)</h3>
        {trendWithScore.length === 0 && <p className="muted">No mood score data yet.</p>}
        {trendWithScore.length > 0 && (
        <div style={{ height: moodChartHeight, ...chartWideStyle }}>
          <svg
            viewBox={`0 0 ${chartWidth} 120`}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            style={{ width: '100%', height: '100%', display: 'block' }}
          >
            <line x1="0" y1="15" x2={chartWidth} y2="15" stroke="#edf1f4" />
            <line x1="0" y1="85" x2={chartWidth} y2="85" stroke="#edf1f4" />
            <line x1="0" y1="50" x2={chartWidth} y2="50" stroke="#d7dee4" strokeDasharray="3 3" />
            {last14Entries.map((item, index) => {
              const slotWidth = chartBaseWidth / last14Entries.length;
              const x = index * (slotWidth + chartGap) + slotWidth * barOffset;
              const width = slotWidth * barWidthRatio;
              const normalized = item.score === null ? 0 : item.score / trendRange;
              const barHeight = Math.abs(normalized) * 38;
              const y = normalized >= 0 ? 50 - barHeight : 50;
              const labelY = normalized >= 0 ? y - 4 : y + barHeight + 8;
              const showDate = index % 2 === 0;
              return (
                <g key={`score-bar-${item.date}-${index}`}>
                  <rect
                    x={x}
                    y={y}
                    width={width}
                    height={barHeight}
                    fill="#274251"
                    rx="1"
                  />
                  <text x={x + width / 2} y={labelY} textAnchor="middle" fontSize="6" fill="#5b6a76">
                    {formatScoreLabel(item.score)}
                  </text>
                  {showDate && (
                    <text x={x + width / 2} y="108" textAnchor="middle" fontSize="6" fill="#6b7680">
                      {getShortDateLabel(item.date)}
                    </text>
                  )}
                </g>
              );
            })}
            <polyline
              fill="none"
              stroke="#274251"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={trendBarTopPoints}
              opacity="0.85"
            />
            <text x="-5" y="50" textAnchor="end" dominantBaseline="middle" fontSize="7" fill="#8a96a1">
              Neutral
            </text>
          </svg>
        </div>
        )}
        <div className="breakdown-row" style={{ marginTop: 8 }}>
          <span>Range</span>
          <strong>
            {trendMin} to {trendMax}
          </strong>
        </div>
        <p className="muted" style={{ marginTop: 6 }}>
          Range shows the lowest and highest mood scores within the last 14 days.
        </p>
      </div>

      <div className="card">
        <h3>Chat Volume (last 14 days)</h3>
        {trendWithScore.length === 0 && <p className="muted">No chat volume yet.</p>}
        {trendWithScore.length > 0 && (
          <div style={{ height: chatChartHeight, ...chartWideStyle }}>
            <svg
              viewBox={`0 0 ${chartWidth} 110`}
              preserveAspectRatio="xMidYMid meet"
              role="img"
              style={{ width: '100%', height: '100%', display: 'block' }}
            >
              <line x1="0" y1="88" x2={chartWidth} y2="88" stroke="#e6e9ed" />
              <line x1="0" y1="20" x2="0" y2="88" stroke="#d7dee4" />
              <text x="2" y="24" textAnchor="start" fontSize="5" fill="#6b7680">{maxMessageCount}</text>
              <text x="2" y="88" textAnchor="start" fontSize="5" fill="#6b7680">0</text>
              {last14Entries.map((item, index) => {
                const count = item.messages;
                const slotWidth = chartBaseWidth / last14Entries.length;
                const x = index * (slotWidth + chartGap) + slotWidth * barOffset;
                const width = slotWidth * barWidthRatio;
                const labelX = x + width / 2;
                const height = (count / maxMessageCount) * 74;
                const y = 88 - height;
                const label = getShortDateLabel(item.date);
                const showDate = index % 2 === 0;
                return (
                  <g key={`bar-${index}`}>
                    <rect x={x} y={y} width={width} height={height} fill="#417698" rx="1" />
                    {showDate && (
                      <text x={labelX} y="106" textAnchor="middle" fontSize="5" fill="#6b7680">
                        {label}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        )}
      </div>
    </section>
  );
}

export default DashboardPage;
