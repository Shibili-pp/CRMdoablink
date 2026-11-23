import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { LayoutDashboard, LogIn } from 'lucide-react';
import { messageFrom, useApp } from '../context/AppContext';

export default function LoginPage() {
  const { user, login } = useApp();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(form.username, form.password);
    } catch (err) {
      setError(messageFrom(err, 'Unable to sign in'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <section className="login-hero" aria-label="DoablinkOrbit">
        <div className="login-hero-glow" aria-hidden="true" />
        <div className="login-hero-copy">
          <div className="login-brand-row">
            <span className="brand-mark" aria-hidden="true"><LayoutDashboard size={20} /></span>
            <div>
              <strong>DoablinkOrbit</strong>
              <span>DOABLINK PRIVATE LIMITED</span>
            </div>
          </div>
          <h1>Run sales, calls and follow-ups in one clear workspace.</h1>
          <p>Built for daily BDA work — leads, pipeline, hourly reports and revenue in one place.</p>
        </div>
        <ul className="login-points">
          <li>Lead and pipeline tracking</li>
          <li>Calling analytics and hourly reports</li>
          <li>Targets, revenue and team view</li>
        </ul>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="login-mobile-brand">
            <span className="brand-mark" aria-hidden="true"><LayoutDashboard size={18} /></span>
            <div>
              <strong>DoablinkOrbit</strong>
              <span>DOABLINK PRIVATE LIMITED</span>
            </div>
          </div>
          <h2>Sign in</h2>
          <p className="muted">Use the account issued by your administrator.</p>
          <label className="field">
            <span>Username</span>
            <input aria-label="Username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} autoComplete="username" required />
          </label>
          <label className="field">
            <span>Password</span>
            <input aria-label="Password" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="current-password" required />
          </label>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button className="btn login-submit" disabled={busy} type="submit">
            <LogIn size={16} aria-hidden="true" />
            {busy ? 'Signing in…' : 'Login'}
          </button>
        </form>
      </section>
    </div>
  );
}
