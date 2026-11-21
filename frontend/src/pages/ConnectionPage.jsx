import { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import { Badge, Field, Modal, Page } from '../components/ui';
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

const emptyDraft = {
  firm: 'doablink',
  name: '',
  sheetUrl: '',
  leadRole: '',
  source: '',
  mapping: {},
  columns: [],
  rowCount: 0,
};

export default function ConnectionPage() {
  const { toast, confirm } = useApp();
  const [rows, setRows] = useState([]);
  const [firms, setFirms] = useState([]);
  const [leadRoles, setLeadRoles] = useState([]);
  const [sources, setSources] = useState([]);
  const [fields, setFields] = useState(fallbackFields);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.get('/api/v1/sheet-connections')
      .then((response) => setRows(response.data.data || []))
      .catch((error) => toast(messageFrom(error), 'error'));
  };

  useEffect(() => {
    load();
    api.get('/api/v1/meta').then((response) => {
      setFirms(response.data.data.leadFirms || []);
      setLeadRoles(response.data.data.leadRoles || []);
      setSources(response.data.data.sources || []);
      if (response.data.data.importFields?.length) {
        setFields(response.data.data.importFields.filter((field) => field.key !== 'source'));
      }
    }).catch(() => {});
  }, []);

  const byFirm = useMemo(() => {
    const map = {};
    (firms.length ? firms : [
      { key: 'doablink', label: 'Doablink' },
      { key: 'studlink', label: 'Studlink' },
    ]).forEach((firm) => {
      map[firm.key] = {
        firm,
        sheets: rows.filter((row) => row.firm === firm.key),
      };
    });
    return Object.values(map);
  }, [firms, rows]);

  const startAdd = (firmKey) => {
    setDraft({ ...emptyDraft, firm: firmKey });
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setDraft(emptyDraft);
  };

  const preview = async (event) => {
    event.preventDefault();
    if (!draft.sheetUrl.trim()) {
      toast('Paste a Google Sheet link', 'error');
      return;
    }
    setBusy(true);
    try {
      const response = await api.post('/api/v1/sheet-connections/preview', { sheetUrl: draft.sheetUrl.trim() });
      setDraft((current) => ({
        ...current,
        columns: response.data.data.columns || [],
        mapping: response.data.data.mapping || {},
        rowCount: response.data.data.rowCount || 0,
        name: current.name || 'Google Sheet',
      }));
      toast('Columns loaded. Map name and phone, then save.');
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const save = async (event) => {
    event.preventDefault();
    if (!draft.mapping?.name || !draft.mapping?.phone) {
      toast('Choose the column for name and the column for phone', 'error');
      return;
    }
    if (!draft.leadRole || !draft.source || !draft.name.trim()) {
      toast('Fill sheet name, client type and source', 'error');
      return;
    }
    setBusy(true);
    try {
      const response = await api.post('/api/v1/sheet-connections', {
        name: draft.name.trim(),
        firm: draft.firm,
        sheetUrl: draft.sheetUrl.trim(),
        mapping: draft.mapping,
        leadRole: draft.leadRole,
        source: draft.source,
      });
      toast(response.data.message || 'Sheet connected');
      close();
      load();
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const syncOne = async (id) => {
    setBusy(true);
    try {
      const response = await api.post(`/api/v1/sheet-connections/${id}/sync`);
      toast(response.data.message || 'Sync finished');
      load();
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const syncAll = async () => {
    setBusy(true);
    try {
      await api.post('/api/v1/sheet-connections/sync-all');
      toast('All sheets synced');
      load();
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (row) => {
    try {
      await api.patch(`/api/v1/sheet-connections/${row._id || row.id}`, { enabled: !row.enabled });
      load();
    } catch (error) {
      toast(messageFrom(error), 'error');
    }
  };

  const remove = async (row) => {
    const ok = await confirm({
      title: 'Remove sheet',
      message: `${row.name} will stop syncing. Existing leads stay in the CRM.`,
      danger: true,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    try {
      await api.delete(`/api/v1/sheet-connections/${row._id || row.id}`);
      toast('Sheet removed');
      load();
    } catch (error) {
      toast(messageFrom(error), 'error');
    }
  };

  const used = new Set(Object.values(draft.mapping || {}).filter(Boolean));

  return (
    <Page
      title="Connection"
      subtitle="Connect Google Sheets for Doablink and Studlink. New rows sync into Lead Bucket → New lead from sheet."
      actions={<button className="btn secondary" type="button" disabled={busy} onClick={syncAll}>Sync all now</button>}
    >
      <p className="muted">Share each Google Sheet as “Anyone with the link can view”. Map columns once; new records are added automatically about every 3 minutes.</p>

      {byFirm.map(({ firm, sheets }) => (
        <section key={firm.key} className="lead-section" style={{ marginTop: 16 }}>
          <div className="page-head" style={{ marginBottom: 10 }}>
            <div className="page-copy">
              <h2>{firm.label}</h2>
              <p className="muted">{sheets.length} connected sheet{sheets.length === 1 ? '' : 's'}</p>
            </div>
            <button className="btn" type="button" onClick={() => startAdd(firm.key)}>Add Google Sheet</button>
          </div>
          {!sheets.length && <p className="muted">No sheets yet for {firm.label}.</p>}
          <div className="card-list">
            {sheets.map((row) => (
              <article key={row._id || row.id} className="card lead-block">
                <div className="lead-sheet-top">
                  <strong>{row.name}</strong>
                  <Badge tone={row.enabled ? 'success' : 'warning'}>{row.enabled ? 'On' : 'Paused'}</Badge>
                </div>
                <p className="muted" style={{ wordBreak: 'break-all' }}>{row.sheetUrl}</p>
                <p className="muted">
                  Client: {leadRoles.find((item) => item.key === row.leadRole)?.label || row.leadRole}
                  {' · '}
                  Source: {row.source}
                </p>
                <p className="muted">
                  Last sync: {row.lastSyncedAt ? new Date(row.lastSyncedAt).toLocaleString('en-IN') : 'Not yet'}
                  {row.lastSyncMessage ? ` · ${row.lastSyncMessage}` : ''}
                </p>
                <div className="actions" style={{ marginTop: 10 }}>
                  <button className="btn" type="button" disabled={busy} onClick={() => syncOne(row._id || row.id)}>Sync now</button>
                  <button className="btn secondary" type="button" onClick={() => toggle(row)}>{row.enabled ? 'Pause' : 'Resume'}</button>
                  <button className="btn danger" type="button" onClick={() => remove(row)}>Remove</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}

      {open && (
        <Modal title={`Add Google Sheet · ${(firms.find((item) => item.key === draft.firm) || {}).label || draft.firm}`} onClose={close}>
          <form className="form-grid" onSubmit={draft.columns.length ? save : preview}>
            <Field label="Sheet name" full>
              <input aria-label="Sheet name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Example: Meta leads May" required={Boolean(draft.columns.length)} />
            </Field>
            <Field label="Google Sheet link" full>
              <input
                aria-label="Google Sheet link"
                value={draft.sheetUrl}
                onChange={(event) => setDraft({ ...draft, sheetUrl: event.target.value, columns: [], mapping: {} })}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                required
              />
            </Field>
            {!draft.columns.length && (
              <div className="full">
                <p className="muted">Share the sheet so anyone with the link can view, then load columns.</p>
                <button className="btn" type="submit" disabled={busy}>{busy ? 'Reading…' : 'Load columns'}</button>
              </div>
            )}
            {draft.columns.length > 0 && (
              <>
                <p className="full muted">{draft.rowCount} data rows found. Map fields like bulk upload. Firm stays {draft.firm}.</p>
                <table className="map-table full">
                  <thead>
                    <tr><th>Lead field</th><th>Sheet column</th></tr>
                  </thead>
                  <tbody>
                    {fields.map((field) => (
                      <tr key={field.key}>
                        <td>{field.label}{field.required ? ' *' : ''}</td>
                        <td>
                          <select
                            aria-label={`${field.label} column`}
                            value={draft.mapping[field.key] || ''}
                            onChange={(event) => setDraft({
                              ...draft,
                              mapping: { ...draft.mapping, [field.key]: event.target.value },
                            })}
                          >
                            <option value="">Not in this sheet</option>
                            {draft.columns.map((column) => (
                              <option
                                key={column.header}
                                value={column.header}
                                disabled={used.has(column.header) && draft.mapping[field.key] !== column.header}
                              >
                                {columnLabel(column)}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Field label="Client type for new rows">
                  <select aria-label="Client type" value={draft.leadRole} onChange={(event) => setDraft({ ...draft, leadRole: event.target.value })} required>
                    <option value="">Choose</option>
                    {leadRoles.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}
                  </select>
                </Field>
                <Field label="Lead source for new rows">
                  <select aria-label="Lead source" value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value })} required>
                    <option value="">Choose</option>
                    {sources.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </Field>
                <div className="full actions">
                  <button className="btn secondary" type="button" disabled={busy} onClick={preview}>Reload columns</button>
                  <button className="btn" type="submit" disabled={busy}>Save connection</button>
                </div>
              </>
            )}
          </form>
        </Modal>
      )}
    </Page>
  );
}
