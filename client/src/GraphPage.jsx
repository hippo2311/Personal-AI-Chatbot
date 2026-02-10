import { useEffect, useState, useRef } from 'react';
import './GraphPage.css';

const DOMAINS = [
  { id: 'Work Life',      color: '#E8A838', icon: '💼', x: 400, y: 120 },
  { id: 'Academic Life',  color: '#4A90D9', icon: '📚', x: 650, y: 250 },
  { id: 'Personal Life',  color: '#9B59B6', icon: '🌸', x: 580, y: 480 },
  { id: 'Friends',        color: '#2ECC71', icon: '🤝', x: 300, y: 500 },
  { id: 'Dating',         color: '#E74C3C', icon: '💕', x: 150, y: 350 },
  { id: 'Health',         color: '#1ABC9C', icon: '🏃', x: 180, y: 180 },
  { id: 'Family',         color: '#F39C12', icon: '🏡', x: 450, y: 380 },
];

const TONE_COLORS = {
  positive:  '#2ECC71',
  negative:  '#E74C3C',
  neutral:   '#95A5A6',
  stressed:  '#E67E22',
  anxious:   '#9B59B6',
  happy:     '#F1C40F',
  sad:       '#3498DB',
  grateful:  '#1ABC9C',
  excited:   '#FF6B35',
};

function GraphPage({ activeUser, formatDate, formatTime }) {
  const [graphData, setGraphData] = useState({ nodes: [], edges: [], eventCount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedNode, setSelectedNode] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [extractMessage, setExtractMessage] = useState('');
  const [svgTransform, setSvgTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const svgRef = useRef(null);

  const userId = activeUser?.id || '';

  useEffect(() => {
    if (!userId) return;
    loadGraphData();
  }, [userId]);

  const loadGraphData = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`http://localhost:4000/api/graph/${userId}`);
      if (!response.ok) throw new Error('Failed to load graph');
      const data = await response.json();
      setGraphData(data);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const extractEventsFromToday = async () => {
    setExtracting(true);
    setExtractMessage('');
    setError('');
    
    const today = new Date().toISOString().slice(0, 10);
    
    try {
      const response = await fetch(`http://localhost:4000/api/graph/${userId}/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: today }),
      });
      
      if (!response.ok) throw new Error('Failed to extract events');
      
      const data = await response.json();
      setExtractMessage(`Extracted ${data.extracted} event${data.extracted !== 1 ? 's' : ''} from today's conversation.`);
      
      // Reload graph to show new events
      await loadGraphData();
    } catch (err) {
      setError(err.message);
    }
    setExtracting(false);
  };

  const deleteEvent = async (eventId) => {
    if (!window.confirm('Delete this event from your life graph?')) return;
    
    try {
      const response = await fetch(`http://localhost:4000/api/graph/${userId}/event/${eventId}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) throw new Error('Failed to delete event');
      
      setSelectedNode(null);
      await loadGraphData();
    } catch (err) {
      setError(err.message);
    }
  };

  // SVG pan/zoom handlers
  const onSvgMouseDown = (e) => {
    if (e.target === svgRef.current || e.target.classList.contains('svg-bg')) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - svgTransform.x, y: e.clientY - svgTransform.y });
    }
  };

  const onSvgMouseMove = (e) => {
    if (!isDragging) return;
    setSvgTransform(prev => ({ ...prev, x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }));
  };

  const onSvgMouseUp = () => setIsDragging(false);

  const onWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setSvgTransform(prev => ({ ...prev, scale: Math.max(0.3, Math.min(3, prev.scale * delta)) }));
  };

  // Layout event nodes around their domain hubs
  const layoutEventNodes = () => {
    const eventNodes = graphData.nodes.filter(n => n.type === 'event');
    const positioned = [];

    eventNodes.forEach((node, index) => {
      const primaryDomain = Array.isArray(node.domains) && node.domains.length > 0 
        ? node.domains[0] 
        : 'Personal Life';
      
      const domainNode = DOMAINS.find(d => d.id === primaryDomain) || DOMAINS[2];
      
      const angle = (index / Math.max(eventNodes.length, 1)) * Math.PI * 2;
      const radius = 80 + (index % 3) * 30;
      
      positioned.push({
        ...node,
        x: domainNode.x + Math.cos(angle) * radius,
        y: domainNode.y + Math.sin(angle) * radius,
      });
    });

    return positioned;
  };

  const eventNodes = layoutEventNodes();
  const domainNodes = DOMAINS;

  if (loading) {
    return (
      <div className="graph-page">
        <div className="graph-loading">Loading your life graph...</div>
      </div>
    );
  }

  return (
    <div className="graph-page">
      <header className="graph-header">
        <div className="graph-header-top">
          <h1>Your Life Graph</h1>
          <div className="graph-stats">
            <span className="stat-item">
              <strong>{graphData.eventCount}</strong> events mapped
            </span>
          </div>
        </div>
        
        <div className="graph-actions">
          <button 
            className="extract-btn" 
            onClick={extractEventsFromToday}
            disabled={extracting}
          >
            {extracting ? 'Extracting...' : '✨ Extract Events from Today'}
          </button>
          <button className="refresh-btn" onClick={loadGraphData}>🔄 Refresh</button>
        </div>

        {extractMessage && <p className="extract-message success">{extractMessage}</p>}
        {error && <p className="extract-message error">⚠️ {error}</p>}

        <div className="graph-legend">
          {DOMAINS.map(d => (
            <span key={d.id} className="legend-item" style={{ color: d.color }}>
              {d.icon} {d.id}
            </span>
          ))}
        </div>
      </header>

      <div className="graph-canvas-container">
        <svg
          ref={svgRef}
          className="graph-svg"
          viewBox="0 0 800 600"
          onMouseDown={onSvgMouseDown}
          onMouseMove={onSvgMouseMove}
          onMouseUp={onSvgMouseUp}
          onMouseLeave={onSvgMouseUp}
          onWheel={onWheel}
        >
          <defs>
            <radialGradient id="bgGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#1a1a2e" />
              <stop offset="100%" stopColor="#0d0d1a" />
            </radialGradient>
            {DOMAINS.map(d => (
              <radialGradient key={d.id} id={`grad_${d.id.replace(/\s/g, '_')}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={d.color} stopOpacity="0.3" />
                <stop offset="100%" stopColor={d.color} stopOpacity="0.05" />
              </radialGradient>
            ))}
          </defs>

          <rect className="svg-bg" width="100%" height="100%" fill="url(#bgGrad)" />

          <g transform={`translate(${svgTransform.x},${svgTransform.y}) scale(${svgTransform.scale})`}>
            {/* Domain halo zones */}
            {domainNodes.map(d => (
              <circle 
                key={d.id + '_halo'} 
                cx={d.x} 
                cy={d.y} 
                r={90} 
                fill={`url(#grad_${d.id.replace(/\s/g, '_')})`} 
              />
            ))}

            {/* Edges: event → domain */}
            {eventNodes.map(ev => {
              const primaryDomain = Array.isArray(ev.domains) && ev.domains.length > 0 
                ? ev.domains[0] 
                : 'Personal Life';
              const domain = DOMAINS.find(d => d.id === primaryDomain) || DOMAINS[2];
              return (
                <line 
                  key={ev.id + '_edge'}
                  x1={ev.x} 
                  y1={ev.y} 
                  x2={domain.x} 
                  y2={domain.y}
                  stroke={domain.color} 
                  strokeOpacity="0.25" 
                  strokeWidth="1.5"
                  strokeDasharray="4 3"
                />
              );
            })}

            {/* Domain nodes */}
            {domainNodes.map(d => (
              <g key={d.id}>
                <circle 
                  cx={d.x} 
                  cy={d.y} 
                  r={34} 
                  fill={d.color} 
                  fillOpacity="0.18" 
                  stroke={d.color} 
                  strokeWidth="2" 
                  strokeOpacity="0.7" 
                />
                <text 
                  x={d.x} 
                  y={d.y - 4} 
                  textAnchor="middle" 
                  fontSize="18" 
                  fill={d.color}
                >
                  {d.icon}
                </text>
                <text 
                  x={d.x} 
                  y={d.y + 14} 
                  textAnchor="middle" 
                  fontSize="9" 
                  fill={d.color} 
                  fontFamily="monospace" 
                  letterSpacing="0.5"
                >
                  {d.id.toUpperCase()}
                </text>
              </g>
            ))}

            {/* Event nodes */}
            {eventNodes.map(ev => {
              const primaryDomain = Array.isArray(ev.domains) && ev.domains.length > 0 
                ? ev.domains[0] 
                : 'Personal Life';
              const domain = DOMAINS.find(d => d.id === primaryDomain) || DOMAINS[2];
              const toneColor = TONE_COLORS[ev.emotional_tone] || '#95A5A6';
              const r = 8 + (ev.importance || 1) * 2;
              const isSelected = selectedNode?.id === ev.id;

              return (
                <g 
                  key={ev.id} 
                  style={{ cursor: 'pointer' }} 
                  onClick={() => setSelectedNode(isSelected ? null : ev)}
                >
                  <circle 
                    cx={ev.x} 
                    cy={ev.y} 
                    r={r + 4} 
                    fill={toneColor} 
                    fillOpacity={isSelected ? 0.35 : 0.12} 
                  />
                  <circle 
                    cx={ev.x} 
                    cy={ev.y} 
                    r={r} 
                    fill={toneColor} 
                    fillOpacity="0.75" 
                    stroke={domain.color} 
                    strokeWidth={isSelected ? 2.5 : 1.5} 
                  />
                  <circle 
                    cx={ev.x - r * 0.3} 
                    cy={ev.y - r * 0.3} 
                    r={r * 0.25} 
                    fill="white" 
                    fillOpacity="0.3" 
                  />
                </g>
              );
            })}

            {/* Empty state */}
            {eventNodes.length === 0 && (
              <text 
                x="400" 
                y="300" 
                textAnchor="middle" 
                fill="#ffffff44" 
                fontSize="14" 
                fontFamily="monospace"
              >
                No events yet. Click "Extract Events from Today" to start mapping your life.
              </text>
            )}
          </g>
        </svg>

        {/* Node detail panel */}
        {selectedNode && (
          <div className="node-detail-panel">
            <button className="close-btn" onClick={() => setSelectedNode(null)}>✕</button>
            
            <div 
              className="tone-badge" 
              style={{ background: TONE_COLORS[selectedNode.emotional_tone] || '#95A5A6' }}
            >
              {selectedNode.emotional_tone}
            </div>
            
            <p className="event-summary">{selectedNode.summary}</p>
            
            <div className="event-meta">
              <span>⭐ Importance: {selectedNode.importance}/5</span>
              <span>📅 {formatDate ? formatDate(selectedNode.event_date) : selectedNode.event_date}</span>
            </div>

            {selectedNode.keywords?.length > 0 && (
              <div className="event-keywords">
                {selectedNode.keywords.map(k => (
                  <span key={k} className="keyword-tag">{k}</span>
                ))}
              </div>
            )}

            <div className="event-domains">
              {selectedNode.domains?.map(d => {
                const domain = DOMAINS.find(dom => dom.id === d) || DOMAINS[2];
                return (
                  <span 
                    key={d} 
                    className="domain-pill"
                    style={{ 
                      background: domain.color + '33', 
                      color: domain.color,
                      border: `1px solid ${domain.color}66`
                    }}
                  >
                    {domain.icon} {d}
                  </span>
                );
              })}
            </div>

            <button 
              className="delete-event-btn" 
              onClick={() => deleteEvent(selectedNode.dbId)}
            >
              🗑️ Delete Event
            </button>
          </div>
        )}

        <div className="graph-controls-hint">
          Scroll to zoom · Drag to pan · Click nodes to inspect
        </div>
      </div>
    </div>
  );
}

export default GraphPage;
