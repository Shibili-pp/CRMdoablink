import { useState } from 'react';

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export const DEMO_OVER_STATUSES = ['demo_completed'];
export const DEMO_CANCEL_STATUSES = ['demo_cancelled'];

export default function DemoCancelModal({
  leadName,
  mode = 'cancel', // 'cancel' | 'over'
  onCancel,
  onConfirm,
}) {
  const [date, setDate] = useState(todayKey());
  const [time, setTime] = useState('11:00');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const isCancel = mode === 'cancel';

  const submit = async (event) => {
    event.preventDefault();
    if (!date || !time) return;
    if (isCancel && reason.trim().length < 3) return;
    setSaving(true);
    try {
      await onConfirm({
        followUpDate: date,
        followUpTime: time,
        ...(isCancel ? { cancelReason: reason.trim() } : {}),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-back" role="presentation">
      <form className="modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="demo-outcome-title">
        <h2 id="demo-outcome-title">{isCancel ? 'Cancel demo' : 'Demo over'}</h2>
        <p className="muted" style={{ margin: '8px 0 14px' }}>
          {leadName ? `${leadName} · ` : ''}
          {isCancel
            ? 'Enter cancellation reason and the next follow-up date. Demo moves to Cancelled demos and a follow-up is created.'
            : 'Enter the next follow-up date. Demo moves to Completed demos and a follow-up is created.'}
        </p>
        <div className="form-grid">
          {isCancel && (
            <label className="field full"><span>Cancellation reason</span>
              <textarea
                aria-label="Cancellation reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                required
                minLength={3}
                rows={3}
                placeholder="Why was this demo cancelled?"
              />
            </label>
          )}
          <label className="field"><span>Next follow-up date</span>
            <input type="date" aria-label="Next follow-up date" value={date} onChange={(event) => setDate(event.target.value)} required />
          </label>
          <label className="field"><span>Time</span>
            <input type="time" step="60" aria-label="Follow-up time" value={time} onChange={(event) => setTime(event.target.value)} required />
          </label>
        </div>
        <div className="actions" style={{ marginTop: 14 }}>
          <button className="btn secondary" type="button" onClick={onCancel} disabled={saving}>Back</button>
          <button className="btn" type="submit" disabled={saving || (isCancel && reason.trim().length < 3)}>
            {saving ? 'Saving…' : (isCancel ? 'Cancel demo' : 'Mark demo over')}
          </button>
        </div>
      </form>
    </div>
  );
}
