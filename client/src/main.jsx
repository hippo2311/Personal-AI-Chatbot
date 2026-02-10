import { Component } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'grid',
            placeItems: 'center',
            padding: '1rem',
            color: '#233540',
          }}
        >
          <div
            style={{
              maxWidth: '760px',
              width: '100%',
              background: 'rgba(255,255,255,0.92)',
              border: '1px solid #d2e0e6',
              borderRadius: '14px',
              padding: '1rem',
            }}
          >
            <h2 style={{ marginTop: 0 }}>App Runtime Error</h2>
            <p style={{ margin: '0.4rem 0', whiteSpace: 'pre-wrap' }}>
              {String(this.state.error?.message || this.state.error || 'Unknown error')}
            </p>
            <p style={{ margin: 0, opacity: 0.85 }}>
              Open browser DevTools Console for full stack trace.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);
