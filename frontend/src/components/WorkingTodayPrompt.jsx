import { useEffect, useState } from 'react';
import api from '../api/client';
import { messageFrom, useApp } from '../context/AppContext';

export default function WorkingTodayPrompt() {
  const { user, toast } = useApp();
  const [prompt, setPrompt] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    if (!user || !['STAFF', 'TEAM_LEADER'].includes(user.role)) return;
    api.get('/api/v1/lead-assignments/my-working-today')
      .then((response) => {
        const data = response.data.data;
        if (data?.needsAnswer) setPrompt(data);
        else setPrompt(null);
      })
      .catch(() => {});
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (!prompt) return undefined;
    const block = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('keydown', block, true);
    return () => window.removeEventListener('keydown', block, true);
  }, [prompt]);

  if (!prompt) return null;

  const answer = async (working) => {
    if (saving) return;
    setSaving(true);
    try {
      const response = await api.post('/api/v1/lead-assignments/my-working-today', { working });
      toast(response.data.message || (working ? 'Working today' : 'Not working today'));
      setPrompt(null);
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="alert-lock hour-lock" role="alertdialog" aria-modal="true" aria-labelledby="working-today-title">
      <div className="modal">
        <p className="muted">Daily check-in · {prompt.dateKey} · work from {prompt.workStart}</p>
        <h2 id="working-today-title">Are you working today?</h2>
        <p className="muted">
          If you choose Yes, new sheet (inbound) leads and other auto-assign leads will be shared among staff who said Yes.
          If you choose No, you will not get auto-assigned leads today.
        </p>
        {!prompt.autoAssignOn && (
          <p className="muted">Auto-assign is currently OFF. You can still answer — leads start when Owner turns Auto-assign ON.</p>
        )}
        <div className="btn-row">
          <button className="btn secondary" type="button" disabled={saving} onClick={() => answer(false)}>
            No
          </button>
          <button className="btn" type="button" disabled={saving} onClick={() => answer(true)}>
            {saving ? 'Saving…' : 'Yes, I am working'}
          </button>
        </div>
      </div>
    </div>
  );
}
