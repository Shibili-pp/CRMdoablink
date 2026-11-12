import { useState } from 'react';
import api from '../api/client';
import { Badge, Page } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

export default function ImportPage() {
  const { toast } = useApp();
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState([]);

  const refreshHistory = () => api.get('/api/v1/lead-imports').then((response) => setHistory(response.data.data)).catch(() => {});

  const upload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    setBusy(true);
    try {
      const response = await api.post('/api/v1/lead-imports', body);
      setPreview(response.data.data);
      toast('Preview ready. Nothing is assigned yet.');
      refreshHistory();
    } catch (error) { toast(messageFrom(error), 'error'); }
    finally { setBusy(false); }
  };

  const commit = async () => {
    setBusy(true);
    try {
      const response = await api.post(`/api/v1/lead-imports/${preview._id}/commit`, { skipDuplicates: true, updateExisting: false });
      toast(`Imported ${response.data.data.summary.imported}. Duplicates stayed out of the bucket.`);
      const fresh = await api.get(`/api/v1/lead-imports/${preview._id}`);
      setPreview(fresh.data.data);
    } catch (error) { toast(messageFrom(error), 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Page title="Excel and CSV import" subtitle="Uploaded leads stay in the bucket until someone assigns them." actions={<input type="file" accept=".xlsx,.xls,.csv" onChange={upload} />}>
      {busy && <p>Working…</p>}
      {preview && (
        <article className="card">
          <div className="cluster">
            <Badge>{preview.summary?.total || 0} rows</Badge>
            <Badge tone="success">{preview.summary?.valid || 0} valid</Badge>
            <Badge tone="warning">{preview.summary?.duplicates || 0} duplicates</Badge>
            <Badge tone="danger">{preview.summary?.invalid || 0} invalid</Badge>
            <Badge tone="info">{preview.status}</Badge>
          </div>
          <p className="muted" style={{ margin: '10px 0' }}>Detected columns: {(preview.detectedColumns || []).join(', ')}</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Row</th><th>Name</th><th>Phone</th><th>Result</th></tr></thead>
              <tbody>
                {(preview.rows || []).slice(0, 25).map((row) => (
                  <tr key={row.rowNumber}>
                    <td>{row.rowNumber}</td>
                    <td>{row.mapped?.name}</td>
                    <td>{row.mapped?.phone}</td>
                    <td>{row.action || (row.valid ? (row.duplicateInFile || row.duplicateLeadCode ? `Duplicate ${row.duplicateLeadCode || 'in file'}` : 'Ready') : (row.rowErrors || []).join(', '))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.status === 'preview' && <button className="btn" type="button" style={{ marginTop: 12 }} onClick={commit}>Import valid new rows</button>}
          {preview.summary?.imported != null && preview.status === 'completed' && <p style={{ marginTop: 12 }}>Imported {preview.summary.imported}, skipped {preview.summary.skipped}, failed {preview.summary.failed}.</p>}
        </article>
      )}
      <article className="card" style={{ marginTop: 14 }}>
        <h3>Upload history</h3>
        <button className="btn secondary" type="button" onClick={refreshHistory}>Refresh</button>
        {history.map((item) => <p key={item._id}>{item.fileName} · {item.status} · {item.uploadedBy?.name}</p>)}
      </article>
    </Page>
  );
}
