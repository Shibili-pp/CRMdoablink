import { useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { Badge, Field, Modal } from './ui';
import { messageFrom, useApp } from '../context/AppContext';

const fallbackFields = [
  { key: 'name', label: 'Name', required: true },
  { key: 'phone', label: 'Phone', required: true },
  { key: 'alternatePhone', label: 'Alternate phone' },
  { key: 'email', label: 'Email' },
  { key: 'company', label: 'Company' },
  { key: 'consultancyName', label: 'Consultancy name' },
  { key: 'district', label: 'District' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'country', label: 'Country' },
  { key: 'status', label: 'Status (Excel: Stage)' },
  { key: 'priority', label: 'Priority' },
  { key: 'expectedRevenue', label: 'Expected revenue' },
  { key: 'notes', label: 'Notes' },
  { key: 'comment', label: 'Comment' },
  { key: 'remarks', label: 'Remark' },
];

function columnLabel(column) {
  const sample = column.sample ? ` · ${column.sample}` : '';
  return `Column ${column.letter} (${column.number}) — ${column.header}${sample}`;
}

function isDuplicateRow(row) {
  return Boolean(row.duplicateInFile || row.duplicateLeadId || row.duplicateLeadCode);
}

function duplicateReason(row) {
  if (row.duplicateLeadCode || row.duplicateLeadId) {
    const code = row.duplicateLeadCode || 'existing lead';
    const name = row.duplicateLeadName ? ` · ${row.duplicateLeadName}` : '';
    const who = row.duplicateAssignedTo
      ? ` · assigned to ${row.duplicateAssignedTo}`
      : ' · in bucket';
    return `Already in CRM · ${code}${name}${who}`;
  }
  if (row.duplicateInFile) return 'Duplicate in this file';
  return 'Duplicate';
}

export default function LeadUpload({ onImported }) {
  const { toast } = useApp();
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [fields, setFields] = useState(fallbackFields);
  const [leadRoles, setLeadRoles] = useState([]);
  const [leadRole, setLeadRole] = useState('');
  const [leadFirms, setLeadFirms] = useState([]);
  const [firm, setFirm] = useState('');
  const [sources, setSources] = useState([]);
  const [source, setSource] = useState('');
  const [staff, setStaff] = useState([]);
  const [assignedTo, setAssignedTo] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/api/v1/meta').then((response) => {
      setLeadRoles(response.data.data.leadRoles || []);
      setLeadFirms(response.data.data.leadFirms || []);
      setSources(response.data.data.sources || []);
      if (response.data.data.importFields?.length) setFields(response.data.data.importFields.filter((field) => field.key !== 'source'));
    }).catch(() => {});
    api.get('/api/v1/lead-assignments/workload').then((response) => {
      const people = (response.data.data || [])
        .filter((person) => person.available !== false)
        .map((person) => ({
          id: person.id || person._id,
          name: person.name,
          role: person.role,
        }));
      setStaff(people);
    }).catch(() => {
      api.get('/api/v1/users?limit=100').then((response) => {
        setStaff((response.data.data || [])
          .filter((person) => person.isActive !== false && ['STAFF', 'TEAM_LEADER'].includes(person.role))
          .map((person) => ({
            id: person.id || person._id,
            name: person.name || person.username,
            role: person.role,
          })));
      }).catch(() => {});
    });
  }, []);

  const close = () => {
    setFile(null);
    setPreview(null);
    setMapping({});
    setLeadRole('');
    setFirm('');
    setSource('');
    setAssignedTo('');
  };

  const choose = async (event) => {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
    const body = new FormData();
    body.append('file', picked);
    setBusy(true);
    setFile(picked);
    try {
      const response = await api.post('/api/v1/lead-imports', body);
      setPreview(response.data.data);
      setMapping(response.data.data.mapping || {});
    } catch (error) {
      toast(messageFrom(error), 'error');
      close();
    } finally {
      setBusy(false);
    }
  };

  const changeColumn = async (field, header) => {
    const next = { ...mapping, [field]: header };
    setMapping(next);
    if (!preview?._id) return;
    setBusy(true);
    try {
      const response = await api.post(`/api/v1/lead-imports/${preview._id}/mapping`, { mapping: next });
      setPreview(response.data.data);
      setMapping(response.data.data.mapping || next);
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeDuplicates = async () => {
    if (!preview?._id) return;
    setBusy(true);
    try {
      const response = await api.post(`/api/v1/lead-imports/${preview._id}/remove-duplicates`);
      setPreview(response.data.data);
      toast(response.data.message || 'Duplicates removed');
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!mapping.name || !mapping.phone) {
      toast('Choose the column for name and the column for phone', 'error');
      return;
    }
    if (!leadRole) {
      toast('Choose a client type for these leads', 'error');
      return;
    }
    if (!firm) {
      toast('Choose a firm for these leads', 'error');
      return;
    }
    if (!source) {
      toast('Choose a lead source for these leads', 'error');
      return;
    }
    const duplicateCount = (preview?.rows || []).filter(isDuplicateRow).length;
    if (duplicateCount > 0) {
      toast('Remove duplicates first, then import the remaining leads', 'error');
      return;
    }
    setBusy(true);
    try {
      const payload = { skipDuplicates: true, updateExisting: false, leadRole, firm, source };
      if (assignedTo) payload.assignedTo = assignedTo;
      const response = await api.post(`/api/v1/lead-imports/${preview._id}/commit`, payload);
      const count = response.data.data.summary.imported;
      const staffName = staff.find((person) => person.id === assignedTo)?.name;
      toast(assignedTo
        ? `Imported ${count} lead${count === 1 ? '' : 's'} and assigned to ${staffName || 'staff'}`
        : `Imported ${count} lead${count === 1 ? '' : 's'} into the bucket`);
      close();
      onImported?.();
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const columns = preview?.columns || [];
  const used = new Set(Object.values(mapping).filter(Boolean));
  const rows = preview?.rows || [];
  const duplicateRows = rows.filter(isDuplicateRow);
  const readyRows = rows.filter((row) => row.valid && !isDuplicateRow(row));
  const invalidRows = rows.filter((row) => !row.valid);

  return (
    <>
      <button className="btn secondary" type="button" onClick={() => inputRef.current?.click()}>Upload Excel</button>
      <input ref={inputRef} hidden type="file" accept=".xlsx,.xls,.csv" aria-label="Upload Excel or CSV" onChange={choose} />
      {(file || busy) && (
        <Modal title="Map Excel columns" onClose={close}>
          {busy && !preview && <p>Reading the file…</p>}
          {preview && (
            <>
              <p className="muted">{file?.name}. Match each lead field to a column. Column A is the first column in the sheet.</p>
              <div className="map-sheet" aria-label="Columns in this file">
                {columns.map((column) => (
                  <div className="map-col" key={column.header}>
                    <strong>Column {column.letter}</strong>
                    <span>Column {column.number}</span>
                    <span>{column.header}</span>
                    <em>{column.sample || 'Empty'}</em>
                  </div>
                ))}
              </div>
              <table className="map-table">
                <thead>
                  <tr><th>Lead field</th><th>Excel column</th></tr>
                </thead>
                <tbody>
                  {fields.map((field) => (
                    <tr key={field.key}>
                      <td>{field.label}{field.required ? ' *' : ''}</td>
                      <td>
                        <select aria-label={`${field.label} column`} value={mapping[field.key] || ''} onChange={(event) => changeColumn(field.key, event.target.value)}>
                          <option value="">Not in this file</option>
                          {columns.map((column) => (
                            <option key={column.header} value={column.header} disabled={used.has(column.header) && mapping[field.key] !== column.header}>
                              {columnLabel(column)}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <section className="import-review" style={{ marginTop: 16 }}>
                <h3>Review</h3>
                <p className="muted">All mapped rows are listed below. Fix mapping if needed, remove duplicates, then import the remaining leads.</p>
                <div className="cluster" style={{ margin: '12px 0' }}>
                  <Badge>{preview.summary?.total || rows.length} total</Badge>
                  <Badge tone="success">{readyRows.length} ready</Badge>
                  <Badge tone="warning">{duplicateRows.length} duplicates</Badge>
                  <Badge tone="danger">{invalidRows.length} need a fix</Badge>
                </div>

                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Row</th><th>Name</th><th>Phone</th><th>Result</th></tr></thead>
                    <tbody>
                      {rows.slice(0, 40).map((row) => (
                        <tr key={row.rowNumber}>
                          <td>{row.rowNumber}</td>
                          <td>{row.mapped?.name || '—'}</td>
                          <td>{row.mapped?.phone || '—'}</td>
                          <td>
                            {!row.valid
                              ? (row.rowErrors || []).join(', ')
                              : isDuplicateRow(row)
                                ? duplicateReason(row)
                                : row.mapped?.statusFallback
                                  ? `Ready · stage “${row.mapped.excelStage}” → Fresh`
                                  : 'Ready'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rows.length > 40 && <p className="muted">Showing first 40 of {rows.length} rows.</p>}

                {duplicateRows.length > 0 && (
                  <article className="card lead-block" style={{ marginTop: 12 }}>
                    <h3>Duplicate leads ({duplicateRows.length})</h3>
                    <p className="muted">Checked against all leads in the database (bucket and already assigned). Remove them before importing.</p>
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>Row</th><th>Name</th><th>Phone</th><th>Why</th></tr></thead>
                        <tbody>
                          {duplicateRows.slice(0, 30).map((row) => (
                            <tr key={`dup-${row.rowNumber}`}>
                              <td>{row.rowNumber}</td>
                              <td>{row.mapped?.name || '—'}</td>
                              <td>{row.mapped?.phone || '—'}</td>
                              <td>{duplicateReason(row)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {duplicateRows.length > 30 && <p className="muted">Showing first 30 of {duplicateRows.length} duplicates.</p>}
                    <button className="btn secondary" type="button" style={{ marginTop: 12 }} disabled={busy} onClick={removeDuplicates}>
                      Remove duplicates
                    </button>
                  </article>
                )}
              </section>

              <div style={{ marginTop: 12 }}>
                <Field label="Client type for every row in this file">
                  <select aria-label="Upload client type" value={leadRole} onChange={(event) => setLeadRole(event.target.value)} required>
                    <option value="">Choose</option>
                    {leadRoles.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}
                  </select>
                </Field>
                <Field label="Firm for every row in this file">
                  <select aria-label="Upload firm" value={firm} onChange={(event) => setFirm(event.target.value)} required>
                    <option value="">Choose</option>
                    {leadFirms.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                  </select>
                </Field>
                <Field label="Lead source for every row in this file">
                  <select aria-label="Upload source" value={source} onChange={(event) => setSource(event.target.value)} required>
                    <option value="">Choose</option>
                    {sources.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </Field>
                <Field label="Assign lead to (optional)">
                  <select aria-label="Assign lead to staff" value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)}>
                    <option value="">Leave in bucket (unassigned)</option>
                    {staff.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}{person.role === 'TEAM_LEADER' ? ' · Team leader' : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <p className="muted">Optional. Pick a staff member to assign every imported lead to them now, or leave blank to put them in the bucket.</p>
                <button
                  className="btn"
                  type="button"
                  style={{ marginTop: 12 }}
                  disabled={busy || !readyRows.length || duplicateRows.length > 0}
                  onClick={commit}
                >
                  {duplicateRows.length > 0
                    ? 'Remove duplicates to continue'
                    : assignedTo
                      ? `Import ${readyRows.length} lead${readyRows.length === 1 ? '' : 's'} and assign to staff`
                      : `Import ${readyRows.length} lead${readyRows.length === 1 ? '' : 's'} into the bucket`}
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
