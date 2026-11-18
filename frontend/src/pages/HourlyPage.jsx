import { useEffect, useState } from 'react';
import api, { downloadFile } from '../api/client';
import { DataTable, Field, Modal, Page } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

const COLUMNS = [
  ['totalCalls', 'Total Calls', 'Total outgoing calls'],
  ['connectedCalls', 'Connected Calls', 'Calls answered and meaningful conversations'],
  ['prospective', 'Prospective', 'Potential customers identified'],
  ['demoBooked', 'Demo Booked', 'Demos scheduled'],
  ['demoCompleted', 'Demo Completed', 'Demos successfully conducted'],
  ['followups', 'Follow-ups', 'Follow-up calls completed'],
  ['interestedToBuy', 'Interested to Buy', 'Clients showing buying interest'],
  ['subscriptionClosed', 'Subscription Closed', 'Clients who subscribed'],
  ['paymentCollected', 'Payment Collected', 'Actual money collected'],
  ['notInterested', 'Not Interested', 'Leads rejected'],
  ['dnp', 'DNP', 'Did not pick up'],
  ['rescheduled', 'Rescheduled', 'Demos postponed'],
  ['totalCallDuration', 'Total Call Duration', 'Talk time on outgoing calls'],
];

function blankValues() {
  return Object.fromEntries(COLUMNS.map(([key]) => [key, 0]));
}

function todayKey() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function duration(seconds) {
  const minutes = Math.round((Number(seconds) || 0) / 60);
  return `${Math.max(0, minutes)} min`;
}

function money(amount) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(amount) || 0);
}

function show(key, value) {
  if (key === 'paymentCollected') return money(value);
  if (key === 'totalCallDuration') return duration(value);
  return value ?? 0;
}

function metricColumns() {
  return COLUMNS.map(([key, label]) => ({ key, label, render: (row) => show(key, row[key]) }));
}

function withTotal(report) {
  if (!report?.rows?.length) return [];
  const rows = report.rows.map((row) => ({ ...row, id: row.staffId, staff: row.name }));
  if (rows.length < 2) return rows;
  return [...rows, { ...report.totals, id: 'total', staff: 'Total' }];
}

export default function HourlyPage() {
  const { user, toast, can } = useApp();
  const today = todayKey();
  const [view, setView] = useState('hourly');
  const [date, setDate] = useState(today);
  const [fromTime, setFromTime] = useState('00:00');
  const [toTime, setToTime] = useState('23:59');
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [staffId, setStaffId] = useState('');
  const [people, setPeople] = useState([]);
  const [windowReport, setWindowReport] = useState(null);
  const [dayReport, setDayReport] = useState(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState(null);
  const [values, setValues] = useState(blankValues);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!can('staff.view')) return;
    api.get('/api/v1/users?limit=100').then((response) => {
      setPeople((response.data.data || []).filter((person) => person.role === 'STAFF' || person.role === 'TEAM_LEADER'));
    }).catch(() => {});
  }, []);

  const load = () => {
    setLoading(true);
    setText('');
    const staff = staffId ? `&staff=${staffId}` : '';
    if (view === 'day') {
      api.get(`/api/v1/hourly-reports/day?startDate=${fromDate}&endDate=${toDate}${staff}`)
        .then((response) => setDayReport(response.data.data))
        .catch((error) => toast(messageFrom(error), 'error'))
        .finally(() => setLoading(false));
      return;
    }
    api.get(`/api/v1/hourly-reports/window?date=${date}&fromTime=${fromTime}&toTime=${toTime}${staff}`)
      .then((response) => setWindowReport(response.data.data))
      .catch((error) => toast(messageFrom(error), 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [view, date, fromTime, toTime, fromDate, toDate, staffId]);

  const copy = async () => {
    const reportText = view === 'day' ? dayReport?.text : windowReport?.text;
    if (!reportText) {
      toast('Nothing was recorded in this time', 'error');
      return;
    }
    setText(reportText);
    try {
      await navigator.clipboard.writeText(reportText);
      toast(view === 'day' ? 'Day report copied' : 'Report copied');
    } catch {
      toast('Report is ready below. Allow clipboard access to copy it automatically.');
    }
  };

  const excel = async () => {
    try {
      const staff = staffId ? `&staff=${staffId}` : '';
      if (view === 'day') {
        await downloadFile(`/api/v1/hourly-reports/export?view=day&startDate=${fromDate}&endDate=${toDate}${staff}`, 'day-report.xlsx');
      } else {
        await downloadFile(`/api/v1/hourly-reports/export?date=${date}&fromTime=${fromTime}&toTime=${toTime}${staff}`, 'hourly-report.xlsx');
      }
      toast('Excel report downloaded');
    } catch (error) {
      toast(error.message || messageFrom(error), 'error');
    }
  };

  const openEditor = (row) => {
    const next = blankValues();
    if (row) {
      COLUMNS.forEach(([key]) => {
        next[key] = key === 'totalCallDuration' ? Math.round((Number(row[key]) || 0) / 60) : (Number(row[key]) || 0);
      });
      setEditor({ staffId: row.staffId, name: row.staff, edited: Boolean(row.edited) });
    } else {
      const self = people[0] || { id: user?.id, name: user?.name };
      setEditor({ staffId: staffId || self?.id || '', name: '', edited: false, adding: true });
    }
    setValues(next);
  };

  const payloadValues = () => {
    const body = {};
    COLUMNS.forEach(([key]) => {
      body[key] = key === 'totalCallDuration' ? Math.round(Number(values[key]) || 0) * 60 : Number(values[key]) || 0;
    });
    return body;
  };

  const saveNumbers = async (event) => {
    event.preventDefault();
    if (!editor?.staffId) return toast('Choose a person', 'error');
    setSaving(true);
    try {
      await api.post('/api/v1/hourly-reports/manual', {
        staffId: editor.staffId,
        date,
        fromTime,
        toTime,
        values: payloadValues(),
      });
      toast('Hourly numbers saved');
      setEditor(null);
      load();
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  const restoreNumbers = async () => {
    if (!editor?.staffId) return;
    setSaving(true);
    try {
      await api.delete('/api/v1/hourly-reports/manual', { data: { staffId: editor.staffId, date, fromTime, toTime } });
      toast('Activity numbers restored');
      setEditor(null);
      load();
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  const hourlyRows = withTotal(windowReport);
  const dayRows = withTotal(dayReport);

  return (
    <Page title="Hourly reports" subtitle="Today is the default. The table shows only the time you enter, for every role." actions={
      <>
        {view === 'hourly' && <button className="btn secondary" type="button" onClick={() => openEditor(null)}>Add numbers</button>}
        <button className="btn secondary" type="button" onClick={excel}>Excel</button>
        <button className="btn" type="button" onClick={copy}>Copy report</button>
      </>
    }>
      <div className="filters" role="group" aria-label="Report type">
        <button className={`btn ${view === 'hourly' ? '' : 'secondary'}`} type="button" onClick={() => setView('hourly')}>Selected time</button>
        <button className={`btn ${view === 'day' ? '' : 'secondary'}`} type="button" onClick={() => setView('day')}>Day summary</button>
        {can('staff.view') && (
          <select aria-label="Staff" value={staffId} onChange={(event) => setStaffId(event.target.value)}>
            <option value="">All staff</option>
            {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        )}
      </div>
      {view === 'hourly' ? (
        <div className="filters" role="group" aria-label="Time range">
          <label className="field"><span>Date</span>
            <input type="date" aria-label="Report date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="field"><span>From time</span>
            <input type="time" step="60" aria-label="From time" value={fromTime} onChange={(event) => setFromTime(event.target.value)} />
          </label>
          <label className="field"><span>To time</span>
            <input type="time" step="60" aria-label="To time" value={toTime} onChange={(event) => setToTime(event.target.value)} />
          </label>
        </div>
      ) : (
        <div className="filters" role="group" aria-label="Day filters">
          <label className="field"><span>From</span>
            <input type="date" aria-label="From date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <label className="field"><span>To</span>
            <input type="date" aria-label="To date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </label>
        </div>
      )}
      <p className="muted">Numbers start from calls, status changes, follow-ups and payments in this time. Edit or add a row to store your own figures for this exact time.</p>
      <details className="card">
        <summary>What these numbers mean</summary>
        <ul className="preset-list">
          {COLUMNS.map(([key, label, hint]) => <li key={key}><span>{label}</span><span className="muted">{hint}</span></li>)}
        </ul>
      </details>
      {view === 'hourly' && windowReport && <div className="banner">Showing {windowReport.period?.label} from the database.</div>}
      {view === 'day' && dayReport && <div className="banner">Showing {dayReport.period?.label} from the database.</div>}
      {view === 'hourly' ? (
        <DataTable loading={loading} rows={hourlyRows} empty="Nothing was recorded in this time." columns={[
          { key: 'staff', label: 'Staff', render: (row) => row.id === 'total' ? row.staff : `${row.staff}${row.edited ? ' · Edited' : ''}` },
          ...metricColumns(),
          { key: 'edit', label: '', render: (row) => row.id === 'total' ? null : <button className="btn secondary" type="button" onClick={() => openEditor(row)}>Edit</button> },
        ]} />
      ) : (
        <DataTable loading={loading} rows={dayRows} empty="Nothing was recorded in this date range." columns={[{ key: 'staff', label: 'Staff' }, ...metricColumns()]} />
      )}
      {text && <pre className="card" style={{ whiteSpace: 'pre-wrap' }}>{text}</pre>}
      {editor && (
        <Modal title={editor.adding ? 'Add hourly numbers' : `Edit ${editor.name}`} onClose={() => setEditor(null)}>
          <form className="form-grid" onSubmit={saveNumbers}>
            {editor.adding && (
              <Field label="Person" full>
                <select aria-label="Person" value={editor.staffId} onChange={(event) => setEditor({ ...editor, staffId: event.target.value })} required>
                  <option value="">Choose</option>
                  {(people.length ? people : [{ id: user?.id, name: user?.name }]).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                </select>
              </Field>
            )}
            {COLUMNS.map(([key, label, hint]) => (
              <Field key={key} label={key === 'totalCallDuration' ? 'Total call duration (minutes)' : key === 'paymentCollected' ? 'Payment collected (₹)' : label}>
                <input aria-label={label} type="number" min="0" step={key === 'paymentCollected' ? '1' : '1'} value={values[key]} onChange={(event) => setValues({ ...values, [key]: event.target.value })} />
                <span className="muted">{hint}</span>
              </Field>
            ))}
            <div className="full actions">
              <button className="btn" type="submit" disabled={saving}>Save</button>
              {editor.edited && <button className="btn secondary" type="button" disabled={saving} onClick={restoreNumbers}>Use activity numbers</button>}
            </div>
          </form>
        </Modal>
      )}
    </Page>
  );
}
