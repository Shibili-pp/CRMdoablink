import { useState } from 'react';

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export default function DemoScheduleModal({ leadName, onCancel, onConfirm }) {
  const [date, setDate] = useState(todayKey());
  const [time, setTime] = useState('11:00');
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!date || !time) return;
    setSaving(true);
    try {
      await onConfirm({ demoDate: date, demoTime: time });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-back" role="presentation">
      <form className="modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="demo-schedule-title">
        <h2 id="demo-schedule-title">Schedule demo</h2>
        <p className="muted" style={{ margin: '8px 0 14px' }}>
          {leadName ? `${leadName} · ` : ''}Choose date and time. This creates an upcoming demo in Follow-ups.
        </p>
        <div className="form-grid">
          <label className="field"><span>Date</span>
            <input type="date" aria-label="Demo date" value={date} onChange={(event) => setDate(event.target.value)} required />
          </label>
          <label className="field"><span>Time</span>
            <input type="time" step="60" aria-label="Demo time" value={time} onChange={(event) => setTime(event.target.value)} required />
          </label>
        </div>
        <div className="actions" style={{ marginTop: 14 }}>
          <button className="btn secondary" type="button" onClick={onCancel} disabled={saving}>Cancel</button>
          <button className="btn" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Okay'}</button>
        </div>
      </form>
    </div>
  );
}
