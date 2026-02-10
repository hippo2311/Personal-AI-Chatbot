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

const ENTITY_COLORS = {
  place: '#3498db',
  person: '#e74c3c',
  food: '#f39c12',
  activity: '#9b59b6',
  preference: '#1abc9c',
  object: '#95a5a6',
  organization: '#34495e',
};

function GraphPage({ activeUser, formatDate, formatTime }) {
  const [graphData, setGraphData] = useState({ nodes: [], edges: [], eventCount: 0, entityCount: 0 });
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
      console.log('📊 Graph data received:', data);
      setGraphData(data);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
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

  const clearAllEvents = async () => {
    if (!window.confirm(`Delete all ${graphData.eventCount} events from your life graph? This cannot be undone.`)) return;
    
    setExtracting(true);
    setError('');
    setExtractMessage('');
    
    try {
      const response = await fetch(`http://localhost:4000/api/graph/${userId}/clear`, {
        method: 'DELETE',
      });
      
      if (!response.ok) throw new Error('Failed to clear events');
      
      const data = await response.json();
      setExtractMessage(`Cleared ${data.deleted} events from your life graph.`);
      setSelectedNode(null);
      await loadGraphData();
    } catch (err) {
      setError(err.message);
    }
    setExtracting(false);
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

  // Layout nodes with positions
  const layoutNodes = () => {
    const eventNodes = graphData.nodes.filter(n => n.type === 'event');
    const entityNodes = graphData.nodes.filter(n => n.type === 'entity');
    const positioned = [];

    // Position event nodes around their domain hubs
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

    // Position entity nodes - spread them out more from events
    entityNodes.forEach((node, index) => {
      // Find related events to position near them
      const relatedEdges = graphData.edges.filter(e => 
        e.target === node.id || e.source === node.id
      );
      
      if (relatedEdges.length > 0) {
        // Position near related event
        const relatedEventId = relatedEdges[0].source.startsWith('event:') 
          ? relatedEdges[0].source 
          : relatedEdges[0].target;
        
        const relatedEvent = positioned.find(n => n.id === relatedEventId);
        
        if (relatedEvent) {
          const angle = (index / Math.max(entityNodes.length, 1)) * Math.PI * 2;
          const radius = 40 + (index % 2) * 20;
          
          positioned.push({
            ...node,
            x: relatedEvent.x + Math.cos(angle) * radius,
            y: relatedEvent.y + Math.sin(angle) * radius,
          });
        } else {
          // Fallback to random position
          positioned.push({
            ...node,
            x: 200 + (index * 80) % 400,
            y: 200 + ((index * 60) % 300),
          });
        }
      } else {
        // No relationships, position randomly
        positioned.push({
          ...node,
          x: 200 + (index * 80) % 400,
          y: 200 + ((index * 60) % 300),
        });
      }
    });

    return positioned;
  };

  const allNodes = layoutNodes();
  const eventNodes = allNodes.filter(n => n.type === 'event');
  const entityNodes = allNodes.filter(n => n.type === 'entity');
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
              <strong>{graphData.eventCount}</strong> events
            </span>
            <span className="stat-item">
              <strong>{graphData.entityCount || 0}</strong> entities
            </span>
          </div>
        </div>
        
        <div className="graph-actions">
          <button className="refresh-btn" onClick={loadGraphData}>🔄 Refresh</button>
          {graphData.eventCount > 0 && (
            <button 
              className="clear-all-btn" 
              onClick={clearAllEvents}
              disabled={extracting}
            >
              🗑️ Clear All Events
            </button>
          )}
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

            {/* ALL EDGES from database relationships */}
            {graphData.edges.map((edge, idx) => {
              const sourceNode = allNodes.find(n => n.id === edge.source) || domainNodes.find(d => `domain:${d.id}` === edge.source);
              const targetNode = allNodes.find(n => n.id === edge.target) || domainNodes.find(d => `domain:${d.id}` === edge.target);
              
              if (!sourceNode || !targetNode) return null;
              
              const sx = sourceNode.x;
              const sy = sourceNode.y;
              const tx = targetNode.x;
              const ty = targetNode.y;
              
              // Different styles for different edge types
              const isRelationship = edge.type !== 'BELONGS TO' && edge.type !== 'FOLLOWS';
              const strokeColor = isRelationship ? '#3498db' : (targetNode.color || '#666');
              const strokeWidth = isRelationship ? 2 : 1.5;
              const strokeDash = isRelationship ? '5 3' : '4 3';
              const opacity = isRelationship ? 0.6 : 0.25;
              
              return (
                <g key={`edge_${idx}`}>
                  <line 
                    x1={sx} 
                    y1={sy} 
                    x2={tx} 
                    y2={ty}
                    stroke={strokeColor}
                    strokeOpacity={opacity}
                    strokeWidth={strokeWidth}
                    strokeDasharray={strokeDash}
                  />
                  {isRelationship && (
                    <text
                      x={(sx + tx) / 2}
                      y={(sy + ty) / 2 - 5}
                      textAnchor="middle"
                      fontSize="8"
                      fill="#3498db"
                      fillOpacity="0.7"
                      fontFamily="monospace"
                    >
                      {edge.type}
                    </text>
                  )}
                </g>
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

            {/* Entity nodes */}
            {entityNodes.map(entity => {
              const color = entity.color || ENTITY_COLORS[entity.entityType] || '#95a5a6';
              const r = 10;
              const isSelected = selectedNode?.id === entity.id;

              return (
                <g 
                  key={entity.id} 
                  style={{ cursor: 'pointer' }} 
                  onClick={() => setSelectedNode(isSelected ? null : entity)}
                >
                  <circle 
                    cx={entity.x} 
                    cy={entity.y} 
                    r={r + 3} 
                    fill={color} 
                    fillOpacity={isSelected ? 0.4 : 0.15} 
                  />
                  <circle 
                    cx={entity.x} 
                    cy={entity.y} 
                    r={r} 
                    fill={color} 
                    fillOpacity="0.8" 
                    stroke={color} 
                    strokeWidth={isSelected ? 2 : 1} 
                  />
                  <text
                    x={entity.x}
                    y={entity.y + 3}
                    textAnchor="middle"
                    fontSize="10"
                    fill="white"
                  >
                    {entity.icon || '⭐'}
                  </text>
                </g>
              );
            })}

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
            {eventNodes.length === 0 && entityNodes.length === 0 && (
              <text 
                x="400" 
                y="300" 
                textAnchor="middle" 
                fill="#ffffff44" 
                fontSize="14" 
                fontFamily="monospace"
              >
                No events yet. Start a conversation and end it to extract events.
              </text>
            )}
          </g>
        </svg>

        {/* Node detail panel */}
        {selectedNode && (
          <div className="node-detail-panel">
            <button className="close-btn" onClick={() => setSelectedNode(null)}>✕</button>
            
            {selectedNode.type === 'event' && (
              <>
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
              </>
            )}

            {selectedNode.type === 'entity' && (
              <>
                <div 
                  className="tone-badge" 
                  style={{ background: selectedNode.color || '#95a5a6' }}
                >
                  {selectedNode.entityType}
                </div>
                
                <p className="event-summary">{selectedNode.name}</p>
                
                <div className="event-meta">
                  <span>{selectedNode.icon || '⭐'} {selectedNode.entityType}</span>
                </div>

                {selectedNode.attributes && Object.keys(selectedNode.attributes).length > 0 && (
                  <div className="event-keywords">
                    {Object.entries(selectedNode.attributes).map(([key, value]) => (
                      <span key={key} className="keyword-tag">{key}: {value}</span>
                    ))}
                  </div>
                )}
              </>
            )}
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
