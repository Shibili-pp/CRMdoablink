import { useEffect, useState } from 'react';
import api from '../api/client';
import LeadUpload from '../components/LeadUpload';
import { Page } from '../components/ui';

export default function ImportPage() {
  const [history, setHistory] = useState([]);
  const refreshHistory = () => api.get('/api/v1/lead-imports').then((response) => setHistory(response.data.data)).catch(() => {});
  useEffect(() => { refreshHistory(); }, []);

  return (
    <Page title="Excel and CSV import" subtitle="Uploaded leads stay in the bucket until someone assigns them." actions={<LeadUpload onImported={refreshHistory} />}>
      <article className="card">
        <h3>Upload history</h3>
        <button className="btn secondary" type="button" onClick={refreshHistory}>Refresh</button>
        {history.map((item) => <p key={item._id}>{item.fileName} · {item.status} · {item.uploadedBy?.name}</p>)}
        {!history.length && <p className="muted">No files uploaded yet.</p>}
      </article>
    </Page>
  );
}
