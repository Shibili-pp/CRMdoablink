import { useEffect, useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BadgePercent, Clock3, IndianRupee, Phone, PhoneCall, Sparkles, Target, Timer, UserRound, Users, Wallet } from 'lucide-react';
import api from '../api/client';
import { formatValue, SkeletonRows } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

const STAT_ICONS = {
  leads: Users,
  fresh: Sparkles,
  assigned: Users,
  connectedLeads: PhoneCall,
  positive: Target,
  staff: UserRound,
  calls: Phone,
  connected: PhoneCall,
  talk: Timer,
  overdue: Clock3,
  unique: Phone,
  expected: IndianRupee,
  weighted: IndianRupee,
  pipeline: IndianRupee,
  confirmed: Wallet,
  collected: Wallet,
  pending: Wallet,
  conversion: BadgePercent,
};

const titles = {
  OWNER: 'Owner overview',
  SUPER_ADMIN: 'Operations overview',
  ADMIN: 'Branch performance',
  TEAM_LEADER: 'Team performance',
  STAFF: 'My day',
};

const PRESETS = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['week', 'This week'],
  ['month', 'This month'],
];

export default function DashboardPage() {
  const { toast } = useApp();
  const [preset, setPreset] = useState('today');
  const [day, setDay] = useState('');
  const [data, setData] = useState(null);
  useEffect(() => {
    const params = new URLSearchParams();
    if (preset === 'date' && day) params.set('date', day);
    else if (preset !== 'today') params.set('preset', preset);
    setData(null);
    api.get(`/api/v1/dashboards/me?${params}`).then((response) => setData(response.data.data)).catch((error) => toast(messageFrom(error), 'error'));
  }, [preset, day]);
  if (!data) return <SkeletonRows />;
  const android = data.calls?.bySource?.android_sync?.calls || 0;
  const periodLabel = data.period?.label || 'Today';
  return (
    <section>
      <div className="page-head">
        <div>
          <h1>{titles[data.role] || 'Dashboard'}</h1>
          <p>Showing {periodLabel.toLowerCase()} from the database. {android ? `${android} calls in this period are device-verified.` : 'No Android-synced calls in this period. Demo and manual calls are labeled separately.'}</p>
        </div>
      </div>
      <div className="filters" role="group" aria-label="Dashboard date">
        {PRESETS.map(([key, label]) => (
          <button key={key} className={`btn ${preset === key ? '' : 'secondary'}`} type="button" onClick={() => { setDay(''); setPreset(key); }}>{label}</button>
        ))}
        <input
          type="date"
          aria-label="Choose a day"
          value={preset === 'date' ? day : (preset === 'today' ? (data.period?.date || '') : '')}
          onChange={(event) => { setDay(event.target.value); setPreset(event.target.value ? 'date' : 'today'); }}
        />
      </div>
      <div className="grid stats">
        {data.cards.map((card) => {
          const Icon = STAT_ICONS[card.key] || Target;
          return (
            <article key={card.key} className="card stat-card">
              <div className="stat-top">
                <div className="stat-label">{card.label}</div>
                <span className="stat-icon" aria-hidden="true"><Icon size={16} /></span>
              </div>
              <div className="stat-value">{formatValue(card)}</div>
              {card.hint && <div className="muted">{card.hint}</div>}
            </article>
          );
        })}
      </div>
      <div className="grid two" style={{ marginTop: 14 }}>
        <article className="card">
          <h3>Leads by status</h3>
          <div className="chart-box">
            <ResponsiveContainer>
              <BarChart data={data.charts.statuses}>
                <XAxis dataKey="name" hide />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" fill="#002546" radius={6} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
        <article className="card">
          <h3>Calls {periodLabel.toLowerCase()} by source</h3>
          <div className="chart-box">
            <ResponsiveContainer>
              <BarChart data={data.charts.callsBySource}>
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="calls" fill="#FE893C" radius={6} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="muted">{data.note}</p>
        </article>
      </div>
      <div className="grid two" style={{ marginTop: 14 }}>
        <article className="card">
          <h3>Source performance</h3>
          {(data.tables.sourcePerformance || []).map((row) => (
            <div key={row._id} className="cluster" style={{ justifyContent: 'space-between', marginTop: 8 }}>
              <span>{row._id || 'Unknown'}</span><strong>{row.leads} leads · {row.won} won</strong>
            </div>
          ))}
        </article>
        <article className="card">
          <h3>Top performers</h3>
          {(data.tables.topPerformers || []).map((row) => (
            <div key={row.staffId} className="cluster" style={{ justifyContent: 'space-between', marginTop: 8 }}>
              <span>#{row.rank} {row.name}</span><strong>{row.score}</strong>
            </div>
          ))}
          {!data.tables.topPerformers?.length && <p className="muted">Rankings appear when staff have activity in this period.</p>}
        </article>
      </div>
    </section>
  );
}
