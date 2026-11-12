import { useEffect, useState } from 'react';
import api from '../api/client';
import { Badge, DataTable, Page } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

export default function AssignmentsPage() {
  const { toast, can } = useApp();
  const [tab, setTab] = useState('history');
  const [history, setHistory] = useState([]);
  const [swaps, setSwaps] = useState([]);
  const [workload, setWorkload] = useState([]);

  const load = () => {
    api.get('/api/v1/lead-assignments?limit=50').then((response) => setHistory(response.data.data)).catch((error) => toast(messageFrom(error), 'error'));
    api.get('/api/v1/lead-swaps?status=pending').then((response) => setSwaps(response.data.data)).catch(() => {});
    api.get('/api/v1/lead-assignments/workload').then((response) => setWorkload(response.data.data)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const review = async (id, status) => {
    try {
      await api.post(`/api/v1/lead-swaps/${id}/${status === 'approved' ? 'approve' : 'reject'}`, { reviewNote: status });
      toast(`Swap ${status}`);
      load();
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  return (
    <Page title="Lead assignment" subtitle="History, workload and swap approvals." actions={
      <div className="actions">
        <button className={`btn ${tab === 'history' ? '' : 'secondary'}`} type="button" onClick={() => setTab('history')}>History</button>
        <button className={`btn ${tab === 'workload' ? '' : 'secondary'}`} type="button" onClick={() => setTab('workload')}>Workload</button>
        <button className={`btn ${tab === 'swaps' ? '' : 'secondary'}`} type="button" onClick={() => setTab('swaps')}>Swaps</button>
      </div>
    }>
      {tab === 'workload' && <DataTable rows={workload} empty="No staff in view" columns={[
        { key: 'name', label: 'Staff' },
        { key: 'openLeads', label: 'Open leads' },
        { key: 'freshLeads', label: 'Fresh' },
        { key: 'remaining', label: 'Capacity left' },
        { key: 'available', label: 'Available', render: (row) => <Badge tone={row.available ? 'success' : 'warning'}>{row.available ? 'Yes' : 'Leave or inactive'}</Badge> },
      ]} />}
      {tab === 'swaps' && (
        <div className="card">
          {swaps.map((swap) => (
            <div key={swap._id} className="cluster" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
              <div><strong>{swap.lead?.leadCode}</strong> {swap.lead?.name}<div className="muted">{swap.reason}</div></div>
              {can('leads.assign') && <div className="actions"><button className="btn" type="button" onClick={() => review(swap._id, 'approved')}>Approve</button><button className="btn secondary" type="button" onClick={() => review(swap._id, 'rejected')}>Reject</button></div>}
            </div>
          ))}
          {!swaps.length && <p className="muted">No pending swap requests.</p>}
        </div>
      )}
      {tab === 'history' && <DataTable rows={history} empty="No assignments yet" columns={[
        { key: 'when', label: 'When', render: (row) => new Date(row.createdAt).toLocaleString() },
        { key: 'lead', label: 'Lead', render: (row) => row.lead?.leadCode },
        { key: 'from', label: 'From', render: (row) => row.fromStaff?.name || 'Bucket' },
        { key: 'to', label: 'To', render: (row) => row.toStaff?.name || 'Bucket' },
        { key: 'mode', label: 'Mode' },
        { key: 'reason', label: 'Reason' },
      ]} />}
    </Page>
  );
}
