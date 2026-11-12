import { useEffect, useState } from 'react';
import api from '../api/client';
import { Badge, DataTable, Page } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

const buckets = [
  ['today', 'Today'],
  ['upcoming', 'Upcoming'],
  ['overdue', 'Overdue'],
  ['missed', 'Missed'],
  ['', 'All'],
];

export default function FollowupsPage() {
  const { toast, can } = useApp();
  const [bucket, setBucket] = useState('today');
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [calendar, setCalendar] = useState([]);

  const load = () => {
    const params = bucket ? `bucket=${bucket}` : 'limit=50';
    api.get(`/api/v1/followups?${params}`).then((response) => setRows(response.data.data)).catch((error) => toast(messageFrom(error), 'error'));
    api.get('/api/v1/followups/summary').then((response) => setSummary(response.data.data)).catch(() => {});
    api.get('/api/v1/followups/calendar').then((response) => setCalendar(response.data.data.days || [])).catch(() => {});
  };
  useEffect(() => { load(); }, [bucket]);

  const complete = async (id) => {
    const notes = window.prompt('Completion note') || '';
    try {
      await api.post(`/api/v1/followups/${id}/complete`, { notes });
      toast('Follow-up completed');
      load();
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  return (
    <Page title="Follow-ups" subtitle="Due work, overdue items and the month at a glance." actions={buckets.map(([key, label]) => (
      <button key={label} className={`btn ${bucket === key ? '' : 'secondary'}`} type="button" onClick={() => setBucket(key)}>{label}</button>
    ))}>
      {summary && <div className="grid stats" style={{ marginBottom: 14 }}>
        {[['On time', summary.onTime], ['Late', summary.late], ['Pending', summary.pending], ['Overdue', summary.overdue]].map(([label, value]) => (
          <article key={label} className="card"><div className="stat-label">{label}</div><div className="stat-value">{value}</div></article>
        ))}
      </div>}
      <div className="cluster" style={{ marginBottom: 12 }}>
        {calendar.map((day) => <Badge key={day.date}>{day.date}: {day.total}</Badge>)}
      </div>
      <DataTable rows={rows} empty="No follow-ups in this view" columns={[
        { key: 'leadCode', label: 'Lead ID' },
        { key: 'leadName', label: 'Lead' },
        { key: 'title', label: 'Title' },
        { key: 'due', label: 'Due', render: (row) => new Date(row.dueAt).toLocaleString() },
        { key: 'status', label: 'Status', render: (row) => <Badge tone={row.overdue || row.status === 'missed' ? 'danger' : row.status === 'completed' ? 'success' : 'info'}>{row.status}</Badge> },
        { key: 'action', label: '', render: (row) => row.status === 'pending' && can('followups.manage') ? <button className="btn secondary" type="button" onClick={(event) => { event.stopPropagation(); complete(row._id); }}>Complete</button> : null },
      ]} />
    </Page>
  );
}
