import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone } from 'lucide-react';
import api, { downloadFile } from '../api/client';
import { DataTable, FirmBadge, PriorityBadge, Page, StatusBadge, LEAD_STATUS_COLORS, day } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

function roleLabel(roles, key) {
  return roles.find((role) => role.key === key)?.label || key || '—';
}

function countFor(facets, group, key) {
  const rows = facets?.[group] || [];
  const match = rows.find((row) => String(row.key) === String(key));
  return match?.count ?? 0;
}

export default function AllLeadsPage() {
  const { user, can, toast } = useApp();
  const navigate = useNavigate();
  const canOpen = user?.role === 'OWNER' || user?.role === 'SUPER_ADMIN';
  const canDelete = can('leads.delete') || canOpen;
  const [filters, setFilters] = useState({
    q: '', status: '', source: '', priority: '', leadRole: '', firm: '', staff: '',
    bucket: '', fromSheet: '', assignedFrom: '', assignedTo: '',
    sort: 'createdAt', order: 'desc', page: 1,
  });
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({});
  const [facets, setFacets] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState([]);
  const [sources, setSources] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [leadRoles, setLeadRoles] = useState([]);
  const [leadFirms, setLeadFirms] = useState([]);
  const [filtersOpen, setFiltersOpen] = useState(true);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams({ view: 'all', limit: '25' });
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== '' && value != null) params.set(key, value);
    });
    return params;
  }, [filters]);

  const load = () => {
    if (!canOpen) return;
    setLoading(true);
    const facetParams = new URLSearchParams(queryParams);
    facetParams.delete('page');
    facetParams.delete('limit');
    facetParams.delete('sort');
    facetParams.delete('order');
    Promise.all([
      api.get(`/api/v1/leads?${queryParams}`),
      api.get(`/api/v1/leads-all/facets?${facetParams}`),
    ]).then(([listRes, facetRes]) => {
      setRows(listRes.data.data || []);
      setMeta(listRes.data.meta || {});
      setFacets(facetRes.data.data || null);
    }).catch((error) => toast(messageFrom(error), 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    api.get('/api/v1/meta').then((response) => {
      setSources(response.data.data.sources || []);
      setStatuses(response.data.data.statuses || []);
      setLeadRoles(response.data.data.leadRoles || []);
      setLeadFirms(response.data.data.leadFirms || []);
    }).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [queryParams.toString(), canOpen]);
  useEffect(() => { setSelected([]); }, [filters.q, filters.status, filters.source, filters.priority, filters.leadRole, filters.firm, filters.staff, filters.bucket, filters.fromSheet, filters.assignedFrom, filters.assignedTo, filters.page]);

  const visibleIds = rows.map((row) => row._id || row.id).filter(Boolean);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));
  const toggleSelected = (id) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  const selectAllVisible = () => {
    if (!visibleIds.length) return;
    if (allVisibleSelected) {
      setSelected((current) => current.filter((id) => !visibleIds.includes(id)));
      return;
    }
    setSelected((current) => [...new Set([...current, ...visibleIds])]);
  };

  const deleteSelected = async () => {
    if (!canDelete || !selected.length) return;
    const count = selected.length;
    if (!window.confirm(`Delete ${count} selected lead${count === 1 ? '' : 's'}? This removes them from the lead book.`)) return;
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
      const params = new URLSearchParams(queryParams);
      params.set('format', format);
      params.delete('page');
      params.delete('limit');
      await downloadFile(`/api/v1/leads/export?${params}`, `all-leads.${format === 'csv' ? 'csv' : 'xlsx'}`);
    } catch (error) {
      toast(messageFrom(error), 'error');
    }
  };

  if (!canOpen) {
    return (
      <Page title="Leads" subtitle="Only Owner and Super Admin can open the full lead book.">
        <p className="muted">Ask Owner or Super Admin for access.</p>
      </Page>
    );
  }

  const total = facets?.total ?? meta.total ?? 0;
  const assignmentCounts = {
    '': total,
    assigned: countFor(facets, 'assignment', 'assigned'),
    unassigned: countFor(facets, 'assignment', 'unassigned'),
  };
  const sheetCounts = {
    '': total,
    true: countFor(facets, 'fromSheet', 'sheet'),
    false: countFor(facets, 'fromSheet', 'other'),
  };

  return (
    <Page
      title="Leads"
      subtitle="Every lead company-wide — assigned, unassigned, every client, firm, status and source. Filters show live counts."
      actions={(
        <>
          {can('leads.export') && <button className="btn secondary" type="button" onClick={() => exportLeads('xlsx')}>Excel</button>}
          {can('leads.export') && <button className="btn secondary" type="button" onClick={() => exportLeads('csv')}>CSV</button>}
          <button className="btn secondary" type="button" onClick={load}>Refresh</button>
        </>
      )}
    >
      <div className="grid stats" style={{ marginBottom: 14 }}>
        <article className="card"><strong>{total}</strong><span className="muted">All leads</span></article>
        <article className="card"><strong>{assignmentCounts.assigned}</strong><span className="muted">Assigned</span></article>
        <article className="card"><strong>{assignmentCounts.unassigned}</strong><span className="muted">Unassigned</span></article>
        <article className="card"><strong>{sheetCounts.true}</strong><span className="muted">From sheet</span></article>
        <article className="card"><strong>{meta.total ?? '—'}</strong><span className="muted">Matching filters</span></article>
      </div>

      <div className="filters lead-filters">
        <label className="field lead-search"><span>Search</span>
          <input
            placeholder="Name, phone or lead ID"
            aria-label="Search all leads"
            value={filters.q}
            onChange={(event) => setFilters({ ...filters, q: event.target.value, page: 1 })}
          />
        </label>
        <button className="btn secondary filters-toggle" type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>
          {filtersOpen ? 'Hide filters' : 'Filters'}
        </button>
        <div className={`lead-filters-more ${filtersOpen ? 'open' : ''}`}>
          <label className="field"><span>Assignment</span>
            <select aria-label="Assignment" value={filters.bucket} onChange={(event) => setFilters({ ...filters, bucket: event.target.value, staff: event.target.value === 'unassigned' ? '' : filters.staff, page: 1 })}>
              <option value="">All ({assignmentCounts[''] || 0})</option>
              <option value="assigned">Assigned ({assignmentCounts.assigned})</option>
              <option value="unassigned">Unassigned ({assignmentCounts.unassigned})</option>
            </select>
          </label>
          <label className="field"><span>Origin</span>
            <select aria-label="Origin" value={filters.fromSheet} onChange={(event) => setFilters({ ...filters, fromSheet: event.target.value, page: 1 })}>
              <option value="">All ({sheetCounts[''] || 0})</option>
              <option value="true">Sheet ({sheetCounts.true})</option>
              <option value="false">Other ({sheetCounts.false})</option>
            </select>
          </label>
          <label className="field span-2"><span>Status</span>
            <select aria-label="Status" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value, page: 1 })}>
              <option value="">All statuses ({(facets?.status || []).reduce((sum, row) => sum + (row.count || 0), 0)})</option>
              {statuses.map((status) => {
                const color = LEAD_STATUS_COLORS[status.key] || { bg: '#eef2f7', fg: '#334155' };
                const n = countFor(facets, 'status', status.key);
                return (
                  <option key={status.key} value={status.key} style={{ background: color.bg, color: color.fg }}>
                    {status.label} ({n})
                  </option>
                );
              })}
              {(facets?.status || [])
                .filter((row) => row.key && !statuses.some((status) => status.key === row.key))
                .map((row) => (
                  <option key={row.key} value={row.key}>{row.key} ({row.count})</option>
                ))}
            </select>
          </label>
          <label className="field"><span>Client</span>
            <select aria-label="Client" value={filters.leadRole} onChange={(event) => setFilters({ ...filters, leadRole: event.target.value, page: 1 })}>
              <option value="">All clients ({(facets?.leadRole || []).reduce((sum, row) => sum + (row.count || 0), 0)})</option>
              {leadRoles.map((role) => (
                <option key={role.key} value={role.key}>{role.label} ({countFor(facets, 'leadRole', role.key)})</option>
              ))}
              {(facets?.leadRole || [])
                .filter((row) => row.key && !leadRoles.some((role) => role.key === row.key))
                .map((row) => (
                  <option key={row.key} value={row.key}>{row.key || '—'} ({row.count})</option>
                ))}
            </select>
          </label>
          <label className="field"><span>Firm</span>
            <select aria-label="Firm" value={filters.firm} onChange={(event) => setFilters({ ...filters, firm: event.target.value, page: 1 })}>
              <option value="">All firms ({(facets?.firm || []).reduce((sum, row) => sum + (row.count || 0), 0)})</option>
              {leadFirms.map((firm) => (
                <option key={firm.key} value={firm.key}>{firm.label} ({countFor(facets, 'firm', firm.key)})</option>
              ))}
            </select>
          </label>
          <label className="field"><span>Staff</span>
            <select aria-label="Staff" value={filters.staff} onChange={(event) => setFilters({ ...filters, staff: event.target.value, bucket: event.target.value ? 'assigned' : filters.bucket, page: 1 })}>
              <option value="">All staff</option>
              {(facets?.staff || []).map((person) => (
                <option key={person.key} value={person.key}>
                  {person.name} · {person.role === 'TEAM_LEADER' ? 'Team leader' : 'Staff'} ({person.count})
                </option>
              ))}
            </select>
          </label>
          <label className="field"><span>Source</span>
            <select aria-label="Source" value={filters.source} onChange={(event) => setFilters({ ...filters, source: event.target.value, page: 1 })}>
              <option value="">All sources ({(facets?.source || []).reduce((sum, row) => sum + (row.count || 0), 0)})</option>
              {[...new Set([...(sources || []), ...((facets?.source || []).map((row) => row.key).filter(Boolean))])].map((source) => (
                <option key={source} value={source}>{source} ({countFor(facets, 'source', source)})</option>
              ))}
            </select>
          </label>
          <label className="field"><span>Priority</span>
            <select aria-label="Priority" value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value, page: 1 })}>
              <option value="">All priorities</option>
              {['urgent', 'high', 'medium', 'low'].map((item) => (
                <option key={item} value={item}>{item} ({countFor(facets, 'priority', item)})</option>
              ))}
            </select>
          </label>
          <label className="field"><span>Assigned from</span>
            <input type="date" aria-label="Assigned from" value={filters.assignedFrom} onChange={(event) => setFilters({ ...filters, assignedFrom: event.target.value, page: 1 })} />
          </label>
          <label className="field"><span>Assigned to</span>
            <input type="date" aria-label="Assigned to" value={filters.assignedTo} onChange={(event) => setFilters({ ...filters, assignedTo: event.target.value, page: 1 })} />
          </label>
          <label className="field span-2"><span>Sort</span>
            <select
              aria-label="Sort leads"
              value={`${filters.sort}:${filters.order}`}
              onChange={(event) => {
                const [sort, order] = event.target.value.split(':');
                setFilters({ ...filters, sort, order, page: 1 });
              }}
            >
              <option value="createdAt:desc">Newest created</option>
              <option value="assignmentDate:desc">Newest assigned</option>
              <option value="assignmentDate:asc">Oldest assigned</option>
              <option value="lastContactedAt:desc">Last contacted</option>
              <option value="name:asc">Name A–Z</option>
              <option value="status:asc">Status</option>
            </select>
          </label>
          <button
            className="btn secondary"
            type="button"
            onClick={() => setFilters({
              q: '', status: '', source: '', priority: '', leadRole: '', firm: '', staff: '',
              bucket: '', fromSheet: '', assignedFrom: '', assignedTo: '',
              sort: 'createdAt', order: 'desc', page: 1,
            })}
          >
            Clear filters
          </button>
        </div>
      </div>

      <div className="reassign-bar">
        <button className="btn secondary" type="button" onClick={selectAllVisible} disabled={!visibleIds.length}>
          {allVisibleSelected ? 'Unselect all' : 'Select all'}
        </button>
        {selected.length > 0 && <span>{selected.length} selected</span>}
        {canDelete && selected.length > 0 && (
          <button className="btn danger" type="button" onClick={deleteSelected}>Delete</button>
        )}
        {selected.length > 0 && (
          <button className="btn secondary" type="button" onClick={() => setSelected([])}>Clear</button>
        )}
      </div>

      <section className="lead-section" aria-label="All leads">
        <h2>All leads{meta.total != null ? ` (${meta.total})` : ''}</h2>
        <p className="muted">Includes bucket / unassigned leads and every client role. Open a row for full history.</p>
        <DataTable
          className="lead-book"
          loading={loading}
          rows={rows}
          page={meta.page || 1}
          pages={meta.pages || 1}
          onPage={(page) => setFilters({ ...filters, page })}
          onRow={(row) => navigate(`/leads/${row._id || row.id}`)}
          empty="No leads match these filters"
          columns={[
            {
              key: 'pick',
              label: 'Select',
              cellClass: 'lead-pick',
              render: (row) => (
                <input
                  type="checkbox"
                  aria-label={`Select ${row.name}`}
                  checked={selected.includes(row._id || row.id)}
                  onClick={(event) => event.stopPropagation()}
                  onChange={() => toggleSelected(row._id || row.id)}
                />
              ),
            },
            { key: 'leadCode', label: 'Lead ID' },
            { key: 'name', label: 'Name' },
            { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} label={statuses.find((item) => item.key === row.status)?.label} /> },
            { key: 'priority', label: 'Priority', render: (row) => <PriorityBadge priority={row.priority} /> },
            { key: 'leadRole', label: 'Client', render: (row) => roleLabel(leadRoles, row.leadRole) },
            { key: 'firm', label: 'Firm', render: (row) => <FirmBadge firm={row.firm} firms={leadFirms} /> },
            { key: 'assigned', label: 'Assigned', render: (row) => row.assignedTo?.name || 'Unassigned' },
            { key: 'source', label: 'Source', render: (row) => row.source || '—' },
            { key: 'phone', label: 'Phone', render: (row) => row.phoneDisplay || '—' },
            { key: 'assignedDay', label: 'Assigned day', render: (row) => day(row.assignmentDate) },
            { key: 'created', label: 'Created', render: (row) => day(row.createdAt) },
            { key: 'call', label: 'Call', cellClass: 'lead-call', render: (row) => (row.phoneNormalized ? (
              <a className="btn call-btn" href={`tel:+${row.phoneNormalized}`} aria-label={`Call ${row.name}`} onClick={(event) => event.stopPropagation()}>
                <Phone size={16} /> Call
              </a>
            ) : '—') },
          ]}
        />
      </section>
    </Page>
  );
}
