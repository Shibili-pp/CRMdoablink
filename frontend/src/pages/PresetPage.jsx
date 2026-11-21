import { useEffect, useState } from 'react';
import api from '../api/client';
import { Field, Page } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

function statusKey(label) {
  return label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

export default function PresetPage() {
  const { toast } = useApp();
  const [showStatuses, setShowStatuses] = useState(false);
  const [showClients, setShowClients] = useState(false);
  const [showFirms, setShowFirms] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [statuses, setStatuses] = useState([]);
  const [clients, setClients] = useState([]);
  const [firms, setFirms] = useState([]);
  const [sources, setSources] = useState([]);
  const [name, setName] = useState('');
  const [clientName, setClientName] = useState('');
  const [firmName, setFirmName] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/api/v1/lead-statuses')
    .then((response) => setStatuses(response.data.data || []))
    .catch((error) => toast(messageFrom(error), 'error'));

  const loadClients = () => api.get('/api/v1/lead-roles')
    .then((response) => setClients(response.data.data || []))
    .catch((error) => toast(messageFrom(error), 'error'));

  const loadFirms = () => api.get('/api/v1/lead-firms')
    .then((response) => setFirms(response.data.data || []))
    .catch((error) => toast(messageFrom(error), 'error'));

  const loadSources = () => api.get('/api/v1/lead-sources')
    .then((response) => setSources(response.data.data || []))
    .catch((error) => toast(messageFrom(error), 'error'));

  useEffect(() => { if (showStatuses) load(); }, [showStatuses]);
  useEffect(() => { if (showClients) loadClients(); }, [showClients]);
  useEffect(() => { if (showFirms) loadFirms(); }, [showFirms]);
  useEffect(() => { if (showSources) loadSources(); }, [showSources]);

  const addStatus = async (event) => {
    event.preventDefault();
    const label = name.trim();
    const key = statusKey(label);
    if (!key) {
      toast('Use letters or numbers in the status name', 'error');
      return;
    }
    setBusy(true);
    try {
      const sortOrder = (statuses.at(-1)?.sortOrder || 0) + 10;
      await api.post('/api/v1/lead-statuses', { key, label, category: 'open', sortOrder });
      setName('');
      toast('Status added');
      await load();
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeStatus = async (status) => {
    setBusy(true);
    try {
      await api.delete(`/api/v1/lead-statuses/${status._id}`);
      toast('Status removed');
      await load();
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const addClient = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/v1/lead-roles', { label: clientName.trim() });
      setClientName('');
      toast('Client type added');
      await loadClients();
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeClient = async (client) => {
    setBusy(true);
    try {
      await api.delete(`/api/v1/lead-roles/${client.key}`);
      toast('Client type removed');
      await loadClients();
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const addFirm = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/v1/lead-firms', { label: firmName.trim() });
      setFirmName('');
      toast('Firm added');
      await loadFirms();
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeFirm = async (firm) => {
    setBusy(true);
    try {
      await api.delete(`/api/v1/lead-firms/${firm.key}`);
      toast('Firm removed');
      await loadFirms();
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const addSource = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/v1/lead-sources', { label: sourceName.trim() });
      setSourceName('');
      toast('Source added');
      await loadSources();
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeSource = async (source) => {
    setBusy(true);
    try {
      await api.delete(`/api/v1/lead-sources/${encodeURIComponent(source)}`);
      toast('Source removed');
      await loadSources();
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="Preset" subtitle="Choices used on every lead">
      <button className={`card preset-choice ${showStatuses ? 'open' : ''}`} type="button" aria-expanded={showStatuses} onClick={() => setShowStatuses((open) => !open)}>
        <span>
          <strong>Statuses</strong>
          <span className="muted">What a lead can be changed to</span>
        </span>
        <span className="muted">{showStatuses ? 'Hide' : 'Open'}</span>
      </button>
      {showStatuses && (
        <article className="card lead-block">
          <h3>Statuses</h3>
          <p className="muted">Adding or deleting here updates the status list for staff and every other role.</p>
          <ul className="preset-list">
            {statuses.map((status) => (
              <li key={status._id || status.key}>
                <span>{status.label}</span>
                <button className="btn danger" type="button" disabled={busy} onClick={() => removeStatus(status)}>Delete</button>
              </li>
            ))}
          </ul>
          <form onSubmit={addStatus}>
            <Field label="New status">
              <input aria-label="New status" value={name} onChange={(event) => setName(event.target.value)} placeholder="Example: Site visit" required />
            </Field>
            <button className="btn lead-wide" type="submit" disabled={busy}>Add status</button>
          </form>
        </article>
      )}

      <button className={`card preset-choice ${showClients ? 'open' : ''}`} type="button" style={{ marginTop: 12 }} aria-expanded={showClients} onClick={() => setShowClients((open) => !open)}>
        <span>
          <strong>Managing clients</strong>
          <span className="muted">Student, education consultant and any client type you add</span>
        </span>
        <span className="muted">{showClients ? 'Hide' : 'Open'}</span>
      </button>
      {showClients && (
        <article className="card lead-block">
          <h3>Managing clients</h3>
          <p className="muted">New leads and uploads ask for one of these. The client type shows on every lead list.</p>
          <ul className="preset-list">
            {clients.map((client) => (
              <li key={client.key}>
                <span>{client.label}</span>
                <button className="btn danger" type="button" disabled={busy} onClick={() => removeClient(client)}>Delete</button>
              </li>
            ))}
          </ul>
          <form onSubmit={addClient}>
            <Field label="New client type">
              <input aria-label="New client type" value={clientName} onChange={(event) => setClientName(event.target.value)} placeholder="Example: Student" required />
            </Field>
            <button className="btn lead-wide" type="submit" disabled={busy}>Add client type</button>
          </form>
        </article>
      )}

      <button className={`card preset-choice ${showFirms ? 'open' : ''}`} type="button" style={{ marginTop: 12 }} aria-expanded={showFirms} onClick={() => setShowFirms((open) => !open)}>
        <span>
          <strong>Managing firm</strong>
          <span className="muted">Doablink, Studlink and any firm you add</span>
        </span>
        <span className="muted">{showFirms ? 'Hide' : 'Open'}</span>
      </button>
      {showFirms && (
        <article className="card lead-block">
          <h3>Managing firm</h3>
          <p className="muted">Every lead belongs to one firm. Lists and filters show Doablink or Studlink clearly.</p>
          <ul className="preset-list">
            {firms.map((firm) => (
              <li key={firm.key}>
                <span>{firm.label}</span>
                <button className="btn danger" type="button" disabled={busy} onClick={() => removeFirm(firm)}>Delete</button>
              </li>
            ))}
          </ul>
          <form onSubmit={addFirm}>
            <Field label="New firm">
              <input aria-label="New firm" value={firmName} onChange={(event) => setFirmName(event.target.value)} placeholder="Example: Doablink" required />
            </Field>
            <button className="btn lead-wide" type="submit" disabled={busy}>Add firm</button>
          </form>
        </article>
      )}

      <button className={`card preset-choice ${showSources ? 'open' : ''}`} type="button" style={{ marginTop: 12 }} aria-expanded={showSources} onClick={() => setShowSources((open) => !open)}>
        <span>
          <strong>Lead sources</strong>
          <span className="muted">Meta, scrapped lead and any source you add</span>
        </span>
        <span className="muted">{showSources ? 'Hide' : 'Open'}</span>
      </button>
      {showSources && (
        <article className="card lead-block">
          <h3>Lead sources</h3>
          <p className="muted">Excel upload asks for one of these for the whole file.</p>
          <ul className="preset-list">
            {sources.map((source) => (
              <li key={source}>
                <span>{source}</span>
                <button className="btn danger" type="button" disabled={busy} onClick={() => removeSource(source)}>Delete</button>
              </li>
            ))}
          </ul>
          <form onSubmit={addSource}>
            <Field label="New source">
              <input aria-label="New source" value={sourceName} onChange={(event) => setSourceName(event.target.value)} placeholder="Example: Meta" required />
            </Field>
            <button className="btn lead-wide" type="submit" disabled={busy}>Add source</button>
          </form>
        </article>
      )}
    </Page>
  );
}
