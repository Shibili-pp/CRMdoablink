import { useEffect, useState } from 'react';
import api from '../api/client';
import { Badge, DataTable, Field, Modal, Page } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

const empty = { name: '', username: '', email: '', password: '1234567', role: 'STAFF', phone: '' };

export default function StaffPage() {
  const { can, toast, confirm } = useApp();
  const [rows, setRows] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [leave, setLeave] = useState({ startDate: '', endDate: '', type: 'casual', reason: '' });

  const load = () => {
    api.get('/api/v1/users?limit=100').then((response) => setRows(response.data.data)).catch((error) => toast(messageFrom(error), 'error'));
    api.get('/api/v1/leaves').then((response) => setLeaves(response.data.data)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const save = async (event) => {
    event.preventDefault();
    try {
      await api.post('/api/v1/users', form);
      toast('Staff account created');
      setOpen(false);
      load();
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  const deactivate = async (id) => {
    const ok = await confirm({ title: 'Deactivate staff', message: 'They will no longer be able to sign in.', danger: true, confirmLabel: 'Deactivate' });
    if (!ok) return;
    try { await api.post(`/api/v1/users/${id}/deactivate`); toast('Staff deactivated'); load(); }
    catch (error) { toast(messageFrom(error), 'error'); }
  };

  const apply = async (event) => {
    event.preventDefault();
    try { await api.post('/api/v1/leaves', leave); toast('Leave submitted'); load(); }
    catch (error) { toast(messageFrom(error), 'error'); }
  };

  const review = async (id, status) => {
    try { await api.post(`/api/v1/leaves/${id}/review`, { status, reviewNote: status }); toast(`Leave ${status}`); load(); }
    catch (error) { toast(messageFrom(error), 'error'); }
  };

  return (
    <Page title="Staff" subtitle="Accounts, roles and leave. People on approved leave are left out of automatic distribution." actions={can('users.manage') && <button className="btn" type="button" onClick={() => setOpen(true)}>Add staff</button>}>
      <DataTable rows={rows} empty="No staff in your view" columns={[
        { key: 'employeeId', label: 'Employee ID' },
        { key: 'name', label: 'Name' },
        { key: 'role', label: 'Role' },
        { key: 'employmentStatus', label: 'Status', render: (row) => <Badge tone={row.isActive ? 'success' : 'danger'}>{row.employmentStatus}</Badge> },
        { key: 'action', label: '', render: (row) => can('users.manage') && row.isActive ? <button className="btn secondary" type="button" onClick={() => deactivate(row.id)}>Deactivate</button> : null },
      ]} />
      <div className="grid two" style={{ marginTop: 14 }}>
        <form className="card form-grid" onSubmit={apply}>
          <h3 className="full">Apply for leave</h3>
          <Field label="From"><input type="date" value={leave.startDate} onChange={(event) => setLeave({ ...leave, startDate: event.target.value })} required /></Field>
          <Field label="To"><input type="date" value={leave.endDate} onChange={(event) => setLeave({ ...leave, endDate: event.target.value })} required /></Field>
          <Field label="Type"><select value={leave.type} onChange={(event) => setLeave({ ...leave, type: event.target.value })}><option>casual</option><option>sick</option><option>earned</option><option>unpaid</option></select></Field>
          <Field label="Reason"><input value={leave.reason} onChange={(event) => setLeave({ ...leave, reason: event.target.value })} /></Field>
          <div className="full"><button className="btn" type="submit">Submit</button></div>
        </form>
        <article className="card">
          <h3>Leave requests</h3>
          {leaves.map((item) => (
            <div key={item._id} style={{ marginTop: 8 }}>
              <strong>{item.staff?.name || 'Me'}</strong> {item.type} · {item.status}
              <div className="muted">{new Date(item.startDate).toLocaleDateString()} – {new Date(item.endDate).toLocaleDateString()}</div>
              {can('leaves.review') && item.status === 'pending' && <div className="actions"><button className="btn" type="button" onClick={() => review(item._id, 'approved')}>Approve</button><button className="btn secondary" type="button" onClick={() => review(item._id, 'rejected')}>Reject</button></div>}
            </div>
          ))}
        </article>
      </div>
      {open && <Modal title="Add staff" onClose={() => setOpen(false)}><form className="form-grid" onSubmit={save}>
        <Field label="Name"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></Field>
        <Field label="Username"><input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required /></Field>
        <Field label="Email"><input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></Field>
        <Field label="Password"><input value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required /></Field>
        <Field label="Phone"><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></Field>
        <Field label="Role"><select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}><option>STAFF</option><option>TEAM_LEADER</option><option>ADMIN</option>{can('roles.manage') && <option>SUPER_ADMIN</option>}</select></Field>
        <div className="full"><button className="btn" type="submit">Create</button></div>
      </form></Modal>}
    </Page>
  );
}
