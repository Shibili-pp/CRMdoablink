import { useEffect, useState } from 'react';
import api from '../api/client';
import { DataTable, Page } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

export default function BucketPage() {
  const { toast } = useApp();
  const [rows, setRows] = useState([]);
  const [staff, setStaff] = useState([]);
  const [selected, setSelected] = useState([]);
  const [staffId, setStaffId] = useState('');
  const [mode, setMode] = useState('round_robin');

  const load = () => {
    api.get('/api/v1/leads?view=bucket&limit=100').then((response) => setRows(response.data.data)).catch((error) => toast(messageFrom(error), 'error'));
    api.get('/api/v1/lead-assignments/workload').then((response) => setStaff(response.data.data.filter((person) => person.available))).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const toggle = (id) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  const assign = async () => {
    if (!selected.length || !staffId) return toast('Choose leads and a person', 'error');
    try {
      const response = await api.post('/api/v1/lead-assignments', { leadIds: selected, staffId, reason: 'Assigned from the bucket' });
      toast(`Assigned ${response.data.data.assigned}`);
      setSelected([]);
      load();
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  const distribute = async () => {
    if (!selected.length) return;
    try {
      const response = await api.post('/api/v1/lead-assignments/distribute', { leadIds: selected, mode, reason: `Distributed by ${mode}` });
      toast(`Distributed ${response.data.data.assigned}`);
      setSelected([]);
      load();
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  return (
    <Page title="Lead bucket" subtitle="Unassigned leads only. Distribution skips staff who are on leave or at capacity." actions={
      <>
        <select value={staffId} onChange={(event) => setStaffId(event.target.value)}>
          <option value="">Assign selected to…</option>
          {staff.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.remaining} open slots</option>)}
        </select>
        <button className="btn" type="button" onClick={assign}>Assign</button>
        <select value={mode} onChange={(event) => setMode(event.target.value)}>
          <option value="round_robin">Round robin</option>
          <option value="equal_workload">Equal workload</option>
          <option value="capacity">Capacity</option>
        </select>
        <button className="btn secondary" type="button" onClick={distribute}>Distribute selected</button>
      </>
    }>
      <DataTable rows={rows} empty="The bucket is empty" columns={[
        { key: 'pick', label: '', render: (row) => <input type="checkbox" checked={selected.includes(row._id)} onChange={() => toggle(row._id)} onClick={(event) => event.stopPropagation()} /> },
        { key: 'leadCode', label: 'Lead ID' },
        { key: 'name', label: 'Name' },
        { key: 'phoneDisplay', label: 'Phone' },
        { key: 'source', label: 'Source' },
        { key: 'priority', label: 'Priority' },
        { key: 'district', label: 'District' },
      ]} />
    </Page>
  );
}
