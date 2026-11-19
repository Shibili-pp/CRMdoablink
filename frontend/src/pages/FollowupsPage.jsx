import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone } from 'lucide-react';
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

function dueLabel(value) {
  return new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function FollowupsPage() {
  const { user, toast, can } = useApp();
  const navigate = useNavigate();
  const [bucket, setBucket] = useState('today');
  const [staff, setStaff] = useState('');
  const [people, setPeople] = useState([]);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [calendar, setCalendar] = useState([]);
  const [leadRoles, setLeadRoles] = useState([]);
  const [roleFilter, setRoleFilter] = useState('');
  const canFilterStaff = user?.role && user.role !== 'STAFF';

  useEffect(() => {
    if (!canFilterStaff) return;
    api.get('/api/v1/users?limit=100').then((response) => {
      const list = response.data.data || [];
      setPeople(list.filter((person) => person.role === 'STAFF' || person.role === 'TEAM_LEADER'));
    }).catch(() => {});
  }, [canFilterStaff]);

  const load = () => {
    const params = new URLSearchParams();
    if (bucket) params.set('bucket', bucket);
    else params.set('limit', '50');
    if (canFilterStaff && staff) params.set('staff', staff);
    if (roleFilter) params.set('leadRole', roleFilter);
    const query = params.toString();
    api.get(`/api/v1/followups?${query}`).then((response) => setRows(response.data.data)).catch((error) => toast(messageFrom(error), 'error'));
    api.get(`/api/v1/followups/summary?${query}`).then((response) => setSummary(response.data.data)).catch(() => {});
    api.get(`/api/v1/followups/calendar?${query}`).then((response) => setCalendar(response.data.data.days || [])).catch(() => {});
  };
  useEffect(() => { load(); }, [bucket, staff, roleFilter]);
  useEffect(() => {
    api.get('/api/v1/meta').then((response) => setLeadRoles(response.data.data.leadRoles || [])).catch(() => {});
  }, []);

  const complete = async (id) => {
    const notes = window.prompt('Completion note') || '';
    try {
      await api.post(`/api/v1/followups/${id}/complete`, { notes });
      toast('Follow-up completed');
      load();
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  return (
    <Page title="Follow-ups" subtitle="Due work, overdue items and the month at a glance.">
      <div className="toolbar" role="tablist" aria-label="Follow-up timing">
        <div className="segment segment-scroll">
          {buckets.map(([key, label]) => (
            <button key={label} className={`btn ${bucket === key ? '' : 'secondary'}`} type="button" aria-pressed={bucket === key} onClick={() => setBucket(key)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="toolbar" role="group" aria-label="Follow-up filters">
        {canFilterStaff && (
          <label className="field"><span>Staff</span>
            <select aria-label="Staff" value={staff} onChange={(event) => setStaff(event.target.value)}>
              <option value="">All staff</option>
              {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
          </label>
        )}
        <label className="field"><span>Role</span>
          <select aria-label="Role" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            <option value="">All roles</option>
            {leadRoles.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}
          </select>
        </label>
      </div>
      {summary && (
        <div className="grid stats">
          {[['On time', summary.onTime], ['Late', summary.late], ['Pending', summary.pending], ['Overdue', summary.overdue]].map(([label, value]) => (
            <article key={label} className="card stat-card"><div className="stat-label">{label}</div><div className="stat-value">{value}</div></article>
          ))}
        </div>
      )}
      <div className="follow-days">
        {calendar.map((day) => <Badge key={day.date}>{day.date}: {day.total}</Badge>)}
      </div>
      <DataTable className="lead-book" rows={rows} empty="No follow-ups in this view" onRow={(row) => {
        const leadId = row.lead?._id || row.lead;
        if (leadId) navigate(`/leads/${leadId}`);
      }} columns={[
        { key: 'leadCode', label: 'Lead ID', hideOnMobile: true },
        { key: 'leadName', label: 'Name' },
        { key: 'leadRole', label: 'Role', render: (row) => leadRoles.find((role) => role.key === row.leadRole)?.label || '—' },
        { key: 'title', label: 'Next action' },
        ...(canFilterStaff ? [{ key: 'assigned', label: 'Staff', hideOnMobile: true, render: (row) => row.assignedTo?.name || '—' }] : []),
        { key: 'due', label: 'Due', render: (row) => dueLabel(row.dueAt) },
        { key: 'status', label: 'Status', render: (row) => <Badge tone={row.overdue || row.status === 'missed' ? 'danger' : row.status === 'completed' ? 'success' : 'info'}>{row.status}</Badge> },
        { key: 'call', label: 'Call', cellClass: 'lead-call', render: (row) => row.phoneNormalized ? (
          <a className="btn call-btn" href={`tel:+${row.phoneNormalized}`} aria-label={`Call ${row.leadName}`} onClick={(event) => event.stopPropagation()}><Phone size={16} /> Call</a>
        ) : '—' },
        { key: 'action', label: 'Done', cellClass: 'follow-done', render: (row) => row.status === 'pending' && can('followups.manage') ? <button className="btn secondary" type="button" onClick={(event) => { event.stopPropagation(); complete(row._id); }}>Complete</button> : null },
      ]} />
    </Page>
  );
}