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

export default function UsersPage() {
  const { user, toast, confirm } = useApp();
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ role: 'STAFF', username: '', password: '' });

  const creatable = [
    ['STAFF', 'Staff'],
    ['TEAM_LEADER', 'Team leader'],
    ['ADMIN', 'Admin'],
    ...(user?.role === 'OWNER' ? [['SUPER_ADMIN', 'Super Admin']] : []),
  ];

  const load = () => {
    api.get('/api/v1/users?limit=100').then((response) => setRows(response.data.data || [])).catch((error) => toast(messageFrom(error), 'error'));
  };

  useEffect(() => { load(); }, []);

  const canSetLogin = (row) => user && RANK[user.role] > RANK[row.role];

  const create = async (event) => {
    event.preventDefault();
    try {
      await api.post('/api/v1/users', { username: form.username.trim(), password: form.password, role: form.role });
      toast('User created. They can sign in with this user ID and password.');
      setOpen(false);
      setForm({ role: 'STAFF', username: '', password: '' });
      load();
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  const saveLogin = async (event) => {
    event.preventDefault();
    try {
      const body = { username: form.username.trim() };
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

  return (
    <Page
      title="User Management"
      subtitle={user?.role === 'OWNER' ? 'Create logins and set the Super Admin user ID and password.' : 'Create logins for Admin, Team leader and Staff.'}
      actions={<button className="btn" type="button" onClick={() => { setForm({ role: 'STAFF', username: '', password: '' }); setOpen(true); }}>Create user</button>}
    >
      <DataTable
        rows={rows}
        empty="No users yet"
        columns={[
          { key: 'username', label: 'User ID' },
          { key: 'role', label: 'Role', render: (row) => ROLE_LABEL[row.role] || row.role },
          { key: 'status', label: 'Status', render: (row) => <Badge tone={row.isActive ? 'success' : 'danger'}>{row.isActive ? 'Active' : 'Inactive'}</Badge> },
          { key: 'action', label: '', render: (row) => canSetLogin(row) ? (
            <div className="actions">
              <button className="btn secondary" type="button" onClick={() => { setEditing(row); setForm({ role: row.role, username: row.username, password: '' }); }}>Set login</button>
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
            <div className="full"><button className="btn" type="submit">Save login</button></div>
          </form>
        </Modal>
      )}
    </Page>
  );
}
