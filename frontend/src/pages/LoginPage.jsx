import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { LayoutDashboard, LogIn, Shield, UserRound } from 'lucide-react';
import { DEMOS } from '../constants/nav';
import { messageFrom, useApp } from '../context/AppContext';

const ROLE_ICON = {
  owner: Shield,
  superadmin: Shield,
  admin: UserRound,
  teamleader: UserRound,
  staff: UserRound,
};

const demoEnabled = import.meta.env.VITE_ENABLE_DEMO_LOGIN === 'true';

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
      <div className="login-mobile-brand">
        <span className="brand-mark" aria-hidden="true"><LayoutDashboard size={18} /></span>
        <div>
          <strong>DoablinkOrbit</strong>
          <span>DOABLINK PRIVATE LIMITED</span>
        </div>
      </div>
      <section className="login-hero">
        <div>
          <div className="badge warning">DOABLINK PRIVATE LIMITED</div>
          <h1 style={{ marginTop: 18 }}>DoablinkOrbit</h1>
          <p style={{ marginTop: 12, maxWidth: 460, color: '#d7e2ee' }}>Sales CRM, calling analytics, follow-ups and revenue in one operating system for the team.</p>
        </div>
        <p>Light, clear and built for daily sales work.</p>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <h2>Sign in</h2>
          <p className="muted">Use the account issued by your administrator.</p>
          <label className="field" style={{ marginTop: 16 }}><span>Username</span><input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} autoComplete="username" required /></label>
          <label className="field" style={{ marginTop: 12 }}><span>Password</span><input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="current-password" required /></label>
          {error && <p style={{ color: 'var(--danger)', marginTop: 10 }}>{error}</p>}
          <button className="btn" style={{ width: '100%', marginTop: 16, display: 'inline-flex', justifyContent: 'center', gap: 8 }} disabled={busy} type="submit"><LogIn size={16} />{busy ? 'Signing in…' : 'Login'}</button>
          {demoEnabled && (
            <>
              <p className="muted" style={{ marginTop: 18 }}>Demo accounts — development only. Choosing a role fills the form. You still need to press Login.</p>
              <div className="demo-grid">
                {DEMOS.map((demo) => {
                  const Icon = ROLE_ICON[demo.username] || UserRound;
                  return (
                    <button key={demo.username} type="button" onClick={() => setForm({ username: demo.username, password: demo.password })}>
                      <span className="demo-role"><Icon size={16} aria-hidden="true" /><strong>{demo.role}</strong></span>
                      <span className="muted">{demo.blurb}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </form>
      </section>
    </div>
  );
}
