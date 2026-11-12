import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { downloadFile } from '../api/client';
import { DataTable, Field, Modal, Page, StatusBadge, LEAD_STATUS_COLORS, day } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

const empty = { name: '', phone: '', alternatePhone: '', email: '', company: '', district: '', city: '', state: '', country: 'India', source: '', category: '', priority: 'medium', quality: '', expectedRevenue: 0, notes: '', assignedTo: '' };

export default function LeadsPage() {
  const { can, toast } = useApp();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ q: '', status: '', source: '', priority: '', assignedFrom: '', assignedTo: '', sort: '', order: '', page: 1 });
  const [meta, setMeta] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sources, setSources] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);

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

  useEffect(() => { load(); }, [filters.q, filters.status, filters.source, filters.priority, filters.assignedFrom, filters.assignedTo, filters.sort, filters.order, filters.page]);
  useEffect(() => {
    api.get('/api/v1/meta').then((response) => {
      setSources(response.data.data.sources);
      setStatuses(response.data.data.statuses);
    }).catch(() => {});
  }, []);

  const save = async (event) => {
    event.preventDefault();
    try {
      await api.post('/api/v1/leads', { ...form, expectedRevenue: Number(form.expectedRevenue) || 0, assignedTo: form.assignedTo || undefined });
      toast('Lead created');
      setOpen(false);
      setForm(empty);
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

  return (
    <Page title="Lead Management" subtitle="Search, filter and update the live lead book." actions={
      <>
        {can('leads.import') && <button className="btn secondary" type="button" onClick={() => navigate('/leads/import')}>Import</button>}
        {can('leads.export') && <button className="btn secondary" type="button" onClick={() => exportLeads('xlsx')}>Excel</button>}
        {can('leads.export') && <button className="btn secondary" type="button" onClick={() => exportLeads('csv')}>CSV</button>}
        {can('leads.create') && <button className="btn" type="button" onClick={() => setOpen(true)}>New lead</button>}
      </>
    }>
      <div className="filters">
        <input placeholder="Name, phone or lead ID" value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value, page: 1 })} />
        <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value, page: 1 })}>
          <option value="">All statuses</option>
          {statuses.map((status) => {
            const color = LEAD_STATUS_COLORS[status.key] || { bg: '#eef2f7', fg: '#334155' };
            return <option key={status.key} value={status.key} style={{ background: color.bg, color: color.fg }}>{status.label}</option>;
          })}
        </select>
        <select value={filters.source} onChange={(event) => setFilters({ ...filters, source: event.target.value, page: 1 })}>
          <option value="">All sources</option>
          {sources.map((source) => <option key={source}>{source}</option>)}
        </select>
        <select value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value, page: 1 })}>
          <option value="">All priorities</option>
          {['low', 'medium', 'high', 'urgent'].map((item) => <option key={item}>{item}</option>)}
        </select>
        <label className="field"><span>Assigned from</span>
          <input type="date" aria-label="Assigned from" value={filters.assignedFrom} onChange={(event) => setFilters({ ...filters, assignedFrom: event.target.value, page: 1 })} />
        </label>
        <label className="field"><span>Assigned to</span>
          <input type="date" aria-label="Assigned to" value={filters.assignedTo} onChange={(event) => setFilters({ ...filters, assignedTo: event.target.value, page: 1 })} />
        </label>
        <label className="field"><span>Sort</span>
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
      <DataTable
        loading={loading}
        rows={rows}
        page={meta?.page || 1}
        pages={meta?.pages || 1}
        onPage={(page) => setFilters({ ...filters, page })}
        onRow={(row) => navigate(`/leads/${row._id}`)}
        empty="No leads match these filters"
        columns={[
          { key: 'assignedDay', label: 'Assigned day', render: (row) => day(row.assignmentDate) },
          { key: 'leadCode', label: 'Lead ID' },
          { key: 'name', label: 'Name' },
          { key: 'phoneDisplay', label: 'Phone' },
          { key: 'source', label: 'Source', hide: true },
          { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} label={statuses.find((item) => item.key === row.status)?.label} /> },
          { key: 'assigned', label: 'Assigned', render: (row) => row.assignedTo?.name || 'Bucket', hide: true },
          { key: 'lastContacted', label: 'Last contacted', render: (row) => day(row.lastContactedAt) },
          { key: 'priority', label: 'Priority', hide: true },
          { key: 'expectedRevenue', label: 'Expected', hide: true },
          { key: 'follow', label: 'Next follow-up', render: (row) => row.followUpAt ? new Date(row.followUpAt).toLocaleString() : '—' },
          { key: 'age', label: 'Age', render: (row) => `${row.ageDays}d`, hide: true },
          { key: 'pipeline', label: 'Pipeline', render: (row) => row.inPipeline
            ? <button className="btn secondary" type="button" onClick={(event) => { event.stopPropagation(); navigate('/pipeline'); }}>In pipeline</button>
            : (can('leads.edit') ? <button className="btn secondary" type="button" onClick={(event) => addPipeline(row._id, event)}>Add to pipeline</button> : null) },
        ]}
      />
      {open && (
        <Modal title="New lead" onClose={() => setOpen(false)}>
          <form className="form-grid" onSubmit={save}>
            <Field label="Name"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></Field>
            <Field label="Phone"><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} required /></Field>
            <Field label="Alternate phone"><input value={form.alternatePhone} onChange={(event) => setForm({ ...form, alternatePhone: event.target.value })} /></Field>
            <Field label="Email"><input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
            <Field label="Company"><input value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} /></Field>
            <Field label="Source"><select value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} required><option value="">Choose</option>{sources.map((source) => <option key={source}>{source}</option>)}</select></Field>
            <Field label="District"><input value={form.district} onChange={(event) => setForm({ ...form, district: event.target.value })} /></Field>
            <Field label="City"><input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /></Field>
            <Field label="State"><input value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })} /></Field>
            <Field label="Priority"><select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>{['low', 'medium', 'high', 'urgent'].map((item) => <option key={item}>{item}</option>)}</select></Field>
            <Field label="Expected revenue"><input type="number" min="0" value={form.expectedRevenue} onChange={(event) => setForm({ ...form, expectedRevenue: event.target.value })} /></Field>
            <Field label="Notes" full><textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>
            <div className="full actions"><button className="btn" type="submit">Save lead</button></div>
          </form>
        </Modal>
      )}
    </Page>
  );
}
