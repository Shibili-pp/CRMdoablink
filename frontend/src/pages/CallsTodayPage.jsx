import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone } from 'lucide-react';
import api from '../api/client';
import { Badge, DataTable, FirmBadge, Page, PriorityBadge, StatusBadge } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

function clock(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function CallsTodayPage() {
  const { toast, can, user } = useApp();
  const navigate = useNavigate();
  const canFilterStaff = can('staff.view') || ['TEAM_LEADER', 'ADMIN', 'SUPER_ADMIN', 'OWNER'].includes(user?.role);
  const [staffId, setStaffId] = useState('');
  const [people, setPeople] = useState([]);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, pages: 1, total: 0, summary: null, date: '' });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [leadRoles, setLeadRoles] = useState([]);
  const [leadFirms, setLeadFirms] = useState([]);

  useEffect(() => {
    if (!canFilterStaff) return;
    api.get('/api/v1/users?limit=100').then((response) => {
      const list = (response.data.data || []).filter((row) => row.role === 'STAFF' || row.role === 'TEAM_LEADER');
      setPeople(list);
    }).catch(() => {});
  }, [canFilterStaff]);

  useEffect(() => {
    api.get('/api/v1/meta').then((response) => {
      setLeadRoles(response.data.data?.leadRoles || []);
      setLeadFirms(response.data.data?.leadFirms || []);
    }).catch(() => {});
  }, []);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '50', page: String(page) });
    if (staffId) params.set('staff', staffId);
    api.get(`/api/v1/calls/today-queue?${params}`)
      .then((response) => {
        setRows(response.data.data || []);
        setMeta(response.data.meta || { page: 1, pages: 1, total: 0, summary: null });
      })
      .catch((error) => toast(messageFrom(error), 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [staffId, page]);
  useEffect(() => { setPage(1); }, [staffId]);

  const selectedName = staffId
    ? (people.find((person) => String(person.id || person._id) === String(staffId))?.name || 'Selected staff')
    : (canFilterStaff ? 'All under you' : 'You');
  const summary = meta.summary || {};
  const target = summary.dailyTarget || 120;
  const onList = summary.toCall ?? meta.total ?? 0;
  const roomForAuto = Math.max(0, target - Number(onList || 0));
  const roleLabel = (key) => leadRoles.find((item) => item.key === key)?.label || key || '—';

  const holdAssigned = Boolean(summary.holdAssigned);

  return (
    <Page
      title="Calls today"
      subtitle={holdAssigned
        ? `${selectedName} · Owner Hold assigned is ON · dial list paused · Asia/Kolkata${meta.date ? ` · ${meta.date}` : ''}`
        : `${selectedName} · hold leads stay here until bucket · target ${target} · Asia/Kolkata${meta.date ? ` · ${meta.date}` : ''}`}
      actions={<button className="btn secondary" type="button" onClick={load}>Refresh</button>}
    >
      {holdAssigned && (
        <div className="banner" style={{ marginBottom: 14 }}>
          Hold assigned leads is ON. Use Lead Management to set follow-up status, dates, and clean Excel data. Calls Today stays empty until Owner turns Hold OFF.
        </div>
      )}
      {canFilterStaff && (
        <div className="filters">
          <label className="field"><span>Staff</span>
            <select
              aria-label="Staff filter"
              value={staffId}
              onChange={(event) => setStaffId(event.target.value)}
            >
              <option value="">All staff under you</option>
              {people.map((person) => (
                <option key={person.id || person._id} value={person.id || person._id}>
                  {person.name} · {person.role === 'TEAM_LEADER' ? 'Team leader' : 'Staff'}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="grid stats" style={{ marginBottom: 14 }}>
        <article className="card"><strong>{onList || '—'}</strong><span className="muted">To call today</span></article>
        <article className="card"><strong>{summary.freshHold ?? '—'}</strong><span className="muted">Fresh / not contacted</span></article>
        <article className="card"><strong>{summary.rnpHold ?? summary.rnpDue ?? '—'}</strong><span className="muted">RNP hold</span></article>
        <article className="card"><strong>{summary.utcHold ?? '—'}</strong><span className="muted">UTC hold</span></article>
        <article className="card"><strong>{summary.sheetToday ?? '—'}</strong><span className="muted">Sheet today</span></article>
        <article className="card"><strong>{summary.highPriority ?? '—'}</strong><span className="muted">High priority</span></article>
        <article className="card"><strong>{roomForAuto}</strong><span className="muted">Room for auto (of {target})</span></article>
      </div>

      <section className="lead-section" aria-label="Today call list">
        <h2>Today’s dial list{meta.total != null ? ` (${meta.total})` : ''}</h2>
        <p className="muted">
          Order: 1) Inbound (sheet) by priority · 2) Admin+ manual assigns by priority · then other holds.
          Fresh / Not Contacted (3 working days), RNP and UTC stay here until they move to the bucket.
          Staff should keep dialing. Example: 40 holds + 20 sheet = 60; auto fills the rest to {target}.
          Leads leave when status changes or they return to the bucket.
        </p>
      </section>

      <DataTable
        className="lead-book"
        loading={loading}
        rows={rows}
        page={meta.page || 1}
        pages={meta.pages || 1}
        onPage={setPage}
        empty={holdAssigned ? 'Dial list paused while Hold assigned is ON' : 'No hold leads to call today'}
        onRow={(row) => navigate(`/leads/${row._id || row.id}`)}
        rowClass={(row) => {
          if (row.fromSheet || row.callQueueTier === 1) return 'lead-inbound';
          if (row.callQueueTier === 2) return 'lead-admin-manual';
          return '';
        }}
        columns={[
          { key: 'assignedAt', label: 'Assigned', render: (row) => clock(row.assignmentDate) },
          ...(canFilterStaff ? [{ key: 'staff', label: 'Staff', render: (row) => row.assignedTo?.name || '—' }] : []),
          { key: 'leadCode', label: 'Lead ID' },
          {
            key: 'name',
            label: 'Name',
            render: (row) => (
              <span className="lead-name-cell">
                <span>{row.name}</span>
                {(row.fromSheet || row.callQueueTier === 1) ? <Badge tone="danger">Inbound lead</Badge> : null}
                {row.callQueueTier === 2 && !row.fromSheet ? <Badge tone="warning">Manual assign</Badge> : null}
              </span>
            ),
          },
          { key: 'priority', label: 'Priority', render: (row) => <PriorityBadge priority={row.priority} /> },
          { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} /> },
          { key: 'leadRole', label: 'Client', render: (row) => roleLabel(row.leadRole) },
          { key: 'firm', label: 'Firm', render: (row) => <FirmBadge firm={row.firm} firms={leadFirms} /> },
          { key: 'phone', label: 'Phone', render: (row) => row.phoneDisplay || '—' },
          { key: 'call', label: 'Call', cellClass: 'lead-call', render: (row) => row.phoneNormalized ? (
            <a
              className="btn call-btn"
              href={`tel:+${row.phoneNormalized}`}
              aria-label={`Call ${row.name}`}
              onClick={(event) => event.stopPropagation()}
            >
              <Phone size={16} /> Call
            </a>
          ) : '—' },
        ]}
      />
    </Page>
  );
}
