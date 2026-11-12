import { useEffect, useState } from 'react';
import api from '../api/client';
import { DataTable, Page } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

export default function AuditPage() {
  const { toast } = useApp();
  const [rows, setRows] = useState([]);
  const [moduleName, setModuleName] = useState('');
  useEffect(() => {
    api.get(`/api/v1/audit-logs?module=${moduleName}`).then((response) => setRows(response.data.data)).catch((error) => toast(messageFrom(error), 'error'));
  }, [moduleName]);
  return (
    <Page title="Audit logs" subtitle="Sign-ins, lead changes, payments, exports and recording access." actions={<input placeholder="Module" value={moduleName} onChange={(event) => setModuleName(event.target.value)} />}>
      <DataTable rows={rows} empty="No audit events" columns={[
        { key: 'at', label: 'When', render: (row) => new Date(row.at).toLocaleString() },
        { key: 'username', label: 'User' },
        { key: 'action', label: 'Action' },
        { key: 'module', label: 'Module' },
        { key: 'ip', label: 'IP' },
      ]} />
    </Page>
  );
}
