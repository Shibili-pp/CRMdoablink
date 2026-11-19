import { useEffect, useState } from 'react';
import api from '../api/client';
import { messageFrom, useApp } from '../context/AppContext';

export default function HourlyLock() {
  const { user, toast } = useApp();
  const [due, setDue] = useState(null);
  const [step, setStep] = useState('report');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    if (user?.role !== 'STAFF') return;
    api.get('/api/v1/hourly-reports/check-in')
      .then((response) => setDue(response.data.data || null))
      .catch(() => {});
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 20000);
    return () => clearInterval(timer);
  }, [user?.id]);

  useEffect(() => {
    setStep('report');
    setReason('');
  }, [due?.dateKey, due?.hour]);

  useEffect(() => {
    if (!due) return undefined;
    const block = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('keydown', block, true);
    return () => window.removeEventListener('keydown', block, true);
  }, [due]);

  if (user?.role !== 'STAFF' || !due) return null;

  const copyText = async () => {
    const text = due.reportText;
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '0';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.focus();
    area.select();
    let copiedOk = false;
    try { copiedOk = document.execCommand('copy'); } catch { copiedOk = false; }
    area.remove();
    if (!copiedOk && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        copiedOk = true;
      } catch { copiedOk = false; }
    }
    return copiedOk;
  };

  const copy = async () => {
    if (window.OrbitNative?.shareText) {
      try {
        window.OrbitNative.shareText(due.reportText);
        toast('Hourly report ready to share');
        return;
      } catch { /* fall through */ }
    }
    const copiedOk = await copyText();
    toast(copiedOk ? 'Hourly report copied' : 'Select the report text and copy it if needed.');
  };

  const submit = async (nextReason) => {
    setSaving(true);
    try {
      await api.post('/api/v1/hourly-reports/check-in', {
        dateKey: due.dateKey,
        hour: due.hour,
        reason: nextReason,
      });
      toast('Hourly report submitted');
      setDue(null);
      load();
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  const okay = async () => {
    if (saving) return;
    await copyText();
    if (due.reached) {
      submit('');
      return;
    }
    setStep('reason');
  };

  return (
    <div className="alert-lock hour-lock" role="alertdialog" aria-modal="true" aria-labelledby="hour-lock-title">
      <div className="modal">
        {step === 'report' ? (
          <>
            <p className="muted">{due.pending > 1 ? `Hour 1 of ${due.pending}` : 'Hourly report'}</p>
            <h2 id="hour-lock-title">This is your hourly report from {due.label}</h2>
            <p className="muted">Working time {due.workStart} to {due.workEnd} includes a 1-hour lunch break. Hourly targets use the productive hours only. Copy the report, then press OK.</p>
            <pre className="hour-report">{due.reportText}</pre>
            <div className="hour-checks">
              {due.checks.map((row) => (
                <p key={row.key} className={row.short ? 'hour-short' : ''}>{row.label}: {row.actualLabel} / {row.targetLabel} this hour</p>
              ))}
            </div>
            <div className="btn-row">
              <button className="btn secondary" type="button" onClick={copy}>Copy report</button>
              <button className="btn" type="button" onClick={okay} disabled={saving}>OK</button>
            </div>
          </>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); submit(reason.trim()); }}>
            <h2 id="hour-lock-title">Why was the target not reached?</h2>
            <p className="muted">{due.label}. Enter what happened in this hour.</p>
            <ul className="hour-checks">
              {due.checks.filter((row) => row.short).map((row) => (
                <li key={row.key} className="hour-short">{row.label}: {row.actualLabel} / {row.targetLabel}</li>
              ))}
            </ul>
            <label className="field">
              <span>Details</span>
              <textarea aria-label="Why the target was not reached" value={reason} onChange={(event) => setReason(event.target.value)} required minLength={3} />
            </label>
            <div className="btn-row single">
              <button className="btn" type="submit" disabled={saving || reason.trim().length < 3}>Submit</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
