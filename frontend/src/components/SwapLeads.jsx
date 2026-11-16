import { useEffect, useState } from 'react';
import api from '../api/client';
import { Field, Modal } from './ui';
import { messageFrom } from '../context/AppContext';

function Side({ title, people, otherId, staffId, onStaff, statuses, leadRoles = [], picked, onToggle }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [leadRole, setLeadRole] = useState('');
  const [rows, setRows] = useState([]);

  useEffect(() => {
    if (!staffId) {
      setRows([]);
      return undefined;
    }
    const params = new URLSearchParams({ staff: staffId, limit: '100' });
    if (query.trim()) params.set('q', query.trim());
    if (status) params.set('status', status);
    if (leadRole) params.set('leadRole', leadRole);
    const handle = setTimeout(() => {
      api.get(`/api/v1/leads?${params}`).then((response) => setRows(response.data.data || [])).catch(() => setRows([]));
    }, 200);
    return () => clearTimeout(handle);
  }, [staffId, query, status, leadRole]);

  return (
    <section className="swap-side">
      <h3>{title}</h3>
      <Field label="Staff">
        <select aria-label={`${title} staff`} value={staffId} onChange={(event) => onStaff(event.target.value)}>
          <option value="">Choose staff</option>
          {people.filter((person) => person.id !== otherId).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
        </select>
      </Field>
      <div className="swap-filters">
        <input aria-label={`${title} search`} placeholder="Name, phone or lead ID" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select aria-label={`${title} status`} value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All statuses</option>
          {statuses.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
        <select aria-label={`${title} role`} value={leadRole} onChange={(event) => setLeadRole(event.target.value)}>
          <option value="">All roles</option>
          {leadRoles.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}
        </select>
      </div>
      <div className="swap-list">
        {rows.map((row) => (
          <label key={row._id}>
            <input type="checkbox" checked={picked.includes(row._id)} onChange={() => onToggle(row._id)} />
            <span><strong>{row.name}</strong><span className="muted">{row.leadCode} · {leadRoles.find((role) => role.key === row.leadRole)?.label || 'No role'}</span></span>
          </label>
        ))}
        {staffId && !rows.length && <p className="muted">No leads for this filter.</p>}
      </div>
      <p className="muted">{picked.length} selected</p>
    </section>
  );
}

export default function SwapLeads({ people, statuses, leadRoles = [], onClose, onDone, toast }) {
  const [staffA, setStaffA] = useState('');
  const [staffB, setStaffB] = useState('');
  const [pickA, setPickA] = useState([]);
  const [pickB, setPickB] = useState([]);
  const [busy, setBusy] = useState(false);

  const toggle = (list, setList, id) => setList(list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);

  const swap = async () => {
    if (!staffA || !staffB) {
      toast('Choose two staff members', 'error');
      return;
    }
    if (!pickA.length && !pickB.length) {
      toast('Select at least one lead', 'error');
      return;
    }
    setBusy(true);
    try {
      const response = await api.post('/api/v1/lead-assignments/swap', { staffA, staffB, leadIdsA: pickA, leadIdsB: pickB });
      toast(response.data.message || 'Leads updated');
      onDone();
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Swap leads" onClose={onClose}>
      <p className="muted">Pick leads on either side. The counts do not have to match. If only one side has leads, those leads move to the other staff member.</p>
      <div className="swap-board">
        <Side title="Staff A" people={people} otherId={staffB} staffId={staffA} onStaff={(id) => { setStaffA(id); setPickA([]); }} statuses={statuses} leadRoles={leadRoles} picked={pickA} onToggle={(id) => toggle(pickA, setPickA, id)} />
        <Side title="Staff B" people={people} otherId={staffA} staffId={staffB} onStaff={(id) => { setStaffB(id); setPickB([]); }} statuses={statuses} leadRoles={leadRoles} picked={pickB} onToggle={(id) => toggle(pickB, setPickB, id)} />
      </div>
      <button className="btn lead-wide" type="button" disabled={busy} onClick={swap}>{pickA.length && pickB.length ? 'Swap' : 'Move selected'}</button>
    </Modal>
  );
}
