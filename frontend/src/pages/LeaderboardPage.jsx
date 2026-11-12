import { useEffect, useState } from 'react';
import api from '../api/client';
import { DataTable, Page } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

export default function LeaderboardPage() {
  const { toast } = useApp();
  const [period, setPeriod] = useState('monthly');
  const [view, setView] = useState('individual');
  const [rows, setRows] = useState([]);
  const [note, setNote] = useState('');

  useEffect(() => {
    const params = new URLSearchParams({ period, view: view === 'team' ? 'team' : '' });
    api.get(`/api/v1/leaderboard?${params}`).then((response) => {
      setRows(response.data.data);
      setNote(response.data.meta?.note || '');
    }).catch((error) => toast(messageFrom(error), 'error'));
  }, [period, view]);

  return (
    <Page title="Leaderboard" subtitle={note} actions={
      <>
        {['daily', 'weekly', 'monthly'].map((item) => <button key={item} className={`btn ${period === item ? '' : 'secondary'}`} type="button" onClick={() => setPeriod(item)}>{item}</button>)}
        <button className="btn secondary" type="button" onClick={() => setView(view === 'team' ? 'individual' : 'team')}>{view === 'team' ? 'Show people' : 'Show teams'}</button>
      </>
    }>
      <DataTable rows={rows} empty="No ranking for this period" columns={view === 'team' ? [
        { key: 'rank', label: 'Rank' },
        { key: 'team', label: 'Team' },
        { key: 'members', label: 'Members' },
        { key: 'successfulSales', label: 'Sales' },
        { key: 'score', label: 'Score' },
      ] : [
        { key: 'rank', label: 'Rank' },
        { key: 'name', label: 'Name' },
        { key: 'team', label: 'Team' },
        { key: 'sales', label: 'Sales', render: (row) => row.metrics.successfulSales },
        { key: 'collected', label: 'Collected', render: (row) => row.metrics.revenueCollected },
        { key: 'connected', label: 'Connected calls', render: (row) => row.metrics.connectedCalls },
        { key: 'score', label: 'Score' },
      ]} />
    </Page>
  );
}
