import { useEffect, useState } from 'react';
import api, { downloadFile } from '../api/client';
import { DataTable, Page } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

export default function ReportsPage() {
  const { toast, can } = useApp();
  const [catalog, setCatalog] = useState([]);
  const [type, setType] = useState('staff_performance');
  const [filters, setFilters] = useState({ startDate: '', endDate: '' });
  const [report, setReport] = useState(null);

  useEffect(() => { api.get('/api/v1/reports').then((response) => setCatalog(response.data.data)).catch((error) => toast(messageFrom(error), 'error')); }, []);

  const run = async () => {
    try {
      const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
      const response = await api.get(`/api/v1/reports/${type}?${params}`);
      setReport(response.data.data);
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  const exportReport = async (format) => {
    try {
      const params = new URLSearchParams({ ...filters, format });
      await downloadFile(`/api/v1/reports/${type}/export?${params}`, `${type}.${format}`);
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  return (
    <Page title="Reports and exports" subtitle="Every report reads the current database and can be exported." actions={can('reports.export') && <>
      <button className="btn secondary" type="button" onClick={() => exportReport('pdf')}>PDF</button>
      <button className="btn secondary" type="button" onClick={() => exportReport('xlsx')}>Excel</button>
      <button className="btn secondary" type="button" onClick={() => exportReport('csv')}>CSV</button>
    </>}>
      <div className="filters">
        <select value={type} onChange={(event) => setType(event.target.value)}>{catalog.map((item) => <option key={item.key} value={item.key}>{item.title}</option>)}</select>
        <input type="date" value={filters.startDate} onChange={(event) => setFilters({ ...filters, startDate: event.target.value })} />
        <input type="date" value={filters.endDate} onChange={(event) => setFilters({ ...filters, endDate: event.target.value })} />
        <button className="btn" type="button" onClick={run}>Run report</button>
      </div>
      {report && <DataTable rows={report.rows.map((row, index) => ({ ...row, id: index }))} empty="This report has no rows" columns={(report.columns || []).map((column) => ({ key: column, label: column }))} />}
    </Page>
  );
}
