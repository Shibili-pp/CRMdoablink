import { useEffect, useState } from 'react';
import api from '../api/client';
import { Page } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

export default function SettingsPage() {
  const { can, toast } = useApp();
  const [settings, setSettings] = useState(null);
  const [source, setSource] = useState('');

  const load = () => api.get('/api/v1/settings').then((response) => setSettings(response.data.data)).catch((error) => toast(messageFrom(error), 'error'));
  useEffect(() => { load(); }, []);
  if (!settings) return null;

  const saveSources = async () => {
    try { await api.put('/api/v1/settings/leadSources', { value: settings.leadSources }); toast('Sources saved'); }
    catch (error) { toast(messageFrom(error), 'error'); }
  };
  const saveWeights = async () => {
    try { await api.put('/api/v1/settings/leaderboardWeights', { value: settings.leaderboardWeights }); toast('Weights saved'); }
    catch (error) { toast(messageFrom(error), 'error'); }
  };
  const saveRule = async (rule) => {
    try { await api.patch(`/api/v1/alert-rules/${rule._id}`, rule); toast('Alert updated'); }
    catch (error) { toast(messageFrom(error), 'error'); }
  };

  return (
    <Page title="Settings" subtitle={`${settings.general.companyName} · timezone ${settings.general.timezone}`}>
      {can('settings.manage') && <article className="card" style={{ marginBottom: 14 }}>
        <h3>Lead sources</h3>
        <div className="cluster">{settings.leadSources.map((item) => <button key={item} className="btn secondary" type="button" onClick={() => setSettings({ ...settings, leadSources: settings.leadSources.filter((sourceName) => sourceName !== item) })}>{item} ×</button>)}</div>
        <div className="filters" style={{ marginTop: 10 }}><input value={source} onChange={(event) => setSource(event.target.value)} placeholder="New source" /><button className="btn" type="button" onClick={() => { if (!source.trim()) return; setSettings({ ...settings, leadSources: [...settings.leadSources, source.trim()] }); setSource(''); }}>Add</button><button className="btn secondary" type="button" onClick={saveSources}>Save sources</button></div>
      </article>}
      {can('settings.manage') && <article className="card" style={{ marginBottom: 14 }}>
        <h3>Leaderboard weights</h3>
        <p className="muted">Calling weight uses connected calls and talk time, not raw dial count.</p>
        <div className="form-grid">
          {Object.entries(settings.leaderboardWeights).map(([key, value]) => (
            <label key={key} className="field"><span>{key}</span><input type="number" value={value} onChange={(event) => setSettings({ ...settings, leaderboardWeights: { ...settings.leaderboardWeights, [key]: Number(event.target.value) } })} /></label>
          ))}
        </div>
        <button className="btn" type="button" style={{ marginTop: 10 }} onClick={saveWeights}>Save weights</button>
      </article>}
      {can('pipeline.manage') && <article className="card" style={{ marginBottom: 14 }}>
        <h3>Lead statuses</h3>
        {settings.statuses.map((status) => <p key={status.key}>{status.label} · {status.category}</p>)}
      </article>}
      {can('settings.manage') && <article className="card">
        <h3>Alert thresholds</h3>
        {settings.alertRules.map((rule) => (
          <div key={rule._id} className="filters">
            <span>{rule.label}</span>
            <input type="number" value={rule.threshold} onChange={(event) => setSettings({ ...settings, alertRules: settings.alertRules.map((item) => item._id === rule._id ? { ...item, threshold: Number(event.target.value) } : item) })} />
            <span>{rule.unit}</span>
            <button className="btn secondary" type="button" onClick={() => saveRule(rule)}>Save</button>
          </div>
        ))}
      </article>}
    </Page>
  );
}
