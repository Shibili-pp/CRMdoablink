import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone } from 'lucide-react';
import api, { downloadFile } from '../api/client';
import SwapLeads from '../components/SwapLeads';
import { DataTable, Modal, Page, StatusBadge, LEAD_STATUS_COLORS, day } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

function roleLabel(roles, key) {
  return roles.find((role) => role.key === key)?.label || '—';
}

export default function LeadsPage() {
  const { user, can, toast } = useApp();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ q: '', status: '', source: '', priority: '', leadRole: '', assignedFrom: '', assignedTo: '', sort: '', order: '', page: 1 });
  const [meta, setMeta] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sources, setSources] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [leadRoles, setLeadRoles] = useState([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [people, setPeople] = useState([]);
  const [selected, setSelected] = useState([]);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const canAssign = can('leads.assign');

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams();
    Object.entries({ ...filters, limit: 20 }).forEach(([key, value]) => {
      if (value !== '' && value != null) params.set(key, value);
    });
    api.get(`/api/v1/leads?${params}`).then((response) => {
      setRows(response.data.data);
      setMeta(response.data.meta);
    }).catch((error) => toast(messageFrom(error), 'error')).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [filters.q, filters.status, filters.source, filters.priority, filters.leadRole, filters.assignedFrom, filters.assignedTo, filters.sort, filters.order, filters.page]);
  useEffect(() => {
    api.get('/api/v1/meta').then((response) => {
      setSources(response.data.data.sources);
      setStatuses(response.data.data.statuses);
      setLeadRoles(response.data.data.leadRoles || []);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!canAssign) return;
    api.get('/api/v1/lead-assignments/workload').then((response) => setPeople(response.data.data || [])).catch(() => {});
  }, [canAssign]);

  const toggleSelected = (id) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

  const reassign = async (staffId) => {
    try {
      const response = await api.post('/api/v1/lead-assignments', { leadIds: selected, staffId, reason: 'Reassigned from lead management' });
      const count = response.data.data?.assigned || 0;
      toast(count ? `Reassigned ${count} lead${count === 1 ? '' : 's'}` : 'Could not reassign');
      setReassignOpen(false);
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

  return (
    <Page title="Lead Management" subtitle="Search, filter and update the live lead book." actions={
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
          <label className="field"><span>Role</span>
            <select aria-label="Role" value={filters.leadRole} onChange={(event) => setFilters({ ...filters, leadRole: event.target.value, page: 1 })}>
              <option value="">All roles</option>
              {leadRoles.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}
            </select>
          </label>
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
              <option value="">Newest created</option>
              <option value="assignmentDate:desc">Newest assigned</option>
              <option value="assignmentDate:asc">Oldest assigned</option>
              <option value="lastContactedAt:desc">Last contacted</option>
              <option value="name:asc">Name A–Z</option>
            </select>
          </label>
        </div>
      </div>
      {canAssign && (
        <div className="reassign-bar">
          <button className="btn secondary" type="button" onClick={() => setSwapOpen(true)}>Swap leads</button>
          {selected.length > 0 && <span>{selected.length} selected</span>}
          {selected.length > 0 && <button className="btn" type="button" onClick={() => setReassignOpen(true)}>Reassign</button>}
          {selected.length > 0 && <button className="btn secondary" type="button" onClick={() => setSelected([])}>Clear</button>}
        </div>
      )}
      <DataTable
        className="lead-book"
        loading={loading}
        rows={rows}
        page={meta?.page || 1}
        pages={meta?.pages || 1}
        onPage={(page) => setFilters({ ...filters, page })}
        onRow={(row) => navigate(`/leads/${row._id}`)}
        empty="No leads match these filters"
        columns={[
          ...(canAssign ? [{
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
          { key: 'leadRole', label: 'Role', render: (row) => roleLabel(leadRoles, row.leadRole) },
          { key: 'phoneDisplay', label: 'Phone', ...mobile(false) },
          { key: 'source', label: 'Source', hide: true, ...mobile(false) },
          { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} label={statuses.find((item) => item.key === row.status)?.label} /> },
          { key: 'assigned', label: 'Assigned', render: (row) => row.assignedTo?.name || 'Bucket', hide: true, ...mobile(false) },
          { key: 'lastContacted', label: 'Last contacted', render: (row) => day(row.lastContactedAt), ...mobile(false) },
          { key: 'priority', label: 'Priority', hide: true, ...mobile(false) },
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
        ]}
      />
      {reassignOpen && (
        <Modal title="Reassign" onClose={() => setReassignOpen(false)}>
          <p className="muted">The lead keeps its timeline. Open follow-ups move to the staff member you choose.</p>
          <div className="staff-list">
            {people.map((person) => (
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
