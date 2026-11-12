import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { Empty, LEAD_STATUS_COLORS, Page, SkeletonRows } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

function localPhone(row) {
  const digits = String(row.phoneNormalized || '').replace(/\D/g, '');
  if (digits.startsWith('91') && digits.length === 12) return digits.slice(2);
  return row.phoneDisplay || digits || '—';
}

function PipelineRow({ row, statuses, toast, onSaved }) {
  const [form, setForm] = useState({
    consultancyName: row.consultancyName || '',
    proposedPlan: row.proposedPlan ?? '',
    remarks: row.remarks || '',
    status: row.status,
  });

  useEffect(() => {
    setForm({
      consultancyName: row.consultancyName || '',
      proposedPlan: row.proposedPlan ?? '',
      remarks: row.remarks || '',
      status: row.status,
    });
  }, [row._id, row.consultancyName, row.proposedPlan, row.remarks, row.status]);

  const save = async (patch) => {
    try {
      await api.patch(`/api/v1/leads/${row._id}/pipeline`, patch);
      onSaved();
    } catch (error) {
      toast(messageFrom(error), 'error');
    }
  };

  const changeStatus = async (status) => {
    let lostReason = '';
    if (['lost', 'not_interested', 'disqualified'].includes(status)) {
      lostReason = window.prompt('Why was this lead lost?', row.lostReason || '') || '';
      if (!lostReason) return;
    }
    setForm({ ...form, status });
    await save({ status, lostReason });
  };

  const color = LEAD_STATUS_COLORS[form.status] || { bg: '#fff', fg: '#334155' };

  return (
    <tr>
      <td data-label="SL NO"><span className="cell-value">{row.sl}</span></td>
      <td data-label="NAME"><span className="cell-value"><Link to={`/leads/${row._id}`}>{row.name}</Link></span></td>
      <td data-label="PHONE NUMBER"><span className="cell-value">{localPhone(row)}</span></td>
      <td data-label="CONSULTANCY NAME">
        <span className="cell-value">
          <input aria-label={`Consultancy for ${row.name}`} value={form.consultancyName} onChange={(event) => setForm({ ...form, consultancyName: event.target.value })} onBlur={(event) => { if (event.target.value !== (row.consultancyName || '')) save({ consultancyName: event.target.value }); }} />
        </span>
      </td>
      <td data-label="STATUS">
        <span className="cell-value">
          <select aria-label={`Status for ${row.name}`} value={form.status} style={{ background: color.bg, color: color.fg }} onChange={(event) => changeStatus(event.target.value)}>
            {statuses.map((status) => {
              const tone = LEAD_STATUS_COLORS[status.key] || { bg: '#fff', fg: '#334155' };
              return <option key={status.key} value={status.key} style={{ background: tone.bg, color: tone.fg }}>{status.label}</option>;
            })}
          </select>
        </span>
      </td>
      <td data-label="PROPOSED PLAN">
        <span className="cell-value">
          <input aria-label={`Proposed plan for ${row.name}`} type="number" min="0" value={form.proposedPlan} onChange={(event) => setForm({ ...form, proposedPlan: event.target.value })} onBlur={(event) => { if (String(event.target.value) !== String(row.proposedPlan ?? '')) save({ proposedPlan: Number(event.target.value) || 0 }); }} />
        </span>
      </td>
      <td data-label="REMARKS">
        <span className="cell-value">
          <textarea className="pipeline-remark" aria-label={`Remarks for ${row.name}`} value={form.remarks} onChange={(event) => setForm({ ...form, remarks: event.target.value })} onBlur={(event) => { if (event.target.value !== (row.remarks || '')) save({ remarks: event.target.value }); }} />
        </span>
      </td>
    </tr>
  );
}

export default function PipelinePage() {
  const { toast } = useApp();
  const [reports, setReports] = useState([]);
  const [people, setPeople] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [staff, setStaff] = useState('');
  const [loading, setLoading] = useState(true);

  const load = (staffId = staff, quiet = false) => {
    if (!quiet) setLoading(true);
    const params = new URLSearchParams();
    if (staffId) params.set('staff', staffId);
    Promise.all([
      api.get(`/api/v1/pipeline?${params}`),
      api.get('/api/v1/meta'),
    ]).then(([reportRes, metaRes]) => {
      setReports(reportRes.data.data || []);
      setPeople(reportRes.data.meta?.staff || []);
      setStatuses(metaRes.data.data.statuses || []);
    }).catch((error) => toast(messageFrom(error), 'error')).finally(() => setLoading(false));
  };

  useEffect(() => { load(staff); }, [staff]);

  return (
    <Page title="Pipeline" subtitle="Leads marked for the pipeline, grouped by the staff member who owns them.">
      {people.length > 0 && (
        <div className="filters" role="group" aria-label="Pipeline view">
          <button className={`btn ${staff ? 'secondary' : ''}`} type="button" onClick={() => setStaff('')}>All</button>
          <label className="field"><span>Staff</span>
            <select aria-label="Staff view" value={staff} onChange={(event) => setStaff(event.target.value)}>
              <option value="">All staff</option>
              {people.map((person) => <option key={person._id} value={person._id}>{person.name}</option>)}
            </select>
          </label>
        </div>
      )}
      {loading && <SkeletonRows />}
      {!loading && !reports.length && <Empty title="No pipeline leads yet" message="Open a lead and choose Add to pipeline. It will show here in that staff member's report." />}
      {!loading && reports.map((report) => (
        <article className="card pipeline-report" key={report.staffId || report.title}>
          <div className="pipeline-banner">{report.title}</div>
          {!report.rows.length && <p className="muted" style={{ padding: '14px 16px' }}>No pipeline leads for this staff member.</p>}
          {report.rows.length > 0 && (
            <div className="table-wrap">
              <table className="pipeline-table">
                <thead>
                  <tr>
                    <th>SL NO</th>
                    <th>NAME</th>
                    <th>PHONE NUMBER</th>
                    <th>CONSULTANCY NAME</th>
                    <th>STATUS</th>
                    <th>PROPOSED PLAN</th>
                    <th>REMARKS</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => (
                    <PipelineRow key={row._id} row={row} statuses={statuses} toast={toast} onSaved={() => load(staff, true)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      ))}
    </Page>
  );
}
