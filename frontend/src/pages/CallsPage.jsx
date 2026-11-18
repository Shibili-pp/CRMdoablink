import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import api, { downloadFile } from '../api/client';
import { Badge, DataTable, Field, Page, duration } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

const SECTIONS = [
  ['overview', 'Overview'],
  ['history', 'Call History'],
  ['recordings', 'Call Recordings'],
  ['employees', 'Employee Performance'],
  ['targets', 'Calling Targets'],
  ['integrations', 'Integration Settings'],
  ['contacts', 'Contacts'],
  ['devices', 'Devices'],
];

const PRESETS = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['last7', 'Last 7 days'],
  ['last30', 'Last 30 days'],
  ['month', 'This month'],
];

const STATUSES = [
  ['connected', 'Connected'],
  ['missed', 'Missed'],
  ['rejected', 'Rejected'],
  ['busy', 'Busy'],
  ['failed', 'Failed'],
  ['no_answer', 'No answer'],
  ['not_connected', 'Not connected'],
];

const CALL_TARGETS = new Set(['daily_calls', 'daily_connected_calls', 'call_duration']);

function clock(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function rangeQuery(preset, from, to) {
  const params = new URLSearchParams();
  if (preset === 'range') {
    if (from) params.set('startDate', from);
    if (to) params.set('endDate', to);
  } else if (preset !== 'today') params.set('preset', preset);
  return params;
}

export default function CallsPage() {
  const { toast, can } = useApp();
  const navigate = useNavigate();
  const [section, setSection] = useState('overview');
  const [preset, setPreset] = useState('today');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [analytics, setAnalytics] = useState(null);
  const [calls, setCalls] = useState([]);
  const [callMeta, setCallMeta] = useState({ page: 1, pages: 1 });
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [staffId, setStaffId] = useState('');
  const [people, setPeople] = useState([]);
  const [sort, setSort] = useState('total');
  const [employeeQuery, setEmployeeQuery] = useState('');
  const [person, setPerson] = useState(null);
  const [recordings, setRecordings] = useState([]);
  const [recordingQuery, setRecordingQuery] = useState('');
  const [playback, setPlayback] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [devices, setDevices] = useState([]);
  const [targets, setTargets] = useState([]);
  const [integrations, setIntegrations] = useState(null);
  const [note, setNote] = useState({});
  const [manual, setManual] = useState({ phone: '', contactName: '', callType: 'outgoing', status: 'connected', durationMinutes: 1, startedAt: new Date().toISOString().slice(0, 16), notes: '' });

  const params = () => {
    const next = rangeQuery(preset, from, to);
    if (staffId && section !== 'employees') next.set('staff', staffId);
    if (query && section === 'history') next.set('q', query);
    return next;
  };

  useEffect(() => {
    if (!can('staff.view')) return;
    api.get('/api/v1/users?limit=100').then((response) => {
      setPeople((response.data.data || []).filter((row) => row.role === 'STAFF' || row.role === 'TEAM_LEADER'));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const queryString = params().toString();
    if (section === 'overview' || section === 'employees') {
      api.get(`/api/v1/calls/analytics?${queryString}`).then((response) => setAnalytics(response.data.data)).catch((error) => toast(messageFrom(error), 'error'));
    }
    if (section === 'history') {
      api.get(`/api/v1/calls?limit=25&page=${page}&${queryString}`).then((response) => {
        setCalls(response.data.data || []);
        setCallMeta(response.data.meta || { page: 1, pages: 1 });
      }).catch((error) => toast(messageFrom(error), 'error'));
    }
  }, [section, preset, from, to, staffId, page, query, employeeQuery]);

  useEffect(() => {
    if (section === 'recordings') {
      api.get(`/api/v1/call-recordings?limit=30&q=${encodeURIComponent(recordingQuery)}`).then((response) => setRecordings(response.data.data || [])).catch(() => setRecordings([]));
    }
    if (section === 'contacts') api.get('/api/v1/contacts?limit=30').then((response) => setContacts(response.data.data || [])).catch(() => {});
    if (section === 'devices') api.get('/api/v1/android/devices').then((response) => setDevices(response.data.data || [])).catch(() => {});
    if (section === 'targets') api.get('/api/v1/targets?limit=100').then((response) => setTargets((response.data.data || []).filter((row) => CALL_TARGETS.has(row.type)))).catch(() => {});
    if (section === 'integrations') api.get('/api/v1/calling/integrations').then((response) => setIntegrations(response.data.data)).catch((error) => toast(messageFrom(error), 'error'));
  }, [section, recordingQuery]);

  const openEmployee = (id) => {
    setSection('person');
    const queryString = rangeQuery(preset, from, to).toString();
    api.get(`/api/v1/calls/staff/${id}?${queryString}`).then((response) => setPerson(response.data.data)).catch((error) => toast(messageFrom(error), 'error'));
  };

  const saveManual = async (event) => {
    event.preventDefault();
    try {
      await api.post('/api/v1/calls/manual', {
        phone: manual.phone,
        contactName: manual.contactName,
        callType: manual.callType,
        status: manual.status,
        notes: manual.notes,
        startedAt: new Date(manual.startedAt).toISOString(),
        durationSeconds: Math.round(Number(manual.durationMinutes) * 60),
      });
      toast('Manual call saved. It is not an Android call log.');
      setPage(1);
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  const saveNote = async (id) => {
    try {
      await api.post(`/api/v1/calls/${id}/notes`, { text: note[id] || '' });
      toast('Call note saved');
      setCalls((rows) => rows.map((row) => (String(row._id) === String(id) ? { ...row, notes: note[id] } : row)));
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  const play = async (id) => {
    try {
      const response = await api.get(`/api/v1/call-recordings/${id}/play`);
      setPlayback(response.data.data);
      if (!response.data.data.playable) toast(response.data.data.reason, 'error');
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  const createLead = async (id) => {
    try {
      const response = await api.post(`/api/v1/contacts/${id}/create-lead`);
      toast(`Lead ${response.data.data.leadCode} created from this contact only`);
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  const summary = analytics?.summary;
  const employees = [...(analytics?.staff || [])]
    .filter((row) => !employeeQuery || row.name.toLowerCase().includes(employeeQuery.trim().toLowerCase()))
    .sort((a, b) => (b[sort] || 0) - (a[sort] || 0));

  return (
    <Page title="Calling analytics" subtitle="Counts come from stored call records. Android, manual and demo rows stay labeled separately." actions={
      <>
        {(section === 'overview' || section === 'employees') && <button className="btn secondary" type="button" onClick={() => downloadFile(`/api/v1/calls/employees/export?${params().toString()}`, 'calling-employees.xlsx').then(() => toast('Excel downloaded')).catch((error) => toast(messageFrom(error), 'error'))}>Excel</button>}
      </>
    }>
      <div className="follow-switch" role="tablist" aria-label="Calling sections">
        {SECTIONS.map(([key, label]) => (
          <button key={key} className={`btn ${section === key ? '' : 'secondary'}`} type="button" aria-pressed={section === key} onClick={() => setSection(key)}>{label}</button>
        ))}
      </div>
      {['overview', 'history', 'employees', 'person'].includes(section) && (
        <div className="filters" role="group" aria-label="Call dates">
          {PRESETS.map(([key, label]) => (
            <button key={key} className={`btn ${preset === key ? '' : 'secondary'}`} type="button" onClick={() => { setFrom(''); setTo(''); setPreset(key); setPage(1); }}>{label}</button>
          ))}
          <label className="field"><span>From</span>
            <input type="date" aria-label="From date" value={preset === 'range' ? from : (analytics?.period?.from || from)} onChange={(event) => { setFrom(event.target.value); setTo(preset === 'range' ? to : (analytics?.period?.to || event.target.value)); setPreset('range'); setPage(1); }} />
          </label>
          <label className="field"><span>To</span>
            <input type="date" aria-label="To date" value={preset === 'range' ? to : (analytics?.period?.to || to)} onChange={(event) => { setFrom(preset === 'range' ? from : (analytics?.period?.from || event.target.value)); setTo(event.target.value); setPreset('range'); setPage(1); }} />
          </label>
          {can('staff.view') && section !== 'person' && (
            <label className="field"><span>Employee</span>
              <select aria-label="Employee" value={staffId} onChange={(event) => { setStaffId(event.target.value); setPage(1); }}>
                <option value="">All employees</option>
                {people.map((personRow) => <option key={personRow.id} value={personRow.id}>{personRow.name}</option>)}
              </select>
            </label>
          )}
        </div>
      )}

      {section === 'overview' && summary && (
        <>
          <div className="banner">{analytics.note} Active employees: {analytics.activeEmployees || 0}. Connection rate: {summary.connectionRate || 0}%.</div>
          <div className="grid stats">
            {[
              ['Total calls', summary.total, 'Every stored call in this period'],
              ['Outgoing', summary.outgoing, 'Calls placed by the team'],
              ['Incoming', summary.incoming, 'Calls received'],
              ['Connected', summary.connected, 'Calls that were answered'],
              ['Missed', summary.missed, 'Missed calls'],
              ['Rejected', summary.rejected, 'Calls the other side rejected'],
              ['Talk time', duration(summary.totalDuration), 'Sum of stored durations'],
              ['Average call', duration(summary.averageDuration), 'Average of connected calls'],
              ['Unique numbers', summary.uniqueNumbers, 'Distinct phone numbers'],
              ['Active employees', analytics.activeEmployees || 0, 'Employees with at least one call'],
              ['Connection rate', `${summary.connectionRate || 0}%`, 'Connected calls divided by total calls'],
            ].map(([label, value, hint]) => (
              <article key={label} className="card" title={hint}><div className="stat-label">{label}</div><div className={`stat-value ${typeof value === 'string' ? 'compact' : ''}`}>{value}</div></article>
            ))}
          </div>
          <div className="grid two" style={{ marginTop: 14 }}>
            <article className="card">
              <h3>Calls by hour</h3>
              <div className="chart-box"><ResponsiveContainer><BarChart data={analytics.hourly || []}><XAxis dataKey="hour" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" fill="#002546" radius={6} /></BarChart></ResponsiveContainer></div>
            </article>
            <article className="card">
              <h3>Daily calls</h3>
              <div className="chart-box"><ResponsiveContainer><BarChart data={analytics.daily || []}><XAxis dataKey="date" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" fill="#FE893C" radius={6} /></BarChart></ResponsiveContainer></div>
            </article>
          </div>
        </>
      )}

      {section === 'history' && (
        <>
          <div className="filters">
            <label className="field"><span>Search</span>
              <input aria-label="Search calls" placeholder="Name or phone" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
            </label>
          </div>
          {can('calls.manual') && (
            <form className="form-grid card" onSubmit={saveManual}>
              <Field label="Phone"><input value={manual.phone} onChange={(event) => setManual({ ...manual, phone: event.target.value })} required /></Field>
              <Field label="Contact name"><input value={manual.contactName} onChange={(event) => setManual({ ...manual, contactName: event.target.value })} /></Field>
              <Field label="Direction"><select aria-label="Direction" value={manual.callType} onChange={(event) => setManual({ ...manual, callType: event.target.value })}><option value="outgoing">Outgoing</option><option value="incoming">Incoming</option><option value="missed">Missed</option></select></Field>
              <Field label="Status"><select aria-label="Call status" value={manual.status} onChange={(event) => setManual({ ...manual, status: event.target.value })}>{STATUSES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
              <Field label="Minutes"><input type="number" min="0" aria-label="Duration in minutes" value={manual.durationMinutes} onChange={(event) => setManual({ ...manual, durationMinutes: event.target.value })} /></Field>
              <Field label="When"><input type="datetime-local" aria-label="Call time" value={manual.startedAt} onChange={(event) => setManual({ ...manual, startedAt: event.target.value })} /></Field>
              <Field label="Note" full><input value={manual.notes} onChange={(event) => setManual({ ...manual, notes: event.target.value })} /></Field>
              <div className="full"><button className="btn" type="submit">Save manual call</button></div>
            </form>
          )}
          <DataTable rows={calls} empty="No calls in your view" page={callMeta.page} pages={callMeta.pages} onPage={setPage} columns={[
            { key: 'when', label: 'When', render: (row) => clock(row.startedAt) },
            { key: 'contact', label: 'Contact', render: (row) => row.contactName || row.lead?.name || '—' },
            { key: 'phoneDisplay', label: 'Phone' },
            { key: 'employee', label: 'Employee', render: (row) => row.staff?.name || '—' },
            { key: 'lead', label: 'Lead', render: (row) => row.lead ? <button className="btn ghost" type="button" onClick={() => navigate(`/leads/${row.lead._id}`)}>{row.lead.leadCode}</button> : row.matchStatus },
            { key: 'callType', label: 'Direction' },
            { key: 'status', label: 'Status', render: (row) => <Badge>{row.status}</Badge> },
            { key: 'durationSeconds', label: 'Duration', render: (row) => duration(row.durationSeconds) },
            { key: 'source', label: 'Source', render: (row) => <Badge tone={row.dataSource === 'android_sync' ? 'success' : 'warning'}>{row.dataSource}</Badge> },
            { key: 'note', label: 'Note', render: (row) => can('calls.manual') ? (
              <span className="actions">
                <input aria-label={`Note for ${row.phoneDisplay}`} value={note[row._id] ?? row.notes ?? ''} onChange={(event) => setNote({ ...note, [row._id]: event.target.value })} onClick={(event) => event.stopPropagation()} />
                <button className="btn secondary" type="button" onClick={(event) => { event.stopPropagation(); saveNote(row._id); }}>Save</button>
              </span>
            ) : (row.notes || '—') },
          ]} />
        </>
      )}

      {section === 'recordings' && (
        <div>
          <p className="muted">Playback works only when a recording file was uploaded to private storage. A recording reference alone cannot be played.</p>
          <div className="filters">
            <input aria-label="Search recordings" placeholder="Recording ID" value={recordingQuery} onChange={(event) => setRecordingQuery(event.target.value)} />
          </div>
          {recordings.map((row) => (
            <article key={row._id} className="card" style={{ marginBottom: 8 }}>
              <strong>{row.recordingId}</strong>
              <p className="muted">{row.staff?.name || 'Employee'} · {row.lead?.leadCode || 'No lead'} · {row.provider} · {row.status}</p>
              <button className="btn secondary" type="button" onClick={() => play(row._id)}>Play</button>
            </article>
          ))}
          {!recordings.length && <p>No recording references in your view.</p>}
          {playback && (
            <article className="card">
              {playback.playable ? <audio controls src={playback.url} /> : <p>{playback.reason}</p>}
            </article>
          )}
        </div>
      )}

      {section === 'employees' && (
        <>
          <div className="filters">
            <label className="field"><span>Search</span>
              <input aria-label="Search employees" value={employeeQuery} onChange={(event) => setEmployeeQuery(event.target.value)} />
            </label>
            <label className="field"><span>Sort</span>
              <select aria-label="Sort employees" value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="total">Total calls</option>
                <option value="connected">Connected</option>
                <option value="duration">Talk time</option>
                <option value="uniqueNumbers">Unique numbers</option>
              </select>
            </label>
          </div>
          <DataTable rows={employees.map((row) => ({ ...row, id: row.staffId }))} empty="No calls for employees in this period" onRow={(row) => openEmployee(row.staffId)} columns={[
            { key: 'name', label: 'Employee' },
            { key: 'total', label: 'Total' },
            { key: 'outgoing', label: 'Outgoing' },
            { key: 'incoming', label: 'Incoming' },
            { key: 'connected', label: 'Connected' },
            { key: 'missed', label: 'Missed' },
            { key: 'duration', label: 'Talk time', render: (row) => duration(row.duration) },
            { key: 'averageDuration', label: 'Average', render: (row) => duration(row.averageDuration) },
            { key: 'uniqueNumbers', label: 'Unique numbers' },
            { key: 'lastCall', label: 'Last call', render: (row) => clock(row.lastCall) },
          ]} />
        </>
      )}

      {section === 'person' && person && (
        <>
          <h2>{person.employee.name}</h2>
          <p className="muted">{person.period.label}. Follow-ups completed: {person.summary.followupsCompleted}.</p>
          <div className="grid stats">
            {[
              ['Total calls', person.summary.total],
              ['Connected', person.summary.connected],
              ['Missed', person.summary.missed],
              ['Talk time', duration(person.summary.totalDuration)],
              ['Average', duration(person.summary.averageDuration)],
            ].map(([label, value]) => <article key={label} className="card"><div className="stat-label">{label}</div><div className="stat-value compact">{value}</div></article>)}
          </div>
          <div className="grid two" style={{ marginTop: 14 }}>
            <article className="card">
              <h3>Daily activity</h3>
              <div className="chart-box"><ResponsiveContainer><BarChart data={person.daily}><XAxis dataKey="date" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" fill="#002546" radius={6} /></BarChart></ResponsiveContainer></div>
            </article>
            <article className="card">
              <h3>Weekly activity</h3>
              <div className="chart-box"><ResponsiveContainer><BarChart data={person.weekly}><XAxis dataKey="week" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" fill="#FE893C" radius={6} /></BarChart></ResponsiveContainer></div>
            </article>
          </div>
          <article className="card" style={{ marginTop: 14 }}>
            <h3>Most contacted leads</h3>
            {person.leads.map((lead) => <p key={lead.leadId}><button className="btn ghost" type="button" onClick={() => navigate(`/leads/${lead.leadId}`)}>{lead.leadCode} {lead.name}</button> · {lead.calls} calls · {duration(lead.duration)}</p>)}
            {!person.leads.length && <p className="muted">No matched leads in this period.</p>}
          </article>
        </>
      )}

      {section === 'targets' && (
        <div>
          <p className="muted">Call targets are the daily call, connected-call and talk-time targets already configured in Targets. They are not hardcoded.</p>
          {targets.map((target) => (
            <article key={target._id} className="card" style={{ marginBottom: 8 }}>
              <strong>{target.name}</strong>
              <p>{target.label} · {target.staff?.name || target.team?.name || target.branch?.name || 'Company'}</p>
              <p>{target.progress?.actual ?? 0} of {target.progress?.goal ?? target.value} · {target.progress?.percentage ?? 0}%</p>
            </article>
          ))}
          {!targets.length && <p>No calling targets are configured yet. Add a daily call, connected call, or talk-time target from Targets.</p>}
        </div>
      )}

      {section === 'integrations' && integrations && (
        <div className="grid two">
          {Object.entries(integrations).map(([key, item]) => (
            <article key={key} className="card">
              <h3>{key}</h3>
              <Badge tone={item.ready ? 'success' : 'warning'}>{item.ready ? 'Ready' : 'Not connected'}</Badge>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      )}

      {section === 'contacts' && <DataTable rows={contacts} empty="No contacts have been synced" columns={[
        { key: 'name', label: 'Name' },
        { key: 'phone', label: 'Phone' },
        { key: 'matchStatus', label: 'Match' },
        { key: 'action', label: '', render: (row) => row.matchStatus !== 'matched' && can('leads.create') ? <button className="btn secondary" type="button" onClick={() => createLead(row._id)}>Create lead</button> : (row.lead?.leadCode || '') },
      ]} />}

      {section === 'devices' && (
        <div className="card">
          <p className="muted">Devices are registered by the Android app. The browser does not read a phone’s call log, and it does not record both sides of a cellular call.</p>
          {devices.map((device) => (
            <p key={device._id}><strong>{device.deviceName}</strong> · {device.status} · call log {device.permissionSnapshot?.callLog || 'unknown'} · contacts {device.contactsSyncEnabled ? 'on' : 'off'}</p>
          ))}
          {!devices.length && <p>No devices registered for your view.</p>}
        </div>
      )}
    </Page>
  );
}
