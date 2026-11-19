import { useEffect, useState } from 'react';
import api, { downloadFile } from '../api/client';
import { DataTable, Field, Modal, Page, duration } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

const COLUMNS = [
  ['totalCalls', 'Total Calls', 'Incoming plus outgoing'],
  ['incomingCalls', 'Incoming', 'Incoming calls, including missed'],
  ['outgoingCalls', 'Outgoing', 'Calls placed from this phone'],
  ['connectedCalls', 'Connected Calls', 'Outgoing calls that were answered'],
  ['prospective', 'Prospective', 'Leads added to the pipeline in this hour'],
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
  const canEdit = user?.role !== 'STAFF';
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
  const [shareFile, setShareFile] = useState(null);
  const [shareText, setShareText] = useState('');
  const [checkIns, setCheckIns] = useState([]);

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

  useEffect(() => {
    if (user?.role === 'STAFF') return undefined;
    api.get(`/api/v1/hourly-reports/check-ins?date=${date}`)
      .then((response) => setCheckIns(response.data.data || []))
      .catch(() => setCheckIns([]));
    return undefined;
  }, [date, user?.role]);

  const reportText = () => (view === 'day' ? dayReport?.text : windowReport?.text) || '';

  const copy = async () => {
    const next = reportText();
    if (!next) {
      toast('Nothing was recorded in this time', 'error');
      return;
    }
    setText(next);
    setShareText(next);
    try {
      await navigator.clipboard.writeText(next);
      toast('Report copied. Share it on WhatsApp below.');
    } catch {
      toast('Report is ready below. Use Share on WhatsApp.');
    }
  };

  const shareCopiedReport = async () => {
    const next = shareText || reportText();
    if (!next) return;
    try {
      if (window.OrbitNative?.shareText) {
        window.OrbitNative.shareText(next);
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: 'Hourly report', text: next });
        return;
      }
      window.open(`https://wa.me/?text=${encodeURIComponent(next.slice(0, 1500))}`, '_blank', 'noopener');
    } catch (error) {
      if (error?.name !== 'AbortError') toast('WhatsApp share was not completed', 'error');
    }
  };

  const excel = async () => {
    try {
      const staff = staffId ? `&staff=${staffId}` : '';
      const file = view === 'day'
        ? await downloadFile(`/api/v1/hourly-reports/export?view=day&startDate=${fromDate}&endDate=${toDate}${staff}`, 'day-report.xlsx')
        : await downloadFile(`/api/v1/hourly-reports/export?date=${date}&fromTime=${fromTime}&toTime=${toTime}${staff}`, 'hourly-report.xlsx');
      setShareFile(file);
      toast('Excel report downloaded');
    } catch (error) {
      toast(error.message || messageFrom(error), 'error');
    }
  };

  const shareExcel = async () => {
    if (!shareFile) return;
    try {
      if (window.OrbitNative?.shareFile) {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('The Excel file could not be shared'));
          reader.readAsDataURL(shareFile);
        });
        window.OrbitNative.shareFile(shareFile.name, dataUrl);
        return;
      }
      if (navigator.canShare?.({ files: [shareFile] })) {
        await navigator.share({ files: [shareFile], title: shareFile.name });
        return;
      }
      toast('This browser cannot attach the Excel file. Open WhatsApp and attach the downloaded file.');
    } catch (error) {
      if (error?.name !== 'AbortError') toast(error.message || 'WhatsApp share was not completed', 'error');
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

  const checkGroups = checkIns.reduce((groups, row) => {
    const key = row.staffId;
    if (!groups[key]) groups[key] = { name: row.staffName, rows: [] };
    groups[key].rows.push(row);
    return groups;
  }, {});

  const hourlyRows = withTotal(windowReport);
  const dayRows = withTotal(dayReport);

  return (
    <Page title="Hourly reports" subtitle="Today is the default. The table shows only the time you enter, for every role." actions={
      <>
        {view === 'hourly' && canEdit && <button className="btn secondary" type="button" onClick={() => openEditor(null)}>Add numbers</button>}
      </>
    }>
      <div className="toolbar" role="group" aria-label="Report type">
        <div className="segment">
          <button className={`btn ${view === 'hourly' ? '' : 'secondary'}`} type="button" onClick={() => setView('hourly')}>Selected time</button>
          <button className={`btn ${view === 'day' ? '' : 'secondary'}`} type="button" onClick={() => setView('day')}>Day summary</button>
        </div>
        {can('staff.view') && (
          <select aria-label="Staff" value={staffId} onChange={(event) => setStaffId(event.target.value)}>
            <option value="">All staff</option>
            {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        )}
      </div>
      {view === 'hourly' ? (
        <div className="toolbar" role="group" aria-label="Time range">
          <label className="field"><span>Date</span>
            <input type="date" aria-label="Report date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <div className="field-row">
            <label className="field"><span>From time</span>
              <input type="time" step="60" aria-label="From time" value={fromTime} onChange={(event) => setFromTime(event.target.value)} />
            </label>
            <label className="field"><span>To time</span>
              <input type="time" step="60" aria-label="To time" value={toTime} onChange={(event) => setToTime(event.target.value)} />
            </label>
          </div>
        </div>
      ) : (
        <div className="toolbar" role="group" aria-label="Day filters">
          <div className="field-row">
            <label className="field"><span>From</span>
              <input type="date" aria-label="From date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
            </label>
            <label className="field"><span>To</span>
              <input type="date" aria-label="To date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
            </label>
          </div>
        </div>
      )}
      <div className="toolbar" aria-label="Share this report">
        <div className="btn-row">
          <button className="btn secondary" type="button" onClick={excel}>Excel</button>
          <button className="btn" type="button" onClick={copy}>Copy report</button>
        </div>
      </div>
      {(shareFile || shareText) && (
        <div className="banner">
          <p>{shareFile ? 'Excel is downloaded. Share that file on WhatsApp?' : 'The report is copied. Share it on WhatsApp?'}</p>
          <div className={`btn-row ${shareFile && shareText ? '' : 'single'}`}>
            {shareFile && <button className="btn" type="button" onClick={shareExcel}>Share Excel on WhatsApp</button>}
            {shareText && <button className="btn secondary" type="button" onClick={shareCopiedReport}>Share text on WhatsApp</button>}
          </div>
        </div>
      )}
      <p className="muted">{canEdit ? 'Numbers start from calls, pipeline adds, follow-ups and payments in this time. Edit or add a row to store your own figures for this exact time.' : 'Numbers come from calls, pipeline adds, follow-ups and payments in this time. Staff cannot change them.'}</p>
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
          ...(canEdit ? [{ key: 'edit', label: '', render: (row) => row.id === 'total' ? null : <button className="btn secondary" type="button" onClick={() => openEditor(row)}>Edit</button> }] : []),
        ]} />
      ) : (
        <DataTable loading={loading} rows={dayRows} empty="Nothing was recorded in this date range." columns={[{ key: 'staff', label: 'Staff' }, ...metricColumns()]} />
      )}
      {user?.role !== 'STAFF' && (
        <section>
          <h2>Submitted hourly reports</h2>
          <p className="muted">Each staff member copies the hour from this report and explains any working target they missed. {date}</p>
          {!Object.keys(checkGroups).length && <p className="muted">No hourly report has been submitted for this date.</p>}
          {Object.entries(checkGroups).map(([key, group]) => (
            <article key={key} className="card hour-staff">
              <h3>{group.name}</h3>
              {group.rows.map((row) => (
                <div key={row.id} style={{ marginTop: 10 }}>
                  <strong>{row.label}</strong>
                  <pre className="hour-report">{row.reportText}</pre>
                  {row.reached ? <p>Working target reached.</p> : (
                    <>
                      <p className="hour-short">Target not reached.</p>
                      <p>{row.reason}</p>
                    </>
                  )}
                </div>
              ))}
            </article>
          ))}
        </section>
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
