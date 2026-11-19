import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import LeadUpload from '../components/LeadUpload';
import { DataTable, Field, Modal, Page } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

const empty = { name: '', phone: '', alternatePhone: '', email: '', company: '', district: '', city: '', state: '', country: 'India', source: '', leadRole: '', priority: 'medium', expectedRevenue: 0, notes: '' };

export default function BucketPage() {
  const { toast, can } = useApp();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [staff, setStaff] = useState([]);
  const [selected, setSelected] = useState([]);
  const [staffId, setStaffId] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [sources, setSources] = useState([]);
  const [leadRoles, setLeadRoles] = useState([]);
  const [roleFilter, setRoleFilter] = useState('');
  const [total, setTotal] = useState(null);

  const load = () => {
    const params = new URLSearchParams({ view: 'bucket', limit: '100' });
    if (roleFilter) params.set('leadRole', roleFilter);
    api.get(`/api/v1/leads?${params}`).then((response) => {
      const data = response.data.data || [];
      setRows(data);
      setTotal(response.data.meta?.total ?? data.length);
    }).catch((error) => toast(messageFrom(error), 'error'));
    api.get('/api/v1/lead-assignments/workload').then((response) => setStaff(response.data.data.filter((person) => person.available))).catch(() => {});
  };
  useEffect(() => { load(); }, [roleFilter]);
  useEffect(() => {
    api.get('/api/v1/meta').then((response) => {
      setSources(response.data.data.sources || []);
      setLeadRoles(response.data.data.leadRoles || []);
    }).catch(() => {});
  }, []);

  const save = async (event) => {
    event.preventDefault();
    try {
      await api.post('/api/v1/leads', { ...form, expectedRevenue: Number(form.expectedRevenue) || 0 });
      toast('Lead added to the bucket');
      setOpen(false);
      setForm(empty);
      load();
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  const toggle = (id) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  const assign = async () => {
    if (!selected.length || !staffId) return toast('Choose leads and a person', 'error');
    try {
      const response = await api.post('/api/v1/lead-assignments', { leadIds: selected, staffId, reason: 'Assigned from the bucket' });
      toast(`Assigned ${response.data.data.assigned}`);
      setSelected([]);
      load();
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  return (
    <Page title="Lead bucket" subtitle={total == null ? 'Unassigned leads only.' : `${total} unassigned lead${total === 1 ? '' : 's'}.`} actions={
      <>
        <select value={staffId} onChange={(event) => setStaffId(event.target.value)}>
          <option value="">Assign selected to…</option>
          {staff.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.remaining} open slots</option>)}
        </select>
        <button className="btn" type="button" onClick={assign}>Assign</button>
        <LeadUpload onImported={load} />
        {can('leads.create') && <button className="btn" type="button" onClick={() => setOpen(true)}>New lead</button>}
      </>
    }>
      <div className="filters">
        <label className="field"><span>Role</span>
          <select aria-label="Role" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            <option value="">All roles</option>
            {leadRoles.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}
          </select>
        </label>
      </div>
      <section className="lead-section" aria-label="Unassigned leads">
        <h2>Unassigned leads{total == null ? '' : ` (${total})`}</h2>
      </section>
      <DataTable rows={rows} empty="The bucket is empty" onRow={(row) => navigate(`/leads/${row._id}`)} columns={[
        { key: 'pick', label: '', render: (row) => <input type="checkbox" aria-label={`Select ${row.name}`} checked={selected.includes(row._id)} onChange={() => toggle(row._id)} onClick={(event) => event.stopPropagation()} /> },
        { key: 'leadCode', label: 'Lead ID' },
        { key: 'name', label: 'Name' },
        { key: 'leadRole', label: 'Role', render: (row) => leadRoles.find((role) => role.key === row.leadRole)?.label || '—' },
        { key: 'phoneDisplay', label: 'Phone' },
        { key: 'source', label: 'Source' },
        { key: 'priority', label: 'Priority' },
        { key: 'district', label: 'District' },
      ]} />
      {open && (
        <Modal title="New lead" onClose={() => setOpen(false)}>
          <form className="form-grid" onSubmit={save}>
            <Field label="Name"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></Field>
            <Field label="Phone"><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} required /></Field>
            <Field label="Role">
              <select aria-label="Lead role" value={form.leadRole} onChange={(event) => setForm({ ...form, leadRole: event.target.value })} required>
                <option value="">Choose</option>
                {leadRoles.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}
              </select>
            </Field>
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
