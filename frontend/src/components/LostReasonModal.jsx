import { useState } from 'react';

export const BUCKET_PARK_STATUSES = ['disqualified', 'not_interested'];

export default function LostReasonModal({
  leadName,
  statusLabel = 'this status',
  onCancel,
  onConfirm,
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (reason.trim().length < 3) return;
    setSaving(true);
    try {
      await onConfirm({ lostReason: reason.trim() });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-back" role="presentation">
      <form className="modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="lost-reason-title">
        <h2 id="lost-reason-title">Reason required</h2>
        <p className="muted" style={{ margin: '8px 0 14px' }}>
          {leadName ? `${leadName} · ` : ''}
          Why is this lead {statusLabel}? It will leave Lead Management and move to the bucket.
        </p>
        <label className="field full"><span>Reason</span>
          <textarea
            aria-label="Status reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            minLength={3}
            rows={3}
            placeholder={statusLabel === 'Not Interested' ? 'Why not interested?' : 'Why disqualified?'}
          />
        </label>
        <div className="actions" style={{ marginTop: 14 }}>
          <button className="btn secondary" type="button" onClick={onCancel} disabled={saving}>Back</button>
          <button className="btn" type="submit" disabled={saving || reason.trim().length < 3}>
            {saving ? 'Saving…' : 'Move to bucket'}
          </button>
        </div>
      </form>
    </div>
  );
}
