import { useEffect, useState } from 'react';
import api from '../api/client';
import { Badge, Page } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

export default function PasskeyPage() {
  const { user, toast } = useApp();
  const isOwner = user?.role === 'OWNER';
  const canOpen = isOwner || user?.role === 'SUPER_ADMIN';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  const load = () => {
    if (!canOpen) return;
    setLoading(true);
    api.get('/api/v1/lead-delete-passkey')
      .then((response) => setStatus(response.data.data || null))
      .catch((error) => toast(messageFrom(error), 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [canOpen]);

  const createPasskey = async () => {
    if (!isOwner) return;
    const confirmLabel = status?.hasPasskey ? 'Create a new 6-digit passkey? The old one will stop working.' : 'Create a 6-digit delete passkey?';
    if (!window.confirm(confirmLabel)) return;
    setSaving(true);
    try {
      const response = await api.post('/api/v1/lead-delete-passkey');
      setStatus(response.data.data || null);
      toast(response.data.message || 'Passkey created');
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!canOpen) {
    return (
      <Page title="Passkey" subtitle="Only Owner can manage the lead delete passkey.">
        <p className="muted">Ask the Owner to open Passkey and create a 6-digit code.</p>
      </Page>
    );
  }

  return (
    <Page
      title="Passkey"
      subtitle="Protect All Leads deletes. Owner creates a 6-digit passkey; Super Admin must enter it to delete."
      actions={isOwner ? (
        <button className="btn" type="button" onClick={createPasskey} disabled={loading || saving}>
          {saving ? 'Creating…' : (status?.hasPasskey ? 'Create new passkey' : 'Create passkey')}
        </button>
      ) : null}
    >
      <article className="card" style={{ maxWidth: 520 }}>
        {loading ? <p className="muted">Loading…</p> : null}
        {!loading && !status?.hasPasskey && (
          <p>
            <Badge tone="danger">No passkey</Badge>
            {' '}
            {isOwner
              ? 'Create a 6-digit passkey, then share it with Super Admin for All Leads deletes.'
              : 'Owner has not created a delete passkey yet. Ask Owner to create one.'}
          </p>
        )}
        {!loading && status?.hasPasskey && (
          <>
            <p>
              <Badge tone="success">Passkey active</Badge>
              {status.createdAt ? ` · created ${new Date(status.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}` : ''}
              {status.createdBy?.name ? ` · by ${status.createdBy.name}` : ''}
            </p>
            {isOwner && status.code ? (
              <p style={{ marginTop: 14, fontSize: 28, letterSpacing: '0.35em', fontWeight: 800 }}>
                {status.code}
              </p>
            ) : (
              <p className="muted" style={{ marginTop: 12 }}>
                Ask Owner for the current 6-digit passkey. Enter it when deleting from All Leads.
              </p>
            )}
            {isOwner && (
              <p className="muted" style={{ marginTop: 10 }}>
                Share this code with Super Admin. Creating a new passkey replaces the old one.
              </p>
            )}
          </>
        )}
      </article>
    </Page>
  );
}
