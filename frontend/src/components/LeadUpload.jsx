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
  { key: 'district', label: 'District' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'country', label: 'Country' },
  { key: 'priority', label: 'Priority' },
  { key: 'expectedRevenue', label: 'Expected revenue' },
  { key: 'notes', label: 'Notes' },
];

function columnLabel(column) {
  const sample = column.sample ? ` · ${column.sample}` : '';
  return `Column ${column.letter} (${column.number}) — ${column.header}${sample}`;
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
  const [sources, setSources] = useState([]);
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/api/v1/meta').then((response) => {
      setLeadRoles(response.data.data.leadRoles || []);
      setSources(response.data.data.sources || []);
      if (response.data.data.importFields?.length) setFields(response.data.data.importFields.filter((field) => field.key !== 'source'));
    }).catch(() => {});
  }, []);

  const close = () => {
    setFile(null);
    setPreview(null);
    setMapping({});
    setLeadRole('');
    setSource('');
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

  const commit = async () => {
    if (!mapping.name || !mapping.phone) {
      toast('Choose the column for name and the column for phone', 'error');
      return;
    }
    if (!leadRole) {
      toast('Choose a role for these leads', 'error');
      return;
    }
    if (!source) {
      toast('Choose a lead source for these leads', 'error');
      return;
    }
    setBusy(true);
    try {
      const response = await api.post(`/api/v1/lead-imports/${preview._id}/commit`, { skipDuplicates: true, updateExisting: false, leadRole, source });
      toast(`Imported ${response.data.data.summary.imported} leads into the bucket`);
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
              <div className="cluster" style={{ margin: '12px 0' }}>
                <Badge>{preview.summary?.total || 0} rows</Badge>
                <Badge tone="success">{preview.summary?.valid || 0} ready</Badge>
                <Badge tone="warning">{preview.summary?.duplicates || 0} duplicates</Badge>
                <Badge tone="danger">{preview.summary?.invalid || 0} need a fix</Badge>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Row</th><th>Name</th><th>Phone</th><th>Result</th></tr></thead>
                  <tbody>
                    {(preview.rows || []).slice(0, 8).map((row) => (
                      <tr key={row.rowNumber}>
                        <td>{row.rowNumber}</td>
                        <td>{row.mapped?.name || '—'}</td>
                        <td>{row.mapped?.phone || '—'}</td>
                        <td>{row.valid ? (row.duplicateInFile || row.duplicateLeadCode ? `Duplicate ${row.duplicateLeadCode || 'in file'}` : 'Ready') : (row.rowErrors || []).join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 12 }}>
                <Field label="Role for every row in this file">
                  <select aria-label="Upload role" value={leadRole} onChange={(event) => setLeadRole(event.target.value)} required>
                    <option value="">Choose</option>
                    {leadRoles.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}
                  </select>
                </Field>
                <Field label="Lead source for every row in this file">
                  <select aria-label="Upload source" value={source} onChange={(event) => setSource(event.target.value)} required>
                    <option value="">Choose</option>
                    {sources.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </Field>
                <button className="btn" type="button" style={{ marginTop: 12 }} disabled={busy} onClick={commit}>Import into the bucket</button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
