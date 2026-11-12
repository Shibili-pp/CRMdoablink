import { useEffect, useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import api from '../api/client';
import { Badge, DataTable, Page, duration } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

const PRESETS = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['week', 'This week'],
  ['month', 'This month'],
];

function clock(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function CallsPage() {
  const { toast, can } = useApp();
  const [tab, setTab] = useState('analytics');
  const [preset, setPreset] = useState('today');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [analytics, setAnalytics] = useState(null);
  const [calls, setCalls] = useState([]);
  const [recordings, setRecordings] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [devices, setDevices] = useState([]);
  const [recordingQuery, setRecordingQuery] = useState('');
  const [manual, setManual] = useState({ phone: '', callType: 'outgoing', status: 'connected', durationMinutes: 1, startedAt: new Date().toISOString().slice(0, 16) });

  const rangeQuery = () => {
    const params = new URLSearchParams();
    if (preset === 'range') {
      if (from) params.set('startDate', from);
      if (to) params.set('endDate', to);
    } else if (preset !== 'today') params.set('preset', preset);
    return params.toString();
  };

  const loadCalls = () => {
    const query = rangeQuery();
    api.get(`/api/v1/calls/analytics?${query}`).then((response) => setAnalytics(response.data.data)).catch((error) => toast(messageFrom(error), 'error'));
    api.get(`/api/v1/calls?limit=30&${query}`).then((response) => setCalls(response.data.data)).catch(() => {});
  };
  useEffect(() => { loadCalls(); }, [preset, from, to]);
  useEffect(() => {
    api.get('/api/v1/contacts?limit=30').then((response) => setContacts(response.data.data)).catch(() => {});
    api.get('/api/v1/android/devices').then((response) => setDevices(response.data.data)).catch(() => {});
  }, []);

  const searchRecordings = async (event) => {
    event.preventDefault();
    const response = await api.get(`/api/v1/call-recordings?recordingId=${encodeURIComponent(recordingQuery)}`);
    setRecordings(response.data.data);
  };

  const reveal = async (id) => {
    try {
      const response = await api.get(`/api/v1/call-recordings/${id}`);
      toast(`Reference: ${response.data.data.accessReference || 'No private reference stored'}`);
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  const saveManual = async (event) => {
    event.preventDefault();
    try {
      await api.post('/api/v1/calls/manual', { phone: manual.phone, callType: manual.callType, status: manual.status, startedAt: new Date(manual.startedAt).toISOString(), durationSeconds: Math.round(Number(manual.durationMinutes) * 60) });
      toast('Manual call saved. It is not an Android call log.');
      loadCalls();
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  const createLead = async (id) => {
    try {
      const response = await api.post(`/api/v1/contacts/${id}/create-lead`);
      toast(`Lead ${response.data.data.leadCode} created from this contact only`);
      load();
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  return (
    <Page title="Calling analytics" subtitle="Android sync, manual entries and demo seed are counted separately." actions={['analytics', 'log', 'recordings', 'contacts', 'devices'].map((item) => (
      <button key={item} className={`btn ${tab === item ? '' : 'secondary'}`} type="button" onClick={() => setTab(item)}>{item}</button>
    ))}>
      {(tab === 'analytics' || tab === 'log') && (
        <div className="filters" role="group" aria-label="Call dates">
          {PRESETS.map(([key, label]) => (
            <button key={key} className={`btn ${preset === key ? '' : 'secondary'}`} type="button" onClick={() => { setFrom(''); setTo(''); setPreset(key); }}>{label}</button>
          ))}
          <label className="field"><span>From</span>
            <input type="date" aria-label="From date" value={preset === 'range' ? from : (analytics?.period?.from || '')} onChange={(event) => { setFrom(event.target.value); setTo(preset === 'range' ? to : (analytics?.period?.to || event.target.value)); setPreset('range'); }} />
          </label>
          <label className="field"><span>To</span>
            <input type="date" aria-label="To date" value={preset === 'range' ? to : (analytics?.period?.to || '')} onChange={(event) => { setFrom(preset === 'range' ? from : (analytics?.period?.from || event.target.value)); setTo(event.target.value); setPreset('range'); }} />
          </label>
        </div>
      )}
      {tab === 'analytics' && analytics && (
        <>
          <div className="banner">{analytics.note} Android sync: {analytics.summary.bySource.android_sync?.calls || 0}. Manual: {analytics.summary.bySource.manual?.calls || 0}. Demo seed: {analytics.summary.bySource.demo_seed?.calls || 0}.</div>
          <div className="grid stats">
            {[
              ['Total', analytics.summary.total],
              ['Outgoing', analytics.summary.outgoing],
              ['Incoming', analytics.summary.incoming],
              ['Connected', analytics.summary.connected],
              ['Not connected', analytics.summary.notConnected],
              ['Missed', analytics.summary.missed],
              ['Unique numbers', analytics.summary.uniqueNumbers],
              ['Repeat calls', analytics.summary.repeatCalls],
              ['Talk time', duration(analytics.summary.totalDuration)],
              ['Average call', duration(analytics.summary.averageDuration)],
              ['Longest call', duration(analytics.summary.longest)],
              ['First call', clock(analytics.summary.firstCall)],
              ['Last call', clock(analytics.summary.lastCall)],
            ].map(([label, value]) => (
              <article key={label} className="card"><div className="stat-label">{label}</div><div className={`stat-value ${typeof value === 'string' ? 'compact' : ''}`}>{value}</div></article>
            ))}
          </div>
          <div className="grid two" style={{ marginTop: 14 }}>
            <article className="card">
              <h3>Hourly call count</h3>
              <div className="chart-box"><ResponsiveContainer><BarChart data={analytics.hourly}><XAxis dataKey="hour" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" fill="#002546" radius={6} /></BarChart></ResponsiveContainer></div>
            </article>
            <article className="card">
              <h3>Talk time by hour</h3>
              <div className="chart-box"><ResponsiveContainer><BarChart data={analytics.hourly.map((row) => ({ ...row, minutes: Math.round((row.duration || 0) / 60) }))}><XAxis dataKey="hour" /><YAxis allowDecimals={false} /><Tooltip formatter={(value) => `${value} min`} /><Bar dataKey="minutes" name="Talk minutes" fill="#FE893C" radius={6} /></BarChart></ResponsiveContainer></div>
            </article>
          </div>
        </>
      )}
      {tab === 'log' && (
        <>
          {can('calls.manual') && (
            <form className="filters" onSubmit={saveManual}>
              <input placeholder="Phone" value={manual.phone} onChange={(event) => setManual({ ...manual, phone: event.target.value })} required />
              <select value={manual.callType} onChange={(event) => setManual({ ...manual, callType: event.target.value })}><option>outgoing</option><option>incoming</option><option>missed</option></select>
              <select value={manual.status} onChange={(event) => setManual({ ...manual, status: event.target.value })}><option>connected</option><option>not_connected</option><option>missed</option></select>
              <input type="number" min="0" placeholder="Minutes" aria-label="Duration in minutes" value={manual.durationMinutes} onChange={(event) => setManual({ ...manual, durationMinutes: event.target.value })} />
              <input type="datetime-local" value={manual.startedAt} onChange={(event) => setManual({ ...manual, startedAt: event.target.value })} />
              <button className="btn" type="submit">Save manual call</button>
            </form>
          )}
          <DataTable rows={calls} empty="No calls in your view" columns={[
            { key: 'when', label: 'When', render: (row) => new Date(row.startedAt).toLocaleString() },
            { key: 'phoneDisplay', label: 'Phone' },
            { key: 'callType', label: 'Type' },
            { key: 'status', label: 'Status' },
            { key: 'durationSeconds', label: 'Talk time', render: (row) => duration(row.durationSeconds) },
            { key: 'source', label: 'Source', render: (row) => <Badge tone={row.dataSource === 'android_sync' ? 'success' : 'warning'}>{row.dataSource}</Badge> },
            { key: 'match', label: 'Match', render: (row) => row.matchStatus },
          ]} />
        </>
      )}
      {tab === 'recordings' && (
        <form onSubmit={searchRecordings}>
          <div className="filters"><input placeholder="Recording ID" value={recordingQuery} onChange={(event) => setRecordingQuery(event.target.value)} /><button className="btn" type="submit">Search</button></div>
          {recordings.map((row) => (
            <div key={row._id} className="card" style={{ marginBottom: 8 }}>
              <strong>{row.recordingId}</strong> · {row.provider} · {row.status}
              <div><button className="btn secondary" type="button" onClick={() => reveal(row._id)}>Open reference</button></div>
            </div>
          ))}
        </form>
      )}
      {tab === 'contacts' && <DataTable rows={contacts} empty="No contacts have been synced" columns={[
        { key: 'name', label: 'Name' },
        { key: 'phone', label: 'Phone' },
        { key: 'matchStatus', label: 'Match' },
        { key: 'action', label: '', render: (row) => row.matchStatus !== 'matched' && can('leads.create') ? <button className="btn secondary" type="button" onClick={() => createLead(row._id)}>Create lead</button> : (row.lead?.leadCode || '') },
      ]} />}
      {tab === 'devices' && (
        <div className="card">
          <p className="muted">Devices are registered by the Android app. The browser does not read a phone’s call log. Recording files are not stored here.</p>
          {devices.map((device) => (
            <p key={device._id}><strong>{device.deviceName}</strong> · {device.status} · call log {device.permissionSnapshot?.callLog || 'unknown'} · contacts {device.contactsSyncEnabled ? 'on' : 'off'}</p>
          ))}
          {!devices.length && <p>No devices registered for your view.</p>}
        </div>
      )}
    </Page>
  );
}
