import { useState } from 'react';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  updateProfile,
} from 'firebase/auth';
import { auth } from '../lib/firebase.js';

const googleProvider = new GoogleAuthProvider();

function getFriendlyError(error) {
  const code = String(error?.code || '');
  if (code.includes('invalid-credential') || code.includes('wrong-password')) {
    return 'Email or password is incorrect.';
  }
  if (code.includes('user-not-found')) {
    return 'No account found for this email.';
  }
  if (code.includes('email-already-in-use')) {
    return 'This email is already registered.';
  }
  if (code.includes('weak-password')) {
    return 'Password should be at least 6 characters.';
  }
  if (code.includes('popup-closed-by-user')) {
    return 'Google sign-in was canceled.';
  }
  if (code.includes('popup-blocked')) {
    return 'Popup was blocked by browser. We are redirecting to Google sign-in.';
  }
  if (code.includes('unauthorized-domain')) {
    return 'This domain is not authorized in Firebase Auth settings.';
  }
  if (code.includes('operation-not-allowed')) {
    return 'Google sign-in is not enabled in Firebase Authentication.';
  }
  if (code.includes('admin-restricted-operation')) {
    return 'This sign-in method is restricted by project settings.';
  }
  return 'Authentication failed. Please try again.';
}

function AuthPage({ initialMode = 'login', onBack }) {
  const [mode, setMode] = useState(initialMode === 'register' ? 'register' : 'login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'register') {
        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        const name = displayName.trim();
        if (name) {
          await updateProfile(credential.user, { displayName: name });
        }
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (submitError) {
      setError(getFriendlyError(submitError));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (googleError) {
      const code = String(googleError?.code || '');
      if (code.includes('popup-blocked')) {
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      setError(getFriendlyError(googleError));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell auth-screen-shell">
      <section className="auth-hero">
        <h1>DayPulse AI</h1>
        <p>
          Private journaling meets community gratitude. Track your day, share wins, and stay connected.
        </p>
      </section>

      <section className="auth-card">
        {onBack && (
          <button className="auth-back-btn" onClick={onBack} disabled={loading}>
            Back to home
          </button>
        )}
        <h2>{mode === 'login' ? 'Login' : 'Register'}</h2>
        <p className="muted">
          {mode === 'login'
            ? 'Sign in to continue to your dashboard.'
            : 'Create an account to access all core features.'}
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === 'register' && (
            <label>
              Name
              <input
                type="text"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Your name"
              />
            </label>
          )}

          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 6 characters"
              required
            />
          </label>

          {error && <p className="error-text">{error}</p>}

          <button type="submit" disabled={loading}>
            {loading ? 'Please wait...' : mode === 'login' ? 'Login' : 'Create account'}
          </button>
        </form>

        <div className="auth-divider"><span>or</span></div>

        <button className="google-btn" onClick={handleGoogleSignIn} disabled={loading}>
          Continue with Google
        </button>

        <button
          className="auth-switch"
          onClick={() => {
            setMode((previous) => (previous === 'login' ? 'register' : 'login'));
            setError('');
          }}
          disabled={loading}
        >
          {mode === 'login' ? 'Need an account? Register' : 'Already have an account? Login'}
        </button>
      </section>
    </div>
  );
}

export default AuthPage;
