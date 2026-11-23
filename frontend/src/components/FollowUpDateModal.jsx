import { useState } from 'react';

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export const FOLLOWUP_GATE_STATUSES = [
  'positive',
  'prospect',
  'follow_up_required',
  'may_buy_later',
  'dp_received',
  'interested_to_buy',
];

export default function FollowUpDateModal({
  leadName,
  statusLabel,
  onCancel,
  onConfirm,
}) {
  const [date, setDate] = useState(todayKey());
  const [time, setTime] = useState('11:00');
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!date || !time) return;
    setSaving(true);
    try {
      await onConfirm({ followUpDate: date, followUpTime: time });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-back" role="presentation">
      <form className="modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="followup-date-title">
        <h2 id="followup-date-title">Set follow-up date</h2>
        <p className="muted" style={{ margin: '8px 0 14px' }}>
          {leadName ? `${leadName} · ` : ''}
          Choose follow-up date and time to set status
          {statusLabel ? ` to ${statusLabel}` : ''}. This also adds the lead to Follow-ups.
        </p>
        <div className="form-grid">
          <label className="field"><span>Follow-up date</span>
            <input type="date" aria-label="Follow-up date" value={date} onChange={(event) => setDate(event.target.value)} required />
          </label>
          <label className="field"><span>Time</span>
            <input type="time" step="60" aria-label="Follow-up time" value={time} onChange={(event) => setTime(event.target.value)} required />
          </label>
        </div>
        <div className="actions" style={{ marginTop: 14 }}>
          <button className="btn secondary" type="button" onClick={onCancel} disabled={saving}>Cancel</button>
          <button className="btn" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Set status'}</button>
        </div>
      </form>
    </div>
  );
}
