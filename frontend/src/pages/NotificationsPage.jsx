import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { Page } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

export default function NotificationsPage() {
  const { toast, can } = useApp();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [announce, setAnnounce] = useState({ title: '', body: '' });

  const load = () => api.get('/api/v1/notifications').then((response) => setRows(response.data.data)).catch((error) => toast(messageFrom(error), 'error'));
  useEffect(() => { load(); }, []);

  const read = async (id) => {
    await api.post(`/api/v1/notifications/${id}/read`);
    load();
  };

  const openRow = async (row) => {
    if (!row.readAt) {
      try { await api.post(`/api/v1/notifications/${row._id}/read`); } catch (_) { /* ignore */ }
    }
    if (row.module === 'leads' && row.recordId) {
      navigate(`/leads/${row.recordId}`);
      return;
    }
    load();
  };

  const send = async (event) => {
    event.preventDefault();
    try {
      await api.post('/api/v1/notifications/announce', announce);
      toast('Announcement sent');
      setAnnounce({ title: '', body: '' });
      load();
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  return (
    <Page title="Notifications" subtitle="Assignments, RNP recalls, follow-ups, swaps, targets and announcements." actions={<button className="btn secondary" type="button" onClick={() => api.post('/api/v1/notifications/read-all').then(load)}>Mark all read</button>}>
      {can('notifications.manage') && (
        <form className="card" onSubmit={send} style={{ marginBottom: 14 }}>
          <h3>Announcement</h3>
          <input placeholder="Title" aria-label="Announcement title" value={announce.title} onChange={(event) => setAnnounce({ ...announce, title: event.target.value })} required />
          <textarea style={{ marginTop: 8 }} placeholder="Message" aria-label="Announcement message" value={announce.body} onChange={(event) => setAnnounce({ ...announce, body: event.target.value })} required />
          <button className="btn" type="submit" style={{ marginTop: 8 }}>Send</button>
        </form>
      )}
      {rows.map((row) => (
        <article key={row._id} className="card" style={{ marginBottom: 8, opacity: row.readAt ? 0.7 : 1, cursor: 'pointer' }} onClick={() => openRow(row)}>
          <strong>{row.title}</strong>
          <p>{row.body}</p>
          <div className="muted">{new Date(row.createdAt).toLocaleString()} · {row.type}</div>
          {row.readAt ? null : <button className="btn ghost" type="button" onClick={(event) => { event.stopPropagation(); read(row._id); }}>Mark read</button>}
        </article>
      ))}
    </Page>
  );
}
