function LandingPage({ onLogin, onRegister }) {
  return (
    <div className="landing-shell">
      <header className="landing-topbar">
        <div className="landing-brand">
          <span className="landing-logo-badge" aria-hidden>
            DP
          </span>
          <strong>DayPulse</strong>
        </div>

        <div className="landing-topbar-mini" aria-live="polite">
          <div className="landing-greeting-rotator">
            <span>How has your day been so far?</span>
            <span>What made you smile today?</span>
            <span>Are you feeling okay right now?</span>
            <span>Would you like a quick check-in?</span>
            <span>Want to log one gratitude today?</span>
          </div>
        </div>

        <div className="landing-top-actions">
          <button className="landing-login-pill" onClick={onLogin}>
            Login
          </button>
          <button className="landing-register-pill" onClick={onRegister}>
            Register
          </button>
        </div>
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <p className="landing-kicker">Personal AI companion for daily wellbeing</p>
          <h1>Reflect daily. Share kindly. Grow with your community.</h1>
          <p className="landing-subtitle">
            DayPulse combines mood-aware AI chat, private diary journaling, and a supportive
            community wall to help you build healthier daily habits.
          </p>

          <div className="landing-actions">
            <button className="landing-primary-btn" onClick={onLogin}>
              Login to continue
            </button>
            <button className="landing-secondary-btn" onClick={onRegister}>
              Create new account
            </button>
          </div>

          <div className="landing-feature-grid">
            <article className="landing-feature-card">
              <h3>AI Daily Check-ins</h3>
              <p>Chat-based reflections that adapt to your mood in real time.</p>
            </article>
            <article className="landing-feature-card">
              <h3>Diary + Photo Timeline</h3>
              <p>Capture good and bad moments with entries, tags, and photos.</p>
            </article>
            <article className="landing-feature-card">
              <h3>Community Support</h3>
              <p>Share gratitude posts, react with kindness, and stay connected.</p>
            </article>
          </div>
        </section>

        <section className="landing-project-info">
          <h2>About This Project</h2>
          <p>
            This project is built as a supportive social wellbeing app for students and young
            professionals who want a lightweight daily check-in routine.
          </p>

          <div className="landing-project-grid">
            <article className="landing-project-card">
              <h3>What DayPulse Solves</h3>
              <ul>
                <li>Makes reflection easier with short AI-guided conversations.</li>
                <li>Encourages consistency through streaks and daily challenges.</li>
                <li>Creates a safer positive space for gratitude sharing.</li>
              </ul>
            </article>

            <article className="landing-project-card">
              <h3>Core Technologies</h3>
              <ul>
                <li>Frontend: React + Vite</li>
                <li>Database: Firebase Firestore</li>
                <li>Auth: Email/password + Google login</li>
                <li>Media: Firebase Storage for diary/community photos</li>
              </ul>
            </article>

            <article className="landing-project-card">
              <h3>Roadmap</h3>
              <ul>
                <li>Friend circles and private group reflections</li>
                <li>Weekly wellness reports and progress summaries</li>
                <li>More expressive avatar and mood visualizations</li>
              </ul>
            </article>
          </div>
        </section>
      </main>
    </div>
  );
}

export default LandingPage;
