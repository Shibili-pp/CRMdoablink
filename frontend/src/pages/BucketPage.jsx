import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import LeadUpload from '../components/LeadUpload';
import { DataTable, Field, FirmBadge, Modal, Page } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

const empty = { name: '', phone: '', alternatePhone: '', email: '', company: '', consultancyName: '', district: '', city: '', state: '', country: 'India', source: '', leadRole: '', firm: '', priority: 'high', expectedRevenue: 0, notes: '', comment: '', remarks: '' };

export default function BucketPage() {
  const { toast, can } = useApp();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [sheetRows, setSheetRows] = useState([]);
  const [rnpRows, setRnpRows] = useState([]);
  const [utcRows, setUtcRows] = useState([]);
  const [disqualifiedRows, setDisqualifiedRows] = useState([]);
  const [notInterestedRows, setNotInterestedRows] = useState([]);
  const [untouchedRows, setUntouchedRows] = useState([]);
  const [staff, setStaff] = useState([]);
  const [selected, setSelected] = useState([]);
  const [staffId, setStaffId] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [sources, setSources] = useState([]);
  const [leadRoles, setLeadRoles] = useState([]);
  const [leadFirms, setLeadFirms] = useState([]);
  const [roleFilter, setRoleFilter] = useState('');
  const [firmFilter, setFirmFilter] = useState('');
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(null);
  const [sheetTotal, setSheetTotal] = useState(null);
  const [rnpTotal, setRnpTotal] = useState(null);
  const [utcTotal, setUtcTotal] = useState(null);
  const [disqualifiedTotal, setDisqualifiedTotal] = useState(null);
  const [notInterestedTotal, setNotInterestedTotal] = useState(null);
  const [untouchedTotal, setUntouchedTotal] = useState(null);
  const canDelete = can('leads.delete');
  const canAssign = can('leads.assign');

  const load = () => {
    const base = { view: 'bucket', limit: '100' };
    if (roleFilter) base.leadRole = roleFilter;
    if (firmFilter) base.firm = firmFilter;
    if (search.trim()) base.q = search.trim();
    const regular = new URLSearchParams({ ...base, fromSheet: 'false' });
    const sheet = new URLSearchParams({ ...base, fromSheet: 'true' });
    const rnp = new URLSearchParams({ ...base, section: 'rnp' });
    const utc = new URLSearchParams({ ...base, section: 'utc' });
    const disqualified = new URLSearchParams({ ...base, section: 'disqualified' });
    const notInterested = new URLSearchParams({ ...base, section: 'not_interested' });
    const untouched = new URLSearchParams({ ...base, section: 'untouched' });
    Promise.all([
      api.get(`/api/v1/leads?${regular}`),
      api.get(`/api/v1/leads?${sheet}`),
      api.get(`/api/v1/leads?${rnp}`),
      api.get(`/api/v1/leads?${utc}`),
      api.get(`/api/v1/leads?${disqualified}`),
      api.get(`/api/v1/leads?${notInterested}`),
      api.get(`/api/v1/leads?${untouched}`),
    ]).then(([regularRes, sheetRes, rnpRes, utcRes, disqualifiedRes, notInterestedRes, untouchedRes]) => {
      const data = regularRes.data.data || [];
      const fromSheet = sheetRes.data.data || [];
      const rnpData = rnpRes.data.data || [];
      const utcData = utcRes.data.data || [];
      const disqualifiedData = disqualifiedRes.data.data || [];
      const notInterestedData = notInterestedRes.data.data || [];
      const untouchedData = untouchedRes.data.data || [];
      setRows(data);
      setSheetRows(fromSheet);
      setRnpRows(rnpData);
      setUtcRows(utcData);
      setDisqualifiedRows(disqualifiedData);
      setNotInterestedRows(notInterestedData);
      setUntouchedRows(untouchedData);
      setTotal(regularRes.data.meta?.total ?? data.length);
      setSheetTotal(sheetRes.data.meta?.total ?? fromSheet.length);
      setRnpTotal(rnpRes.data.meta?.total ?? rnpData.length);
      setUtcTotal(utcRes.data.meta?.total ?? utcData.length);
      setDisqualifiedTotal(disqualifiedRes.data.meta?.total ?? disqualifiedData.length);
      setNotInterestedTotal(notInterestedRes.data.meta?.total ?? notInterestedData.length);
      setUntouchedTotal(untouchedRes.data.meta?.total ?? untouchedData.length);
    }).catch((error) => toast(messageFrom(error), 'error'));
    api.get('/api/v1/lead-assignments/workload').then((response) => setStaff(response.data.data.filter((person) => person.available))).catch(() => {});
  };
  useEffect(() => { load(); }, [roleFilter, firmFilter, search]);
  useEffect(() => { setSelected([]); }, [roleFilter, firmFilter, search]);
  useEffect(() => {
    api.get('/api/v1/meta').then((response) => {
      setSources(response.data.data.sources || []);
      setLeadRoles(response.data.data.leadRoles || []);
      setLeadFirms(response.data.data.leadFirms || []);
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
  const visibleIds = [...sheetRows, ...rnpRows, ...utcRows, ...rows, ...untouchedRows, ...disqualifiedRows, ...notInterestedRows].map((row) => row._id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));
  const selectAll = () => {
    if (!visibleIds.length) return;
    setSelected(allSelected ? [] : visibleIds);
  };
  const selectSection = (list) => {
    const ids = list.map((row) => row._id);
    if (!ids.length) return;
    const allIn = ids.every((id) => selected.includes(id));
    setSelected((current) => (allIn ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])]));
  };

  const assign = async () => {
    if (!selected.length || !staffId) return toast('Choose leads and a person', 'error');
    try {
      const response = await api.post('/api/v1/lead-assignments', { leadIds: selected, staffId, reason: 'Assigned from the bucket' });
      toast(`Assigned ${response.data.data.assigned}`);
      setSelected([]);
      load();
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  const runAutoAssign = async () => {
    try {
      const response = await api.post('/api/v1/lead-assignments/auto-assign');
      toast(response.data.message || 'Daily mix finished (sheet → RNP 30% → UTC 15% → unassigned 40%)');
      load();
    } catch (error) {
      toast(messageFrom(error), 'error');
    }
  };

  const runRnpAssign = async () => {
    try {
      const response = await api.post('/api/v1/lead-assignments/auto-assign-rnp');
      toast(response.data.message || 'RNP assign finished');
      load();
    } catch (error) {
      toast(messageFrom(error), 'error');
    }
  };

  const runUtcAssign = async () => {
    try {
      const response = await api.post('/api/v1/lead-assignments/auto-assign-utc');
      toast(response.data.message || 'UTC assign finished');
      load();
    } catch (error) {
      toast(messageFrom(error), 'error');
    }
  };

  const runBulkAssign = async () => {
    try {
      const response = await api.post('/api/v1/lead-assignments/auto-assign-bulk');
      toast(response.data.message || 'Bulk assign finished');
      load();
    } catch (error) {
      toast(messageFrom(error), 'error');
    }
  };

  const bucketColumns = (list, { rnpTrail = false } = {}) => {
    const ids = list.map((row) => row._id);
    const sectionSelected = ids.length > 0 && ids.every((id) => selected.includes(id));
    return [
      ...(canAssign || canDelete ? [{
        key: 'pick',
        label: 'Select',
        cellClass: 'lead-pick',
        header: (
          <input
            type="checkbox"
            aria-label={sectionSelected ? 'Unselect section' : 'Select section'}
            checked={sectionSelected}
            disabled={!ids.length}
            onChange={() => selectSection(list)}
          />
        ),
        render: (row) => (
          <input
            type="checkbox"
            aria-label={`Select ${row.name}`}
            checked={selected.includes(row._id)}
            onChange={() => toggle(row._id)}
            onClick={(event) => event.stopPropagation()}
          />
        ),
      }] : []),
      { key: 'leadCode', label: 'Lead ID' },
      { key: 'name', label: 'Name' },
      { key: 'leadRole', label: 'Client', render: (row) => leadRoles.find((role) => role.key === row.leadRole)?.label || '—' },
      { key: 'firm', label: 'Firm', render: (row) => <FirmBadge firm={row.firm} firms={leadFirms} /> },
      { key: 'phoneDisplay', label: 'Phone' },
      { key: 'source', label: 'Source' },
      { key: 'priority', label: 'Priority' },
      ...(rnpTrail ? [
        {
          key: 'rnpDate',
          label: 'RNP date',
          render: (row) => row.rnpReachedAtLabel
            || (row.rnpMarkedAt
              ? new Date(row.rnpMarkedAt).toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata',
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })
              : '—'),
        },
        {
          key: 'rnpStaff',
          label: 'RNP staff',
          render: (row) => {
            const latest = row.rnpLatestStaffName || row.rnpLastStaff?.name || '';
            const earlier = (row.rnpPreviousStaffNames || []).join(' → ');
            if (!latest && !earlier) {
              return row.rnpStaffTrail && row.rnpStaffTrail !== '—' ? row.rnpStaffTrail : '—';
            }
            return `${latest ? `Latest RNP: ${latest}` : ''}${latest && earlier ? ' · ' : ''}${earlier ? `Earlier: ${earlier}` : ''}`;
          },
        },
      ] : []),
      { key: 'district', label: 'District' },
    ];
  };

  const deleteSelected = async () => {
    if (!canDelete || !selected.length) return;
    const count = selected.length;
    if (!window.confirm(`Delete ${count} selected lead${count === 1 ? '' : 's'} from the bucket?`)) return;
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

  return (
    <Page title="Lead bucket" subtitle={`${(sheetTotal || 0) + (rnpTotal || 0) + (utcTotal || 0) + (total || 0) + (untouchedTotal || 0) + (disqualifiedTotal || 0) + (notInterestedTotal || 0)} in bucket · ${(sheetTotal || 0)} sheet · ${(rnpTotal || 0)} RNP · ${(utcTotal || 0)} UTC · ${(untouchedTotal || 0)} untouched · ${(disqualifiedTotal || 0)} disqualified · ${(notInterestedTotal || 0)} not interested`} actions={
      <>
        {canAssign && <button className="btn secondary" type="button" onClick={runAutoAssign}>Auto-assign daily mix</button>}
        {canAssign && <button className="btn secondary" type="button" onClick={runRnpAssign}>Auto-assign RNP only</button>}
        {canAssign && <button className="btn secondary" type="button" onClick={runUtcAssign}>Auto-assign UTC only</button>}
        {canAssign && <button className="btn secondary" type="button" onClick={runBulkAssign}>Auto-assign unassigned only</button>}
        <LeadUpload onImported={load} />
        {can('leads.create') && <button className="btn" type="button" onClick={() => setOpen(true)}>New lead</button>}
      </>
    }>
      <div className="filters">
        <label className="field lead-search"><span>Search</span>
          <input
            placeholder="Name or mobile number"
            aria-label="Search bucket by name or mobile"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="field"><span>Client</span>
          <select aria-label="Client" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            <option value="">All clients</option>
            {leadRoles.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}
          </select>
        </label>
        <label className="field"><span>Firm</span>
          <select aria-label="Firm" value={firmFilter} onChange={(event) => setFirmFilter(event.target.value)}>
            <option value="">All firms</option>
            {leadFirms.map((firm) => <option key={firm.key} value={firm.key}>{firm.label}</option>)}
          </select>
        </label>
      </div>
      {(canAssign || canDelete) && (
        <div className="reassign-bar">
          <button className="btn secondary" type="button" onClick={selectAll} disabled={!visibleIds.length}>
            {allSelected ? 'Unselect all' : 'Select all'}
          </button>
          <span>{selected.length ? `${selected.length} selected` : 'Select leads to assign'}</span>
          {canAssign && (
            <>
              <select aria-label="Assign selected to" value={staffId} onChange={(event) => setStaffId(event.target.value)} disabled={!selected.length}>
                <option value="">Assign selected to…</option>
                {staff.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.remaining} open slots</option>)}
              </select>
              <button className="btn" type="button" onClick={assign} disabled={!selected.length || !staffId}>Assign selected</button>
            </>
          )}
          {canDelete && selected.length > 0 && <button className="btn danger" type="button" onClick={deleteSelected}>Delete selected</button>}
          {selected.length > 0 && <button className="btn secondary" type="button" onClick={() => setSelected([])}>Clear</button>}
        </div>
      )}
      <section className="lead-section" aria-label="New lead from sheet">
        <h2>New lead from sheet{sheetTotal == null ? '' : ` (${sheetTotal})`}</h2>
        <p className="muted">Highest priority. Owner turns Auto assigning ON. Staff who open CRM and say Yes to “working today” are present — sheet and other auto leads split only among them. Target 120 after holds + sheet. Fresh / Not Contacted: 3 working days → Untouched calls (manual). RNP/UTC next-day rotate. 15% TL+ manual.</p>
      </section>
      <DataTable
        className="lead-book"
        rows={sheetRows}
        empty="No new leads from sheets"
        onRow={(row) => navigate(`/leads/${row._id}`)}
        columns={bucketColumns(sheetRows)}
      />
      <section className="lead-section" aria-label="RNP leads" style={{ marginTop: 18 }}>
        <h2>RNP{rnpTotal == null ? '' : ` (${rnpTotal})`}</h2>
        <p className="muted">Only while Auto assigning is ON: RNP stays with staff the mark day plus the next day (retry if busy), then after work end / 20:00 it returns here. Next work start rotates A→B→C as fresh. If every staff managing that client already marked RNP, the lead moves to Disqualified. Firms 50-50. Quota: 30% of remaining auto slots.</p>
      </section>
      <DataTable
        className="lead-book"
        rows={rnpRows}
        empty="No RNP leads in the bucket"
        onRow={(row) => navigate(`/leads/${row._id}`)}
        columns={bucketColumns(rnpRows, { rnpTrail: true })}
      />
      <section className="lead-section" aria-label="UTC leads" style={{ marginTop: 18 }}>
        <h2>UTC{utcTotal == null ? '' : ` (${utcTotal})`}</h2>
        <p className="muted">Only while Auto assigning is ON: UTC stays with staff the mark day plus the next day, then after work end / 20:00 it returns here. If Auto assigning is OFF, leads stay with staff. Next work start rotates A→B→C as fresh. Firms 50-50. Quota: 15% of remaining auto slots.</p>
      </section>
      <DataTable
        className="lead-book"
        rows={utcRows}
        empty="No UTC leads in the bucket"
        onRow={(row) => navigate(`/leads/${row._id}`)}
        columns={bucketColumns(utcRows)}
      />
      <section className="lead-section" aria-label="Unassigned leads" style={{ marginTop: 18 }}>
        <h2>Unassigned leads{total == null ? '' : ` (${total})`}</h2>
        <p className="muted">Bulk / manual uploads. Quota: 40% of remaining auto slots (120 − sheet − hold carry). Firms 50-50. Matching managing client only. Last 15% for TL+ manual. Manual assign may exceed 120.</p>
      </section>
      <DataTable
        className="lead-book"
        rows={rows}
        empty="The bucket is empty"
        onRow={(row) => navigate(`/leads/${row._id}`)}
        columns={bucketColumns(rows)}
      />
      <section className="lead-section" aria-label="Untouched calls" style={{ marginTop: 18 }}>
        <h2>Untouched calls{untouchedTotal == null ? '' : ` (${untouchedTotal})`}</h2>
        <p className="muted">Fresh / Not Contacted / Untouched leads that stayed with staff for 3 working days (Sunday off) with no status change. They leave Lead Management and land here. Manual assign only — not included in auto-assign.</p>
      </section>
      <DataTable
        className="lead-book"
        rows={untouchedRows}
        empty="No untouched calls in the bucket"
        onRow={(row) => navigate(`/leads/${row._id}`)}
        columns={bucketColumns(untouchedRows)}
      />
      <section className="lead-section" aria-label="Disqualified leads" style={{ marginTop: 18 }}>
        <h2>Disqualified{disqualifiedTotal == null ? '' : ` (${disqualifiedTotal})`}</h2>
        <p className="muted">Leads marked Disqualified leave Lead Management and land here with the reason. They are not auto-assigned.</p>
      </section>
      <DataTable
        className="lead-book"
        rows={disqualifiedRows}
        empty="No disqualified leads"
        onRow={(row) => navigate(`/leads/${row._id}`)}
        columns={bucketColumns(disqualifiedRows)}
      />
      <section className="lead-section" aria-label="Not interested leads" style={{ marginTop: 18 }}>
        <h2>Not Interested{notInterestedTotal == null ? '' : ` (${notInterestedTotal})`}</h2>
        <p className="muted">Leads marked Not Interested leave Lead Management and land here with the reason. They are not auto-assigned.</p>
      </section>
      <DataTable
        className="lead-book"
        rows={notInterestedRows}
        empty="No not-interested leads"
        onRow={(row) => navigate(`/leads/${row._id}`)}
        columns={bucketColumns(notInterestedRows)}
      />
      {open && (
        <Modal title="New lead" onClose={() => setOpen(false)}>
          <form className="form-grid" onSubmit={save}>
            <Field label="Name"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></Field>
            <Field label="Phone"><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} required /></Field>
            <Field label="Client">
              <select aria-label="Client type" value={form.leadRole} onChange={(event) => setForm({ ...form, leadRole: event.target.value })} required>
                <option value="">Choose</option>
                {leadRoles.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}
              </select>
            </Field>
            <Field label="Firm">
              <select aria-label="Firm" value={form.firm} onChange={(event) => setForm({ ...form, firm: event.target.value })} required>
                <option value="">Choose</option>
                {leadFirms.map((firm) => <option key={firm.key} value={firm.key}>{firm.label}</option>)}
              </select>
            </Field>
            <Field label="Alternate phone"><input value={form.alternatePhone} onChange={(event) => setForm({ ...form, alternatePhone: event.target.value })} /></Field>
            <Field label="Email"><input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
            <Field label="Company"><input value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} /></Field>
            <Field label="Consultancy name"><input value={form.consultancyName} onChange={(event) => setForm({ ...form, consultancyName: event.target.value })} /></Field>
            <Field label="Source"><select value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} required><option value="">Choose</option>{sources.map((source) => <option key={source}>{source}</option>)}</select></Field>
            <Field label="District"><input value={form.district} onChange={(event) => setForm({ ...form, district: event.target.value })} /></Field>
            <Field label="City"><input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /></Field>
            <Field label="State"><input value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })} /></Field>
            <Field label="Priority"><select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>{['low', 'medium', 'high', 'urgent'].map((item) => <option key={item}>{item}</option>)}</select></Field>
            <Field label="Expected revenue"><input type="number" min="0" value={form.expectedRevenue} onChange={(event) => setForm({ ...form, expectedRevenue: event.target.value })} /></Field>
            <Field label="Comment" full><textarea value={form.comment} onChange={(event) => setForm({ ...form, comment: event.target.value })} /></Field>
            <Field label="Remark" full><textarea value={form.remarks} onChange={(event) => setForm({ ...form, remarks: event.target.value })} /></Field>
            <Field label="Notes" full><textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>
            <div className="full actions"><button className="btn" type="submit">Save lead</button></div>
          </form>
        </Modal>
      )}
    </Page>
  );
}
