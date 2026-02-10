function LandingPage({ onLogin, onRegister }) {
  return (
    <div className="landing-shell">
      <header className="landing-topbar">
        <div className="landing-brand">
          <span className="landing-logo">leaf</span>
          <strong>DayPulse</strong>
        </div>

        <nav className="landing-nav">
          <span className="landing-nav-item active">Home</span>
          <span className="landing-nav-item">Community</span>
          <span className="landing-nav-item">Dashboard</span>
        </nav>

        <button className="landing-login-pill" onClick={onLogin}>
          Login
        </button>
      </header>

      <main className="landing-hero">
        <p className="landing-icon">leaf</p>
        <h1>DayPulse AI</h1>
        <p className="landing-subtitle">
          A supportive daily journal and gratitude wall where people can reflect, share, and feel
          connected.
        </p>

        <div className="landing-actions">
          <button className="landing-primary-btn" onClick={onLogin}>
            Login
          </button>
          <button className="landing-secondary-btn" onClick={onRegister}>
            Register
          </button>
        </div>
      </main>
    </div>
  );
}

export default LandingPage;
