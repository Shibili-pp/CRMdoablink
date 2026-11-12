import { useEffect, useState } from 'react';
import api from '../api/client';
import { messageFrom, useApp } from '../context/AppContext';

function tomorrowKey() {
  const now = new Date();
  now.setDate(now.getDate() + 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export default function OverduePopup() {
  const { user, toast } = useApp();
  const [items, setItems] = useState([]);
  const [nextOpenAt, setNextOpenAt] = useState(null);
  const [form, setForm] = useState({ date: tomorrowKey(), time: '10:00', reason: '' });
  const [saving, setSaving] = useState(false);
  const current = items[0];

  const load = () => {
    if (user?.role !== 'STAFF') return;
    api.get('/api/v1/followups/popups').then((response) => {
      setItems(response.data.data || []);
      setNextOpenAt(response.data.meta?.nextOpenAt || null);
    }).catch(() => {});
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [user?.id]);

  useEffect(() => {
    if (!nextOpenAt) return undefined;
    const delay = new Date(nextOpenAt).getTime() - Date.now();
    const timer = setTimeout(load, Math.max(0, delay) + 400);
    return () => clearTimeout(timer);
  }, [nextOpenAt]);

  if (user?.role !== 'STAFF' || !current) return null;

  const submit = async (event) => {
    event.preventDefault();
    if (form.reason.trim().length < 3) {
      toast('Enter a reason', 'error');
      return;
    }
    setSaving(true);
    try {
      const savedId = current._id;
      await api.post(`/api/v1/followups/${savedId}/remind`, {
        date: form.date,
        time: form.time,
        reason: form.reason.trim(),
      });
      setItems((rows) => rows.filter((row) => row._id !== savedId));
      toast(`Popup closed. It opens again on ${form.date} at ${form.time}.`);
      setForm({ date: tomorrowKey(), time: '10:00', reason: '' });
      load();
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="alert-lock" role="alertdialog" aria-modal="true" aria-labelledby="overdue-title">
      <form className="modal" onSubmit={submit}>
        <p className="muted">{items.length > 1 ? `Overdue follow-up 1 of ${items.length}` : 'Overdue follow-up'}</p>
        <h2 id="overdue-title">{current.title}</h2>
        <p>{current.leadCode ? `${current.leadCode} · ` : ''}{current.leadName}</p>
        <p className="muted">Due {new Date(current.dueAt).toLocaleString()}. Enter a later date, time and reason. The popup closes, then opens again at that time.</p>
        <div className="form-grid" style={{ marginTop: 12 }}>
          <label className="field"><span>Date</span>
            <input type="date" aria-label="Reminder date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} required />
          </label>
          <label className="field"><span>Time</span>
            <input type="time" step="60" aria-label="Reminder time" value={form.time} onChange={(event) => setForm({ ...form, time: event.target.value })} required />
          </label>
          <label className="field full"><span>Reason</span>
            <textarea aria-label="Reason" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} required minLength={3} placeholder="Why this follow-up is moving" />
          </label>
        </div>
        <button className="btn" type="submit" style={{ marginTop: 14 }} disabled={saving}>{saving ? 'Saving…' : 'Remind me later'}</button>
      </form>
    </div>
  );
}
