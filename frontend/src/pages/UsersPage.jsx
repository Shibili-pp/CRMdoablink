import { useEffect, useState } from 'react';
import api from '../api/client';
import { Badge, DataTable, Field, Modal, Page } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

const ROLE_LABEL = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  TEAM_LEADER: 'Team leader',
  STAFF: 'Staff',
  OWNER: 'Owner',
};

const RANK = { OWNER: 5, SUPER_ADMIN: 4, ADMIN: 3, TEAM_LEADER: 2, STAFF: 1 };

const emptyForm = {
  role: 'STAFF',
  username: '',
  password: '',
  workStart: '11:00',
  workEnd: '20:00',
  managingClients: [],
};

export default function UsersPage() {
  const { user, toast, confirm } = useApp();
  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);

  // Temporary: include Owner and Super Admin so a proper Owner account can be created; remove later if needed.
  const creatable = [
    ['OWNER', 'Owner'],
    ['SUPER_ADMIN', 'Super Admin'],
    ['ADMIN', 'Admin'],
    ['TEAM_LEADER', 'Team leader'],
    ['STAFF', 'Staff'],
  ];

  const load = () => {
    api.get('/api/v1/users?limit=100').then((response) => setRows(response.data.data || [])).catch((error) => toast(messageFrom(error), 'error'));
  };

  useEffect(() => {
    load();
    api.get('/api/v1/meta').then((response) => setClients(response.data.data.leadRoles || [])).catch(() => {});
  }, []);

  const canSetLogin = (row) => user && RANK[user.role] > RANK[row.role];

  const toggleClient = (key) => {
    setForm((current) => {
      const selected = current.managingClients || [];
      return {
        ...current,
        managingClients: selected.includes(key)
          ? selected.filter((item) => item !== key)
          : [...selected, key],
      };
    });
  };

  const clientLabels = (keys = []) => {
    if (!keys.length) return '—';
    return keys.map((key) => clients.find((item) => item.key === key)?.label || key).join(', ');
  };

  const create = async (event) => {
    event.preventDefault();
    try {
      await api.post('/api/v1/users', {
        username: form.username.trim(),
        password: form.password,
        role: form.role,
        workStart: form.workStart,
        workEnd: form.workEnd,
        managingClients: form.managingClients || [],
      });
      toast('User created. They can sign in with this user ID and password.');
      setOpen(false);
      setForm(emptyForm);
      load();
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  const saveLogin = async (event) => {
    event.preventDefault();
    try {
      const body = {
        username: form.username.trim(),
        workStart: form.workStart,
        workEnd: form.workEnd,
        managingClients: form.managingClients || [],
      };
      if (form.password) body.password = form.password;
      await api.patch(`/api/v1/users/${editing.id || editing._id}`, body);
      toast('Login updated');
      setEditing(null);
      load();
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  const deactivate = async (row) => {
    const ok = await confirm({ title: 'Deactivate user', message: `${row.username} will no longer be able to sign in.`, danger: true, confirmLabel: 'Deactivate' });
    if (!ok) return;
    try {
      await api.post(`/api/v1/users/${row.id || row._id}/deactivate`);
      toast('User deactivated');
      load();
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  const clientPicker = (
    <Field label="Managing clients" full>
      <div className="client-pick" role="group" aria-label="Managing clients">
        {clients.length ? clients.map((client) => (
          <label key={client.key} className="check-row">
            <input
              type="checkbox"
              checked={(form.managingClients || []).includes(client.key)}
              onChange={() => toggleClient(client.key)}
            />
            <span>{client.label}</span>
          </label>
        )) : <span className="muted">No client types in Preset yet</span>}
      </div>
      <p className="muted" style={{ marginTop: 6 }}>From Preset → Managing clients. Select one or more.</p>
    </Field>
  );

  return (
    <Page
      title="User Management"
      subtitle="Create logins for Owner, Super Admin, Admin, Team leader and Staff."
      actions={<button className="btn" type="button" onClick={() => { setForm(emptyForm); setOpen(true); }}>Create user</button>}
    >
      <DataTable
        rows={rows}
        empty="No users yet"
        columns={[
          { key: 'username', label: 'User ID' },
          { key: 'role', label: 'Role', render: (row) => ROLE_LABEL[row.role] || row.role },
          { key: 'clients', label: 'Managing clients', render: (row) => clientLabels(row.managingClients) },
          { key: 'hours', label: 'Working time', render: (row) => row.workStart && row.workEnd ? `${row.workStart}–${row.workEnd}` : '—' },
          { key: 'status', label: 'Status', render: (row) => <Badge tone={row.isActive ? 'success' : 'danger'}>{row.isActive ? 'Active' : 'Inactive'}</Badge> },
          { key: 'action', label: '', render: (row) => canSetLogin(row) ? (
            <div className="actions">
              <button
                className="btn secondary"
                type="button"
                onClick={() => {
                  setEditing(row);
                  setForm({
                    role: row.role,
                    username: row.username,
                    password: '',
                    workStart: row.workStart || '11:00',
                    workEnd: row.workEnd || '20:00',
                    managingClients: row.managingClients || [],
                  });
                }}
              >
                Set login
              </button>
              {row.isActive && <button className="btn secondary" type="button" onClick={() => deactivate(row)}>Deactivate</button>}
            </div>
          ) : null },
        ]}
      />
      {open && (
        <Modal title="Create user" onClose={() => setOpen(false)}>
          <form className="form-grid" onSubmit={create}>
            <Field label="Role">
              <select aria-label="Role" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
                {creatable.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Field label="User ID"><input aria-label="User ID" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} autoComplete="off" required /></Field>
            <Field label="Password" full><input aria-label="Password" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="new-password" minLength={7} required /></Field>
            {clientPicker}
            <Field label="Work starts"><input aria-label="Work starts" type="time" step="60" value={form.workStart} onChange={(event) => setForm({ ...form, workStart: event.target.value })} required /></Field>
            <Field label="Work ends"><input aria-label="Work ends" type="time" step="60" value={form.workEnd} onChange={(event) => setForm({ ...form, workEnd: event.target.value })} required /></Field>
            <p className="full muted">This user ID and password are what they type on the sign-in screen.</p>
            <div className="full"><button className="btn" type="submit">Create user</button></div>
          </form>
        </Modal>
      )}
      {editing && (
        <Modal title={`Set login · ${ROLE_LABEL[editing.role] || editing.role}`} onClose={() => setEditing(null)}>
          <form className="form-grid" onSubmit={saveLogin}>
            <Field label="User ID"><input aria-label="User ID" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required /></Field>
            <Field label="New password" full><input aria-label="New password" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Leave blank to keep the current password" minLength={form.password ? 7 : undefined} /></Field>
            {clientPicker}
            <Field label="Work starts"><input aria-label="Work starts" type="time" step="60" value={form.workStart} onChange={(event) => setForm({ ...form, workStart: event.target.value })} required /></Field>
            <Field label="Work ends"><input aria-label="Work ends" type="time" step="60" value={form.workEnd} onChange={(event) => setForm({ ...form, workEnd: event.target.value })} required /></Field>
            <div className="full"><button className="btn" type="submit">Save login</button></div>
          </form>
        </Modal>
      )}
    </Page>
  );
}
