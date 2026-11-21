import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone } from 'lucide-react';
import api, { downloadFile } from '../api/client';
import SwapLeads from '../components/SwapLeads';
import { DataTable, FirmBadge, PriorityBadge, Modal, Page, StatusBadge, LEAD_STATUS_COLORS, day } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

function roleLabel(roles, key) {
  return roles.find((role) => role.key === key)?.label || '—';
}

function staleUntouched(row) {
  if (!row?.assignmentDate) return false;
  return Date.now() - new Date(row.assignmentDate).getTime() >= 24 * 60 * 60 * 1000;
}

export default function LeadsPage() {
  const { user, can, toast } = useApp();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ q: '', status: '', source: '', priority: '', leadRole: '', firm: '', staff: '', assignedFrom: '', assignedTo: '', sort: 'assignmentDate', order: 'desc', page: 1 });
  const [meta, setMeta] = useState(null);
  const [rows, setRows] = useState([]);
  const [untouchedPage, setUntouchedPage] = useState(1);
  const [untouchedMeta, setUntouchedMeta] = useState(null);
  const [untouchedRows, setUntouchedRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sources, setSources] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [leadRoles, setLeadRoles] = useState([]);
  const [leadFirms, setLeadFirms] = useState([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [people, setPeople] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [selected, setSelected] = useState([]);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignLead, setReassignLead] = useState(null);
  const [swapOpen, setSwapOpen] = useState(false);
  const canAssign = can('leads.assign');
  const canDelete = can('leads.delete');
  const canSelect = canAssign || canDelete;
  const canFilterStaff = can('staff.view') || ['TEAM_LEADER', 'ADMIN', 'SUPER_ADMIN', 'OWNER'].includes(user?.role);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams();
    Object.entries({ ...filters, limit: 20 }).forEach(([key, value]) => {
      if (value !== '' && value != null) params.set(key, value);
    });
    const worked = new URLSearchParams(params);
    worked.set('touch', 'worked');
    const untouched = new URLSearchParams(params);
    untouched.set('touch', 'untouched');
    untouched.set('page', String(untouchedPage));
    untouched.set('sort', 'assignmentDate');
    untouched.set('order', 'desc');
    Promise.all([
      api.get(`/api/v1/leads?${worked}`),
      api.get(`/api/v1/leads?${untouched}`),
    ]).then(([workedResponse, untouchedResponse]) => {
      setRows(workedResponse.data.data);
      setMeta(workedResponse.data.meta);
      setUntouchedRows(untouchedResponse.data.data);
      setUntouchedMeta(untouchedResponse.data.meta);
    }).catch((error) => toast(messageFrom(error), 'error')).finally(() => setLoading(false));
  };

  useEffect(() => { setUntouchedPage(1); }, [filters.q, filters.status, filters.source, filters.priority, filters.leadRole, filters.firm, filters.staff, filters.assignedFrom, filters.assignedTo, filters.sort, filters.order]);
  useEffect(() => { load(); }, [filters.q, filters.status, filters.source, filters.priority, filters.leadRole, filters.firm, filters.staff, filters.assignedFrom, filters.assignedTo, filters.sort, filters.order, filters.page, untouchedPage]);
  useEffect(() => {
    api.get('/api/v1/meta').then((response) => {
      setSources(response.data.data.sources);
      setStatuses(response.data.data.statuses);
      setLeadRoles(response.data.data.leadRoles || []);
      setLeadFirms(response.data.data.leadFirms || []);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!canAssign) return;
    api.get('/api/v1/lead-assignments/workload').then((response) => setPeople(response.data.data || [])).catch(() => {});
  }, [canAssign]);
  useEffect(() => {
    if (!canFilterStaff) return;
    api.get('/api/v1/users?limit=100').then((response) => {
      const list = (response.data.data || []).filter((row) => row.role === 'STAFF' || row.role === 'TEAM_LEADER');
      setStaffList(list);
    }).catch(() => {});
  }, [canFilterStaff]);

  const toggleSelected = (id) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

  const visibleIds = [...untouchedRows, ...rows].map((row) => row._id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));
  const selectAllVisible = () => {
    if (!visibleIds.length) return;
    if (allVisibleSelected) {
      setSelected((current) => current.filter((id) => !visibleIds.includes(id)));
      return;
    }
    setSelected((current) => [...new Set([...current, ...visibleIds])]);
  };

  const reassign = async (staffId) => {
    const leadIds = reassignLead ? [reassignLead._id] : selected;
    if (!leadIds.length) return;
    try {
      const response = await api.post('/api/v1/lead-assignments', { leadIds, staffId, reason: 'Reassigned from lead management' });
      const count = response.data.data?.assigned || 0;
      toast(count ? `Reassigned ${count} lead${count === 1 ? '' : 's'}` : 'Could not reassign');
      setReassignOpen(false);
      setReassignLead(null);
      setSelected([]);
      load();
    } catch (error) {
      toast(messageFrom(error), 'error');
    }
  };

  const addPipeline = async (id, event) => {
    event.stopPropagation();
    try {
      await api.post(`/api/v1/leads/${id}/pipeline`);
      toast('Added to pipeline');
      load();
    } catch (error) {
      toast(messageFrom(error), 'error');
    }
  };

  const deleteSelected = async () => {
    if (!canDelete || !selected.length) return;
    const count = selected.length;
    if (!window.confirm(`Delete ${count} selected lead${count === 1 ? '' : 's'}? This removes them from lead management.`)) return;
    try {
      const response = await api.post('/api/v1/leads/bulk/delete', { leadIds: selected });
      const deleted = response.data.data?.deleted || 0;
      toast(response.data.message || (deleted ? `Deleted ${deleted} lead${deleted === 1 ? '' : 's'}` : 'No leads were deleted'));
      setSelected([]);
      load();
    } catch (error) {
      toast(messageFrom(error), 'error');
    }
  };

  const exportLeads = async (format) => {
    try {
      const params = new URLSearchParams();
      Object.entries({ ...filters, format }).forEach(([key, value]) => {
        if (value !== '' && value != null) params.set(key, value);
      });
      await downloadFile(`/api/v1/leads/export?${params}`, `leads.${format === 'csv' ? 'csv' : 'xlsx'}`);
    } catch (error) {
      toast(messageFrom(error), 'error');
    }
  };

  const staffPhone = user?.role === 'STAFF';
  const mobile = (keep) => (staffPhone && !keep ? { hideOnMobile: true } : {});
  const leadColumns = (untouched) => [
    ...(canSelect ? [{
      key: 'pick',
      label: 'Select',
      cellClass: 'lead-pick',
      render: (row) => (
        <input type="checkbox" aria-label={`Select ${row.name}`} checked={selected.includes(row._id)} onClick={(event) => event.stopPropagation()} onChange={() => toggleSelected(row._id)} />
      ),
    }] : []),
    { key: 'assignedDay', label: staffPhone ? 'Assigned date' : 'Assigned day', render: (row) => day(row.assignmentDate) },
    { key: 'leadCode', label: 'Lead ID', ...mobile(false) },
    { key: 'name', label: 'Name' },
    { key: 'priority', label: 'Priority', render: (row) => <PriorityBadge priority={row.priority} /> },
    { key: 'leadRole', label: 'Client', render: (row) => roleLabel(leadRoles, row.leadRole) },
    { key: 'firm', label: 'Firm', render: (row) => <FirmBadge firm={row.firm} firms={leadFirms} /> },
    { key: 'phoneDisplay', label: 'Phone', ...mobile(false) },
    { key: 'source', label: 'Source', hide: true, ...mobile(false) },
    { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} label={statuses.find((item) => item.key === row.status)?.label} /> },
    { key: 'assigned', label: 'Assigned', render: (row) => row.assignedTo?.name || 'Bucket', ...(untouched ? {} : { hide: true }), ...mobile(false) },
    { key: 'lastContacted', label: 'Last contacted', render: (row) => day(row.lastContactedAt), ...mobile(false) },
    { key: 'expectedRevenue', label: 'Expected', hide: true, ...mobile(false) },
    { key: 'follow', label: staffPhone ? 'Follow-up date' : 'Next follow-up', render: (row) => row.followUpAt ? (staffPhone ? day(row.followUpAt) : new Date(row.followUpAt).toLocaleString()) : '—' },
    ...(staffPhone ? [{ key: 'nextAction', label: 'Next action', render: (row) => row.nextActionTitle || '—' }] : []),
    { key: 'age', label: 'Age', render: (row) => `${row.ageDays}d`, hide: true, ...mobile(false) },
    { key: 'call', label: 'Call', cellClass: 'lead-call', render: (row) => row.phoneNormalized ? (
      <a className="btn call-btn" href={`tel:+${row.phoneNormalized}`} aria-label={`Call ${row.name}`} onClick={(event) => event.stopPropagation()}><Phone size={16} /> Call</a>
    ) : '—' },
    { key: 'pipeline', label: 'Pipeline', ...mobile(false), render: (row) => row.inPipeline
      ? <button className="btn secondary" type="button" onClick={(event) => { event.stopPropagation(); navigate('/pipeline'); }}>In pipeline</button>
      : (can('leads.edit') ? <button className="btn secondary" type="button" onClick={(event) => addPipeline(row._id, event)}>Add to pipeline</button> : null) },
    ...(untouched && canAssign ? [{
      key: 'reassignOne',
      label: 'Reassign',
      render: (row) => (staleUntouched(row) ? (
        <button className="btn" type="button" onClick={(event) => { event.stopPropagation(); setReassignLead(row); }}>Reassign</button>
      ) : null),
    }] : []),
  ];

  return (
    <Page title="Lead Management" subtitle="Search, filter and update the live lead book. Team Leader+ can reassign leads manually (reserved 15% of daily mix — e.g. not interested → another staff)." actions={
      <>
        {can('leads.export') && <button className="btn secondary" type="button" onClick={() => exportLeads('xlsx')}>Excel</button>}
        {can('leads.export') && <button className="btn secondary" type="button" onClick={() => exportLeads('csv')}>CSV</button>}
        {canAssign && <button className="btn secondary" type="button" onClick={() => setSwapOpen(true)}>Swap leads</button>}
      </>
    }>
      <div className="filters lead-filters">
        <label className="field lead-search"><span>Search</span>
          <input placeholder="Name, phone or lead ID" aria-label="Search leads" value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value, page: 1 })} />
        </label>
        <button className="btn secondary filters-toggle" type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>{filtersOpen ? 'Hide filters' : 'Filters'}</button>
        <div className={`lead-filters-more ${filtersOpen ? 'open' : ''}`}>
          <label className="field span-2"><span>Status</span>
            <select aria-label="Status" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value, page: 1 })}>
              <option value="">All statuses</option>
              {statuses.map((status) => {
                const color = LEAD_STATUS_COLORS[status.key] || { bg: '#eef2f7', fg: '#334155' };
                return <option key={status.key} value={status.key} style={{ background: color.bg, color: color.fg }}>{status.label}</option>;
              })}
            </select>
          </label>
          <label className="field"><span>Client</span>
            <select aria-label="Client" value={filters.leadRole} onChange={(event) => setFilters({ ...filters, leadRole: event.target.value, page: 1 })}>
              <option value="">All clients</option>
              {leadRoles.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}
            </select>
          </label>
          <label className="field"><span>Firm</span>
            <select aria-label="Firm" value={filters.firm} onChange={(event) => setFilters({ ...filters, firm: event.target.value, page: 1 })}>
              <option value="">All firms</option>
              {leadFirms.map((firm) => <option key={firm.key} value={firm.key}>{firm.label}</option>)}
            </select>
          </label>
          {canFilterStaff && (
            <label className="field"><span>Staff</span>
              <select aria-label="Staff" value={filters.staff} onChange={(event) => setFilters({ ...filters, staff: event.target.value, page: 1 })}>
                <option value="">All staff</option>
                {staffList.map((person) => (
                  <option key={person.id || person._id} value={person.id || person._id}>
                    {person.name} · {person.role === 'TEAM_LEADER' ? 'Team leader' : 'Staff'}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field"><span>Source</span>
            <select aria-label="Source" value={filters.source} onChange={(event) => setFilters({ ...filters, source: event.target.value, page: 1 })}>
              <option value="">All sources</option>
              {sources.map((source) => <option key={source}>{source}</option>)}
            </select>
          </label>
          <label className="field"><span>Priority</span>
            <select aria-label="Priority" value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value, page: 1 })}>
              <option value="">All priorities</option>
              {['low', 'medium', 'high', 'urgent'].map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="field"><span>Assigned from</span>
            <input type="date" aria-label="Assigned from" value={filters.assignedFrom} onChange={(event) => setFilters({ ...filters, assignedFrom: event.target.value, page: 1 })} />
          </label>
          <label className="field"><span>Assigned to</span>
            <input type="date" aria-label="Assigned to" value={filters.assignedTo} onChange={(event) => setFilters({ ...filters, assignedTo: event.target.value, page: 1 })} />
          </label>
          <label className="field span-2"><span>Sort</span>
            <select aria-label="Sort leads" value={filters.sort ? `${filters.sort}:${filters.order}` : ''} onChange={(event) => {
              const [sort, order] = event.target.value.split(':');
              setFilters({ ...filters, sort: sort || '', order: order || '', page: 1 });
            }}>
              <option value="assignmentDate:desc">Newest assigned</option>
              <option value="createdAt:desc">Newest created</option>
              <option value="assignmentDate:asc">Oldest assigned</option>
              <option value="lastContactedAt:desc">Last contacted</option>
              <option value="name:asc">Name A–Z</option>
            </select>
          </label>
        </div>
      </div>
      {canSelect && (
        <div className="reassign-bar">
          <button className="btn secondary" type="button" onClick={selectAllVisible} disabled={!visibleIds.length}>
            {allVisibleSelected ? 'Unselect all' : 'Select all'}
          </button>
          {canAssign && <button className="btn secondary" type="button" onClick={() => setSwapOpen(true)}>Swap leads</button>}
          {selected.length > 0 && <span>{selected.length} selected</span>}
          {canAssign && selected.length > 0 && <button className="btn" type="button" onClick={() => setReassignOpen(true)}>Reassign</button>}
          {canDelete && selected.length > 0 && <button className="btn danger" type="button" onClick={deleteSelected}>Delete</button>}
          {selected.length > 0 && <button className="btn secondary" type="button" onClick={() => setSelected([])}>Clear</button>}
        </div>
      )}
      <section className="lead-section" aria-label="Untouched leads">
        <h2>Untouched leads{untouchedMeta?.total ? ` (${untouchedMeta.total})` : ''}</h2>
        <p className="muted">Assigned leads whose staff member has not changed the status. High priority call leads show first. A lead still untouched after 24 hours is shown in red.</p>
        <DataTable
          className="lead-book"
          loading={loading}
          rows={untouchedRows}
          page={untouchedMeta?.page || 1}
          pages={untouchedMeta?.pages || 1}
          onPage={setUntouchedPage}
          onRow={(row) => navigate(`/leads/${row._id}`)}
          rowClass={(row) => [
            canAssign && staleUntouched(row) ? 'lead-stale' : '',
            row.priority === 'high' || row.priority === 'urgent' ? 'lead-priority-high' : '',
          ].filter(Boolean).join(' ')}
          empty="No untouched leads"
          columns={leadColumns(true)}
        />
      </section>
      <section className="lead-section" aria-label="Other leads">
        <h2>Leads{meta?.total ? ` (${meta.total})` : ''}</h2>
        <p className="muted">High priority leads for calling show first, then newest assignment.</p>
      <DataTable
        className="lead-book"
        loading={loading}
        rows={rows}
        page={meta?.page || 1}
        pages={meta?.pages || 1}
        onPage={(page) => setFilters({ ...filters, page })}
        onRow={(row) => navigate(`/leads/${row._id}`)}
        rowClass={(row) => (row.priority === 'high' || row.priority === 'urgent' ? 'lead-priority-high' : '')}
        empty="No leads match these filters"
        columns={leadColumns(false)}
      />
      </section>
      {(reassignOpen || reassignLead) && (
        <Modal title={reassignLead ? `Reassign ${reassignLead.name}` : 'Reassign'} onClose={() => { setReassignOpen(false); setReassignLead(null); }}>
          <p className="muted">The lead keeps its timeline. Open follow-ups move to the staff member you choose.</p>
          <div className="staff-list">
            {people.filter((person) => String(person.id) !== String(reassignLead?.assignedTo?._id || reassignLead?.assignedTo?.id || '')).map((person) => (
              <button key={person.id} className="btn secondary" type="button" onClick={() => reassign(person.id)}>{person.name}</button>
            ))}
          </div>
        </Modal>
      )}
      {swapOpen && (
        <SwapLeads people={people} statuses={statuses} leadRoles={leadRoles} toast={toast} onClose={() => setSwapOpen(false)} onDone={() => { setSwapOpen(false); setSelected([]); load(); }} />
      )}
    </Page>
  );
}
