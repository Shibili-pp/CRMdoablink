import { useEffect, useMemo, useState } from 'react';

export function Page({ title, subtitle, actions, children }) {
  return (
    <section>
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="actions">{actions}</div>
      </header>
      {children}
    </section>
  );
}

export function Badge({ children, tone = '' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export const LEAD_STATUS_COLORS = {
  fresh: { bg: '#dbeafe', fg: '#1e40af' },
  not_contacted: { bg: '#e2e8f0', fg: '#334155' },
  contacted: { bg: '#cffafe', fg: '#0e7490' },
  connected: { bg: '#ccfbf1', fg: '#0f766e' },
  interested: { bg: '#fef3c7', fg: '#b45309' },
  positive: { bg: '#dcfce7', fg: '#15803d' },
  demo_booked: { bg: '#ede9fe', fg: '#6d28d9' },
  demo_completed: { bg: '#fae8ff', fg: '#a21caf' },
  proposal_sent: { bg: '#e0e7ff', fg: '#3730a3' },
  payment_pending: { bg: '#ffedd5', fg: '#c2410c' },
  payment_received: { bg: '#d1fae5', fg: '#047857' },
  onboarding_pending: { bg: '#e0f2fe', fg: '#0369a1' },
  onboarded: { bg: '#bbf7d0', fg: '#166534' },
  follow_up_required: { bg: '#fef9c3', fg: '#a16207' },
  not_interested: { bg: '#ffe4e6', fg: '#be123c' },
  disqualified: { bg: '#f5f5f4', fg: '#57534e' },
  lost: { bg: '#fee2e2', fg: '#b91c1c' },
};

const LEAD_STATUS_LABELS = {
  fresh: 'Fresh',
  not_contacted: 'Not Contacted',
  contacted: 'Contacted',
  connected: 'Connected',
  interested: 'Interested',
  positive: 'Positive',
  demo_booked: 'Demo Booked',
  demo_completed: 'Demo Completed',
  proposal_sent: 'Proposal Sent',
  payment_pending: 'Payment Pending',
  payment_received: 'Payment Received',
  onboarding_pending: 'Onboarding Pending',
  onboarded: 'Onboarded',
  follow_up_required: 'Follow-up Required',
  not_interested: 'Not Interested',
  disqualified: 'Disqualified',
  lost: 'Lost',
};

export function StatusBadge({ status, label }) {
  const color = LEAD_STATUS_COLORS[status] || { bg: '#eef2f7', fg: '#334155' };
  const text = label || LEAD_STATUS_LABELS[status] || String(status || '—').replaceAll('_', ' ');
  return <span className="badge" data-status={status} style={{ background: color.bg, color: color.fg }}>{text}</span>;
}

export function Empty({ title, message }) {
  return <div className="empty card"><h3>{title}</h3><p>{message}</p></div>;
}

export function SkeletonRows() {
  return <div className="card">{[1, 2, 3, 4].map((row) => <div key={row} className="skeleton" style={{ margin: '12px 0' }} />)}</div>;
}

export function Modal({ title, onClose, children }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="page-head"><h2>{title}</h2><button className="btn ghost" type="button" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, full }) {
  return <label className={`field ${full ? 'full' : ''}`}><span>{label}</span>{children}</label>;
}

export function SearchableSelect({ label, value, onChange, options, placeholder = 'Select' }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => String(option.value) === String(value));
  const filtered = useMemo(() => options.filter((option) => option.label.toLowerCase().includes(query.toLowerCase())), [options, query]);
  return (
    <label className="field">
      {label && <span>{label}</span>}
      <input
        value={open ? query : (selected?.label || '')}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onChange={(event) => setQuery(event.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="card select-menu">
          {filtered.map((option) => (
            <button key={option.value || 'blank'} type="button" className="btn ghost" style={{ display: 'block', width: '100%' }} onMouseDown={() => onChange(option.value)}>
              {option.label}
            </button>
          ))}
          {!filtered.length && <div className="muted">No matches</div>}
        </div>
      )}
    </label>
  );
}

export function DataTable({ columns, rows, loading, empty, onRow, page, pages, onPage }) {
  if (loading) return <SkeletonRows />;
  if (!rows?.length) return <Empty title={empty || 'Nothing here yet'} message="Try another filter or add a record." />;
  return (
    <div className="card">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>{columns.map((column) => <th key={column.key} className={column.hide ? 'col-hide' : ''}>{column.label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id || row._id} className={onRow ? 'clickable' : ''} onClick={() => onRow && onRow(row)}>
                {columns.map((column) => (
                  <td key={column.key} data-label={column.label} className={column.hide ? 'col-hide' : ''}>
                    <span className="cell-value">{column.render ? column.render(row) : row[column.key]}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="pager">
          <span>Page {page} of {pages}</span>
          <div className="actions">
            <button className="btn secondary" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
            <button className="btn secondary" type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function useQueryList(path, params) {
  const [state, setState] = useState({ rows: [], meta: { page: 1, pages: 1 }, loading: true });
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value != null)).toString();
  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true }));
    import('../api/client').then(({ default: api }) => api.get(`${path}?${query}`).then((response) => {
      if (!active) return;
      setState({ rows: response.data.data || [], meta: response.data.meta || { page: 1, pages: 1 }, loading: false });
    }).catch(() => active && setState({ rows: [], meta: { page: 1, pages: 1 }, loading: false })));
    return () => { active = false; };
  }, [path, query]);
  return state;
}

export function day(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

export function money(value) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value) || 0);
}

export function duration(seconds) {
  const minutes = Math.round((Number(seconds) || 0) / 60);
  return `${Math.max(0, minutes)} min`;
}

export function formatValue(card) {
  if (card.format === 'currency') return money(card.value);
  if (card.format === 'duration') return duration(card.value);
  if (card.format === 'percent') return `${card.value}%`;
  return card.value ?? 0;
}
