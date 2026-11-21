import { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import { Badge, DataTable, Page } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

export default function AllowAssignPage() {
  const { toast, user } = useApp();
  const canOpen = user?.role === 'OWNER' || user?.role === 'SUPER_ADMIN';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [allow, setAllow] = useState(null);
  const [buckets, setBuckets] = useState({ sheet: 0, rnp: 0, utc: 0, bulk: 0 });
  const [shares, setShares] = useState(null);
  const [staff, setStaff] = useState([]);

  const load = () => {
    if (!canOpen) return;
    setLoading(true);
    api.get('/api/v1/lead-assignments/allow')
      .then((response) => {
        const data = response.data.data || {};
        setAllow(data.allow || null);
        setBuckets(data.buckets || { sheet: 0, rnp: 0, utc: 0, bulk: 0 });
        setShares(data.shares || null);
        setStaff((data.staff || []).map((row) => ({ ...row, present: Boolean(row.present) })));
      })
      .catch((error) => toast(messageFrom(error), 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [canOpen]);

  const presentIds = useMemo(
    () => staff.filter((row) => row.present && !row.onLeave).map((row) => row.id),
    [staff],
  );

  const totals = useMemo(() => staff.reduce((acc, row) => {
    if (!row.present) return acc;
    acc.sheet += row.plan?.sheet || 0;
    acc.rnp += row.plan?.rnp || 0;
    acc.utc += row.plan?.utc || 0;
    acc.bulk += row.plan?.bulk || 0;
    return acc;
  }, { sheet: 0, rnp: 0, utc: 0, bulk: 0 }), [staff]);

  const toggle = (id) => {
    setStaff((rows) => rows.map((row) => (row.id === id ? { ...row, present: !row.present } : row)));
  };

  const setAllPresent = (value) => {
    setStaff((rows) => rows.map((row) => (row.onLeave ? { ...row, present: false } : { ...row, present: value })));
  };

  const allowAssign = async () => {
    if (!presentIds.length) return toast('Mark at least one present staff member', 'error');
    setSaving(true);
    try {
      const response = await api.post('/api/v1/lead-assignments/allow', { presentStaffIds: presentIds });
      toast(response.data.message || 'Assigning allowed');
      load();
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!canOpen) {
    return (
      <Page title="Allow assigning" subtitle="Only Owner and Super Admin can allow morning auto-assign.">
        <p className="muted">Ask Owner or Super Admin to open this page and allow today’s assigning.</p>
      </Page>
    );
  }

  return (
    <Page
      title="Allow assigning"
      subtitle="Morning gate for auto-assign. Mark present staff, review planned sheet / RNP / UTC / unassigned counts, then Allow. Absent staff get no leads. New sheet leads later today auto-share to present staff without asking again."
      actions={(
        <>
          <button className="btn secondary" type="button" onClick={load} disabled={loading || saving}>Refresh</button>
          <button className="btn" type="button" onClick={allowAssign} disabled={loading || saving || !presentIds.length}>
            {saving ? 'Assigning…' : (allow?.allowed ? 'Allow & assign again' : 'Allow assigning')}
          </button>
        </>
      )}
    >
      <div className="grid stats" style={{ marginBottom: 14 }}>
        <article className="card"><strong>{buckets.sheet}</strong><span className="muted">Sheet in bucket</span></article>
        <article className="card"><strong>{buckets.rnp}</strong><span className="muted">RNP in bucket</span></article>
        <article className="card"><strong>{buckets.utc}</strong><span className="muted">UTC in bucket</span></article>
        <article className="card"><strong>{buckets.bulk}</strong><span className="muted">Unassigned bulk</span></article>
        <article className="card"><strong>{presentIds.length}</strong><span className="muted">Present staff</span></article>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        {allow?.allowed ? (
          <p>
            <Badge tone="success">Allowed today</Badge>
            {' '}
            {allow.dateKey}
            {allow.allowedBy?.name ? ` · by ${allow.allowedBy.name}` : ''}
            {allow.morningRunAt ? ` · last run ${new Date(allow.morningRunAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}` : ''}
          </p>
        ) : (
          <p><Badge tone="danger">Not allowed yet</Badge> Auto-assign waits until you allow for {allow?.dateKey || 'today'}.</p>
        )}
        {shares && (
          <p className="muted" style={{ marginTop: 8 }}>
            Mix after sheet: RNP {Math.round((shares.rnp || 0) * 100)}% · UTC {Math.round((shares.utc || 0) * 100)}% · Unassigned {Math.round((shares.bulkUnassigned || 0) * 100)}% · Manual TL+ {Math.round((shares.reservedManual || 0) * 100)}%
          </p>
        )}
        <p className="muted" style={{ marginTop: 6 }}>
          Planned for present staff now: sheet {totals.sheet} · RNP {totals.rnp} · UTC {totals.utc} · bulk {totals.bulk}
        </p>
      </div>

      <div className="reassign-bar">
        <button className="btn secondary" type="button" onClick={() => setAllPresent(true)}>Mark all present</button>
        <button className="btn secondary" type="button" onClick={() => setAllPresent(false)}>Mark all absent</button>
        <span className="muted">{presentIds.length} present · leave rows stay absent</span>
      </div>

      <DataTable
        className="lead-book"
        loading={loading}
        rows={staff}
        empty="No staff with managing clients"
        columns={[
          {
            key: 'present',
            label: 'Present',
            render: (row) => (
              <input
                type="checkbox"
                aria-label={`Present ${row.name}`}
                checked={Boolean(row.present) && !row.onLeave}
                disabled={row.onLeave}
                onChange={() => toggle(row.id)}
              />
            ),
          },
          { key: 'name', label: 'Staff', render: (row) => (
            <span>{row.name}{row.onLeave ? <Badge tone="danger"> Leave</Badge> : null}</span>
          ) },
          { key: 'role', label: 'Role', render: (row) => row.role === 'TEAM_LEADER' ? 'Team leader' : 'Staff' },
          { key: 'hours', label: 'Work hours', render: (row) => `${row.workStart}–${row.workEnd}` },
          { key: 'clients', label: 'Managing clients', render: (row) => (row.managingClients || []).join(', ') || '—' },
          { key: 'sheet', label: 'Sheet', render: (row) => row.plan?.sheet ?? 0 },
          { key: 'rnp', label: 'RNP', render: (row) => row.plan?.rnp ?? 0 },
          { key: 'utc', label: 'UTC', render: (row) => row.plan?.utc ?? 0 },
          { key: 'bulk', label: 'Unassigned', render: (row) => row.plan?.bulk ?? 0 },
          { key: 'today', label: 'Sheet today', render: (row) => row.sheetAssignedToday ?? 0 },
        ]}
      />
    </Page>
  );
}
