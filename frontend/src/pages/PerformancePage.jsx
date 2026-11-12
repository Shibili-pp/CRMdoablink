import { useEffect, useState } from 'react';
import api from '../api/client';
import { money, Page } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function laterKey(days) {
  const now = new Date();
  now.setDate(now.getDate() + days);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function formatActual(unit, value) {
  if (unit === 'money') return money(value);
  if (unit === 'minutes') return `${value} min`;
  if (unit === 'percent') return `${value}%`;
  return value;
}

export default function PerformancePage() {
  const { can, toast } = useApp();
  const [tab, setTab] = useState('targets');
  const [group, setGroup] = useState('kpi');
  const [focus, setFocus] = useState('all');
  const [catalog, setCatalog] = useState([]);
  const [targets, setTargets] = useState([]);
  const [summary, setSummary] = useState(null);
  const [deals, setDeals] = useState([]);
  const [payments, setPayments] = useState([]);
  const [form, setForm] = useState({ name: 'Total calls', type: 'daily_calls', assigneeType: 'staff', value: 20, period: 'daily', startDate: todayKey(), endDate: laterKey(30), staff: '' });
  const [staff, setStaff] = useState([]);
  const choices = catalog.filter((item) => item.group === group && !item.legacy);

  const load = () => {
    api.get('/api/v1/targets').then((response) => setTargets(response.data.data)).catch(() => {});
    if (can('revenue.view')) {
      api.get('/api/v1/revenue/summary').then((response) => setSummary(response.data.data)).catch(() => {});
      api.get('/api/v1/revenue').then((response) => setDeals(response.data.data)).catch(() => {});
      api.get('/api/v1/payments').then((response) => setPayments(response.data.data)).catch(() => {});
    }
    if (can('staff.view')) api.get('/api/v1/users?limit=100').then((response) => setStaff(response.data.data)).catch(() => {});
  };
  useEffect(() => { load(); api.get('/api/v1/meta').then((response) => setCatalog(response.data.data.targetTypes || [])).catch(() => {}); }, []);

  const chooseGroup = (next) => {
    const options = catalog.filter((item) => item.group === next && !item.legacy);
    const first = options[0];
    setGroup(next);
    if (first) setForm((current) => ({ ...current, type: first.key, name: first.label, period: first.period || current.period }));
  };

  const chooseType = (key) => {
    const selected = choices.find((item) => item.key === key);
    setForm((current) => ({ ...current, type: key, name: selected?.label || current.name, period: selected?.period || current.period }));
  };

  const createTarget = async (event) => {
    event.preventDefault();
    try {
      await api.post('/api/v1/targets', { ...form, value: Number(form.value), staff: form.staff || undefined });
      toast('Target saved');
      load();
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  const pay = async (opportunityId) => {
    const amount = Number(window.prompt('Payment amount'));
    if (!amount) return;
    try {
      await api.post('/api/v1/payments', { opportunityId, amount, method: 'upi' });
      toast('Payment recorded separately from expected revenue');
      load();
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  return (
    <Page title="Targets and revenue" subtitle="Set a KPI for calling activity or a KRA for results. Expected pipeline, confirmed deals and collected payments stay separate." actions={
      <>
        <button className={`btn ${tab === 'targets' ? '' : 'secondary'}`} type="button" onClick={() => setTab('targets')}>Targets</button>
        <button className={`btn ${tab === 'revenue' ? '' : 'secondary'}`} type="button" onClick={() => setTab('revenue')}>Revenue</button>
      </>
    }>
      {tab === 'targets' && <>
        {can('targets.manage') && <form className="filters" onSubmit={createTarget}>
          <div className="filters" role="group" aria-label="Target kind">
            <button className={`btn ${group === 'kpi' ? '' : 'secondary'}`} type="button" onClick={() => chooseGroup('kpi')}>Set KPI</button>
            <button className={`btn ${group === 'kra' ? '' : 'secondary'}`} type="button" onClick={() => chooseGroup('kra')}>Set KRA</button>
          </div>
          <input placeholder="Target name" aria-label="Target name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          <select aria-label="KPI or KRA" value={form.type} onChange={(event) => chooseType(event.target.value)}>
            {choices.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
          <input type="number" min="0" placeholder="Goal" aria-label="Goal" value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} required />
          <select aria-label="Period" value={form.period} onChange={(event) => setForm({ ...form, period: event.target.value })}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          <input type="date" aria-label="Start date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} required />
          <input type="date" aria-label="End date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} required />
          <select aria-label="Staff" value={form.staff} onChange={(event) => setForm({ ...form, staff: event.target.value })}><option value="">Staff</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
          <button className="btn" type="submit">{group === 'kra' ? 'Set KRA' : 'Set KPI'}</button>
        </form>}
        <div className="filters" role="group" aria-label="Show targets">
          {[['all', 'All'], ['kpi', 'KPI'], ['kra', 'KRA']].map(([key, label]) => (
            <button key={key} className={`btn ${focus === key ? '' : 'secondary'}`} type="button" onClick={() => setFocus(key)}>{label}</button>
          ))}
        </div>
        {targets.filter((target) => focus === 'all' || target.group === focus).map((target) => (
          <article key={target._id} className="card" style={{ marginBottom: 10 }}>
            <strong>{target.name}</strong>
            <div className="muted">{target.group === 'kra' ? 'KRA' : 'KPI'} · {target.label || target.type} · {target.period}</div>
            <div className="muted">{formatActual(target.unit, target.progress.actual)} / {formatActual(target.unit, target.progress.goal)} · {target.progress.percentage}% · {formatActual(target.unit, target.progress.pending)} pending · {target.progress.remainingDays} days left</div>
            <div style={{ height: 8, background: '#eef2f6', borderRadius: 99, marginTop: 8 }}><div style={{ width: `${Math.min(100, target.progress.percentage)}%`, height: '100%', background: '#FE893C', borderRadius: 99 }} /></div>
          </article>
        ))}
        {!targets.filter((target) => focus === 'all' || target.group === focus).length && <p className="muted">No {focus === 'kra' ? 'KRA' : focus === 'kpi' ? 'KPI' : ''} targets yet.</p>}
      </>}
      {tab === 'revenue' && summary && <>
        <div className="grid stats">
          {[['Expected pipeline', summary.expectedPipeline], ['Weighted pipeline', summary.weightedPipeline], ['Confirmed', summary.confirmed], ['Collected', summary.collected], ['Pending collection', summary.pendingCollection], ['Lost', summary.lost]].map(([label, value]) => (
            <article key={label} className="card"><div className="stat-label">{label}</div><div className="stat-value">{money(value)}</div></article>
          ))}
        </div>
        <p className="muted" style={{ margin: '10px 0' }}>{summary.note} Lead-stated expected, kept separate: {money(summary.leadStatedExpected)}.</p>
        {deals.map((deal) => (
          <article key={deal._id} className="card" style={{ marginBottom: 8 }}>
            <strong>{deal.lead?.leadCode} {deal.title}</strong>
            <div>Expected {money(deal.expectedRevenue)} · Probability {deal.probability}% · Weighted {money(deal.weighted)} · Collected {money(deal.collectedAmount)} · {deal.status}</div>
            {can('revenue.manage') && deal.status !== 'lost' && <button className="btn secondary" type="button" onClick={() => pay(deal._id)}>Record payment</button>}
          </article>
        ))}
        <h3 style={{ marginTop: 12 }}>Collection history</h3>
        {payments.map((payment) => <p key={payment._id}>{new Date(payment.paidAt).toLocaleDateString()} · {money(payment.amount)} · {payment.method} · {payment.transactionRef}</p>)}
      </>}
    </Page>
  );
}
