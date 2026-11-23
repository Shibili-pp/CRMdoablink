import { Fragment, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone } from 'lucide-react';
import api from '../api/client';
import DemoCancelModal, { DEMO_CANCEL_STATUSES, DEMO_OVER_STATUSES } from '../components/DemoCancelModal';
import DemoScheduleModal, { DEMO_GATE_STATUSES } from '../components/DemoScheduleModal';
import FollowUpDateModal, { FOLLOWUP_GATE_STATUSES } from '../components/FollowUpDateModal';
import LostReasonModal, { BUCKET_PARK_STATUSES } from '../components/LostReasonModal';
import { Empty, Field, FirmBadge, LEAD_STATUS_COLORS, Modal, Page, SkeletonRows, money } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

function localPhone(row) {
  const digits = String(row.phoneNormalized || '').replace(/\D/g, '');
  if (digits.startsWith('91') && digits.length === 12) return digits.slice(2);
  return row.phoneDisplay || digits || '—';
}

function PipelineRow({ row, statuses, leadRoles, leadFirms, toast, onSaved, onClaim }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    consultancyName: row.consultancyName || '',
    proposedPlan: row.proposedPlan ?? '',
    remarks: row.remarks || '',
    status: row.status,
  });
  const [demoPrompt, setDemoPrompt] = useState(null);
  const [demoOutcomePrompt, setDemoOutcomePrompt] = useState(null);
  const [followUpPrompt, setFollowUpPrompt] = useState(null);
  const [parkPrompt, setParkPrompt] = useState(null);

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
      return true;
    } catch (error) {
      toast(messageFrom(error), 'error');
      return false;
    }
  };

  const changeStatus = async (status) => {
    if (status === 'payment_received') {
      onClaim(row);
      return;
    }
    if (DEMO_GATE_STATUSES.includes(status)) {
      setDemoPrompt({ status });
      return;
    }
    if (DEMO_OVER_STATUSES.includes(status) || DEMO_CANCEL_STATUSES.includes(status)) {
      setDemoOutcomePrompt({ status });
      return;
    }
    if (FOLLOWUP_GATE_STATUSES.includes(status)) {
      setFollowUpPrompt({ status });
      return;
    }
    if (BUCKET_PARK_STATUSES.includes(status)) {
      setParkPrompt({ status });
      return;
    }
    let lostReason = '';
    if (status === 'lost') {
      lostReason = window.prompt('Why was this lead lost?', row.lostReason || '') || '';
      if (!lostReason) return;
    }
    setForm({ ...form, status });
    await save({ status, lostReason });
  };

  const color = LEAD_STATUS_COLORS[form.status] || { bg: '#fff', fg: '#334155' };
  const keep = (event) => event.stopPropagation();

  return (
    <Fragment>
    <tr>
      <td className="pipeline-hide" data-label="SL NO"><span className="cell-value">{row.sl}</span></td>
      <td data-label="Name"><span className="cell-value"><button className="btn ghost" type="button" onClick={() => navigate(`/leads/${row._id}`)}>{row.name}</button></span></td>
      <td data-label="Client"><span className="cell-value">{leadRoles.find((role) => role.key === row.leadRole)?.label || '—'}</span></td>
      <td data-label="Firm"><span className="cell-value"><FirmBadge firm={row.firm} firms={leadFirms} /></span></td>
      <td className="pipeline-hide" data-label="PHONE NUMBER"><span className="cell-value">{localPhone(row)}</span></td>
      <td className="pipeline-hide" data-label="CONSULTANCY NAME">
        <span className="cell-value">
          <input aria-label={`Consultancy for ${row.name}`} value={form.consultancyName} onClick={keep} onChange={(event) => setForm({ ...form, consultancyName: event.target.value })} onBlur={(event) => { if (event.target.value !== (row.consultancyName || '')) save({ consultancyName: event.target.value }); }} />
        </span>
      </td>
      <td data-label="Status">
        <span className="cell-value">
          <select aria-label={`Status for ${row.name}`} value={form.status} style={{ background: color.bg, color: color.fg }} onClick={keep} onChange={(event) => changeStatus(event.target.value)}>
            {statuses.map((status) => {
              const tone = LEAD_STATUS_COLORS[status.key] || { bg: '#fff', fg: '#334155' };
              return <option key={status.key} value={status.key} style={{ background: tone.bg, color: tone.fg }}>{status.label}</option>;
            })}
          </select>
        </span>
      </td>
      <td className="pipeline-hide" data-label="PROPOSED PLAN">
        <span className="cell-value">
          <input aria-label={`Proposed plan for ${row.name}`} type="number" min="0" value={form.proposedPlan} onClick={keep} onChange={(event) => setForm({ ...form, proposedPlan: event.target.value })} onBlur={(event) => { if (String(event.target.value) !== String(row.proposedPlan ?? '')) save({ proposedPlan: Number(event.target.value) || 0 }); }} />
        </span>
      </td>
      <td className="pipeline-hide" data-label="REMARKS">
        <span className="cell-value">
          <textarea className="pipeline-remark" aria-label={`Remarks for ${row.name}`} value={form.remarks} onClick={keep} onChange={(event) => setForm({ ...form, remarks: event.target.value })} onBlur={(event) => { if (event.target.value !== (row.remarks || '')) save({ remarks: event.target.value }); }} />
        </span>
      </td>
      <td data-label="Call" className="lead-call">
        <span className="cell-value">
          {row.phoneNormalized ? <a className="btn call-btn" href={`tel:+${row.phoneNormalized}`} aria-label={`Call ${row.name}`} onClick={keep}><Phone size={16} /> Call</a> : '—'}
        </span>
      </td>
    </tr>
    {demoPrompt && (
      <DemoScheduleModal
        leadName={row.name}
        statusLabel={statuses.find((item) => item.key === demoPrompt.status)?.label || demoPrompt.status}
        onCancel={() => setDemoPrompt(null)}
        onConfirm={async ({ demoDate, demoTime }) => {
          const ok = await save({ status: demoPrompt.status, demoDate, demoTime });
          if (ok) {
            setForm({ ...form, status: demoPrompt.status });
            setDemoPrompt(null);
            toast('Upcoming demo set · added to Follow-ups');
          }
        }}
      />
    )}
    {demoOutcomePrompt && (
      <DemoCancelModal
        leadName={row.name}
        mode={DEMO_CANCEL_STATUSES.includes(demoOutcomePrompt.status) ? 'cancel' : 'over'}
        onCancel={() => setDemoOutcomePrompt(null)}
        onConfirm={async (payload) => {
          const ok = await save({ status: demoOutcomePrompt.status, ...payload });
          if (ok) {
            setForm({ ...form, status: demoOutcomePrompt.status });
            setDemoOutcomePrompt(null);
            toast(DEMO_CANCEL_STATUSES.includes(demoOutcomePrompt.status)
              ? 'Demo cancelled · cancelled demos + follow-up added'
              : 'Demo marked over · completed demos + follow-up added');
          }
        }}
      />
    )}
    {followUpPrompt && (
      <FollowUpDateModal
        leadName={row.name}
        statusLabel={statuses.find((item) => item.key === followUpPrompt.status)?.label || followUpPrompt.status}
        onCancel={() => setFollowUpPrompt(null)}
        onConfirm={async ({ followUpDate, followUpTime }) => {
          const ok = await save({
            status: followUpPrompt.status,
            followUpDate,
            followUpTime,
          });
          if (ok) {
            setForm({ ...form, status: followUpPrompt.status });
            setFollowUpPrompt(null);
            toast('Status updated · follow-up added');
          }
        }}
      />
    )}
    {parkPrompt && (
      <LostReasonModal
        leadName={row.name}
        statusLabel={statuses.find((item) => item.key === parkPrompt.status)?.label || parkPrompt.status}
        onCancel={() => setParkPrompt(null)}
        onConfirm={async ({ lostReason }) => {
          const ok = await save({ status: parkPrompt.status, lostReason });
          if (ok) {
            setParkPrompt(null);
            toast(`Moved to bucket · ${statuses.find((item) => item.key === parkPrompt.status)?.label || parkPrompt.status}`);
            onSaved();
          }
        }}
      />
    )}
    </Fragment>
  );
}

function PaymentTable({ rows, leadRoles, note, actions }) {
  if (!rows?.length) return null;
  return (
    <div className="table-wrap">
      {note && <p className="muted pipeline-note">{note}</p>}
      <table className="pipeline-table">
        <thead>
          <tr>
            <th>SL NO</th>
            <th>NAME</th>
            <th>ROLE</th>
            <th>PHONE NUMBER</th>
            <th>AMOUNT</th>
            {actions && <th> </th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row._id}>
              <td data-label="SL NO"><span className="cell-value">{row.sl}</span></td>
              <td data-label="Name"><span className="cell-value">{row.name}</span></td>
              <td data-label="Role"><span className="cell-value">{leadRoles.find((role) => role.key === row.leadRole)?.label || '—'}</span></td>
              <td data-label="PHONE NUMBER"><span className="cell-value">{localPhone(row)}</span></td>
              <td data-label="Amount"><span className="cell-value">{money(row.paymentAmount)}</span></td>
              {actions && <td data-label="Confirm"><span className="cell-value pipeline-actions btn-row">{actions(row)}</span></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PipelinePage() {
  const { user, toast } = useApp();
  const approver = user?.role !== 'STAFF';
  const [reports, setReports] = useState([]);
  const [people, setPeople] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [leadRoles, setLeadRoles] = useState([]);
  const [leadFirms, setLeadFirms] = useState([]);
  const [staff, setStaff] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [firmFilter, setFirmFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [claim, setClaim] = useState(null);
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  const load = (staffId = staff, role = roleFilter, firm = firmFilter, quiet = false) => {
    if (!quiet) setLoading(true);
    const params = new URLSearchParams();
    if (staffId) params.set('staff', staffId);
    if (role) params.set('leadRole', role);
    if (firm) params.set('firm', firm);
    Promise.all([
      api.get(`/api/v1/pipeline?${params}`),
      api.get('/api/v1/meta'),
    ]).then(([reportRes, metaRes]) => {
      setReports(reportRes.data.data || []);
      setPeople(reportRes.data.meta?.staff || []);
      setStatuses(metaRes.data.data.statuses || []);
      setLeadRoles(metaRes.data.data.leadRoles || []);
      setLeadFirms(metaRes.data.data.leadFirms || []);
    }).catch((error) => toast(messageFrom(error), 'error')).finally(() => setLoading(false));
  };

  useEffect(() => { load(staff, roleFilter, firmFilter); }, [staff, roleFilter, firmFilter]);

  const openClaim = (row) => {
    setClaim(row);
    setAmount(row.paymentAmount ? String(row.paymentAmount) : '');
  };

  const submitClaim = async (event) => {
    event.preventDefault();
    if (!claim) return;
    setSaving(true);
    try {
      const response = await api.patch(`/api/v1/leads/${claim._id}/pipeline`, { paymentAction: 'submit', paymentAmount: Number(amount) || 0 });
      toast(response.data.message || 'Payment saved');
      setClaim(null);
      load(staff, roleFilter, firmFilter, true);
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  const decide = async (row, paymentAction) => {
    try {
      const response = await api.patch(`/api/v1/leads/${row._id}/pipeline`, { paymentAction });
      toast(response.data.message || 'Updated');
      load(staff, roleFilter, firmFilter, true);
    } catch (error) {
      toast(messageFrom(error), 'error');
    }
  };

  return (
    <Page title="Pipeline" subtitle="Each staff member has their own pipeline. Payment received leaves this list until a team leader or above confirms the amount.">
      <div className="toolbar" role="group" aria-label="Pipeline view">
        {people.length > 0 && <button className={`btn ${staff ? 'secondary' : ''}`} type="button" onClick={() => setStaff('')}>All</button>}
        <label className="field"><span>Client</span>
          <select aria-label="Client" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            <option value="">All clients</option>
            {leadRoles.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}
          </select>
        </label>
        <label className="field"><span>Firm</span>
          <select aria-label="Firm" value={firmFilter} onChange={(event) => setFirmFilter(event.target.value)}>
            <option value="">All firms</option>
            {leadFirms.map((firm) => <option key={firm.key} value={firm.key}>{firm.label}</option>)}
          </select>
        </label>
        {people.length > 0 && (
          <label className="field"><span>Staff</span>
            <select aria-label="Staff view" value={staff} onChange={(event) => setStaff(event.target.value)}>
              <option value="">All staff</option>
              {people.map((person) => <option key={person._id} value={person._id}>{person.name}</option>)}
            </select>
          </label>
        )}
      </div>
      {loading && <SkeletonRows />}
      {!loading && !reports.length && <Empty title="No pipeline leads yet" message="Open a lead and choose Add to pipeline. It will show here in that staff member's report." />}
      {!loading && reports.map((report) => (
        <article className="card pipeline-report" key={report.staffId || report.title}>
          <div className="pipeline-banner">
            <strong>{report.staffName}</strong>
            <span>{report.rows.length} in pipeline · {(report.received || []).length} payment received</span>
          </div>
          <section className="pipeline-block">
            <h3>Pipeline</h3>
            {!report.rows.length && <p className="muted pipeline-note">No open pipeline leads.</p>}
            {report.rows.length > 0 && (
              <div className="table-wrap">
                <table className="pipeline-table">
                  <thead>
                    <tr>
                      <th>SL NO</th>
                      <th>NAME</th>
                      <th>CLIENT</th>
                      <th>FIRM</th>
                      <th>PHONE NUMBER</th>
                      <th>CONSULTANCY NAME</th>
                      <th>STATUS</th>
                      <th>PROPOSED PLAN</th>
                      <th>REMARKS</th>
                      <th>CALL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((row) => (
                      <PipelineRow key={row._id} row={row} statuses={statuses} leadRoles={leadRoles} leadFirms={leadFirms} toast={toast} onSaved={() => load(staff, roleFilter, firmFilter, true)} onClaim={openClaim} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {(report.confirm || []).length > 0 && (
            <section className="pipeline-block pipeline-confirm">
              <h3>Payment received</h3>
              <PaymentTable
                rows={report.confirm}
                leadRoles={leadRoles}
                note="This staff member entered a payment. Confirm it to move the lead into Payment received."
                actions={(row) => (
                  <>
                    <button className="btn" type="button" onClick={() => decide(row, 'approve')}>Receive</button>
                    <button className="btn secondary" type="button" onClick={() => decide(row, 'return')}>Not receive</button>
                  </>
                )}
              />
            </section>
          )}
          {(report.pending || []).length > 0 && (
            <section className="pipeline-block pipeline-pending">
              <h3>Pending payment</h3>
              <PaymentTable
                rows={report.pending}
                leadRoles={leadRoles}
                note={approver ? 'Returned to this staff member. It stays out of their open pipeline.' : 'Waiting for a team leader or above. A returned payment stays here until you enter it again.'}
                actions={approver ? undefined : (row) => (
                  <button className="btn secondary" type="button" onClick={() => openClaim(row)}>Enter amount</button>
                )}
              />
            </section>
          )}
          {(report.received || []).length > 0 && (
            <section className="pipeline-block pipeline-received">
              <h3>Payment received</h3>
              <PaymentTable rows={report.received} leadRoles={leadRoles} note="Confirmed payments. These leads are no longer in the open pipeline." />
            </section>
          )}
        </article>
      ))}
      {claim && (
        <Modal title={`Payment received · ${claim.name}`} onClose={() => setClaim(null)}>
          <p className="muted">{approver ? 'Enter the amount. Saving moves this lead into Payment received.' : 'Enter the amount. A team leader or above has to confirm it before it counts as received.'}</p>
          <form className="form-grid" onSubmit={submitClaim}>
            <Field label="Amount (₹)">
              <input aria-label="Payment amount" type="number" min="1" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} required />
            </Field>
            <div className="full actions">
              <button className="btn" type="submit" disabled={saving}>Save</button>
              <button className="btn secondary" type="button" onClick={() => setClaim(null)}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </Page>
  );
}
