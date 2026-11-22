import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MessageCircle, Phone } from 'lucide-react';
import api from '../api/client';
import DemoScheduleModal from '../components/DemoScheduleModal';
import { Field, FirmBadge, PriorityBadge, Page, SkeletonRows, StatusBadge, LEAD_STATUS_COLORS, day, duration, money } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

export default function LeadDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can, toast, confirm } = useApp();
  const [lead, setLead] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [people, setPeople] = useState(null);
  const [statuses, setStatuses] = useState([]);
  const [leadRoles, setLeadRoles] = useState([]);
  const [leadFirms, setLeadFirms] = useState([]);
  const [note, setNote] = useState('');
  const [calls, setCalls] = useState([]);
  const [callSheet, setCallSheet] = useState(null);
  const [callResult, setCallResult] = useState({ status: 'connected', minutes: 1 });
  const [recordingFile, setRecordingFile] = useState(null);
  const [recordingConsent, setRecordingConsent] = useState(false);
  const [nextAction, setNextAction] = useState({ title: '', date: '', time: '' });
  const [editingContact, setEditingContact] = useState(false);
  const [contact, setContact] = useState({ name: '', phone: '' });
  const [expectedCash, setExpectedCash] = useState('');
  const [savingCash, setSavingCash] = useState(false);
  const [demoPrompt, setDemoPrompt] = useState(null);

  const load = () => {
    Promise.all([
      api.get(`/api/v1/leads/${id}`),
      api.get(`/api/v1/leads/${id}/timeline?limit=50`),
      api.get(`/api/v1/leads/${id}/involvement`),
      api.get('/api/v1/meta'),
      api.get(`/api/v1/calls?leadId=${id}&limit=20`),
    ]).then(([leadRes, timeRes, peopleRes, metaRes, callRes]) => {
      setLead(leadRes.data.data);
      setTimeline(timeRes.data.data);
      setPeople(peopleRes.data.data);
      setStatuses(metaRes.data.data.statuses);
      setLeadRoles(metaRes.data.data.leadRoles || []);
      setLeadFirms(metaRes.data.data.leadFirms || []);
      setCalls(callRes.data.data || []);
      setNextAction({ title: leadRes.data.data.nextActionTitle || '', date: '', time: '' });
      setExpectedCash(String(leadRes.data.data.expectedRevenue ?? 0));
    }).catch((error) => toast(messageFrom(error), 'error'));
  };

  useEffect(() => { load(); }, [id]);

  if (!lead) return <SkeletonRows />;

  const applyStatus = async (status, extra = {}) => {
    let lostReason = extra.lostReason ?? lead.lostReason ?? '';
    if (['lost', 'not_interested', 'disqualified'].includes(status) && !lostReason) {
      lostReason = window.prompt('Why was this lead lost?', lead.lostReason || '') || '';
      if (!lostReason) return false;
    }
    const add = !lead.inPipeline && await confirm({
      title: 'Add to pipeline?',
      message: 'Add this lead to the pipeline?',
      confirmLabel: 'Yes',
      cancelLabel: 'No',
    });
    try {
      await api.patch(`/api/v1/leads/${id}`, { status, lostReason, ...extra });
      if (add) await api.post(`/api/v1/leads/${id}/pipeline`);
      toast(status === 'demo_booked'
        ? 'Demo booked · added to Follow-ups'
        : (add ? 'Status updated and added to pipeline' : 'Status updated'));
      load();
      return true;
    } catch (error) {
      toast(messageFrom(error), 'error');
      return false;
    }
  };

  const changeStatus = async (status) => {
    if (status === lead.status) return;
    if (status === 'demo_booked') {
      setDemoPrompt({ status });
      return;
    }
    await applyStatus(status);
  };

  const addNote = async (event) => {
    event.preventDefault();
    try {
      await api.post(`/api/v1/leads/${id}/notes`, { text: note });
      setNote('');
      toast('Note added');
      load();
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  const saveExpectedCash = async (event) => {
    event.preventDefault();
    const amount = Number(expectedCash);
    if (!Number.isFinite(amount) || amount < 0) {
      toast('Enter a valid expected cash amount', 'error');
      return;
    }
    setSavingCash(true);
    try {
      await api.patch(`/api/v1/leads/${id}`, { expectedRevenue: amount });
      toast('Expected cash updated');
      load();
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setSavingCash(false);
    }
  };

  const addFollowUp = async (event) => {
    event.preventDefault();
    try {
      await api.post('/api/v1/followups', { leadId: id, title: nextAction.title, date: nextAction.date, time: nextAction.time || '09:00', priority: 'medium' });
      toast('Follow-up created');
      load();
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  const addPipeline = async () => {
    if (lead.inPipeline) {
      navigate('/pipeline');
      return;
    }
    try {
      await api.post(`/api/v1/leads/${id}/pipeline`);
      toast('Added to pipeline');
      load();
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  const archive = async () => {
    const ok = await confirm({ title: 'Archive lead', message: 'The lead will be hidden. History stays in the audit log.', danger: true, confirmLabel: 'Archive' });
    if (!ok) return;
    try {
      await api.delete(`/api/v1/leads/${id}`);
      toast('Lead archived');
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  const startPhoneCall = () => {
    setCallSheet({ startedAt: new Date().toISOString(), savedId: '' });
  };

  const savePhoneCall = async () => {
    try {
      const response = await api.post('/api/v1/calls/manual', {
        phone: lead.phone || lead.phoneNormalized,
        contactName: lead.name,
        callType: callResult.status === 'missed' ? 'missed' : 'outgoing',
        status: callResult.status,
        startedAt: callSheet.startedAt,
        durationSeconds: Math.round(Number(callResult.minutes || 0) * 60),
        leadId: lead.id || lead._id,
        provider: 'web',
        notes: 'Logged from the phone website. The SIM call log was not read.',
      });
      setCallSheet({ ...callSheet, savedId: response.data.data.id || response.data.data._id });
      toast('Call result saved');
      load();
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  const uploadRecording = async () => {
    if (!recordingConsent) {
      toast('Confirm that this recording may be stored', 'error');
      return;
    }
    if (!recordingFile) {
      toast('Choose the recording file saved on this phone', 'error');
      return;
    }
    const body = new FormData();
    body.append('file', recordingFile);
    body.append('consentAccepted', 'true');
    body.append('phone', lead.phoneNormalized || '');
    body.append('leadId', lead.id || lead._id || '');
    if (callSheet?.savedId) body.append('callId', callSheet.savedId);
    try {
      const response = await api.post('/api/v1/call-recordings/upload', body);
      toast(response.data.message);
      setRecordingFile(null);
      setRecordingConsent(false);
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  const startEditContact = () => {
    setContact({ name: lead.name || '', phone: lead.phone || '' });
    setEditingContact(true);
  };

  const saveContact = async (event) => {
    event.preventDefault();
    try {
      await api.patch(`/api/v1/leads/${id}`, { name: contact.name.trim(), phone: contact.phone.trim() });
      toast('Name and mobile number updated');
      setEditingContact(false);
      load();
    } catch (error) { toast(messageFrom(error), 'error'); }
  };

  const statusLabel = statuses.find((item) => item.key === lead.status)?.label;
  const handlers = people?.handlers || [];
  const formatStamp = (value) => (value
    ? new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—');

  return (
    <Page title={lead.name} subtitle={lead.leadCode} actions={can('leads.delete') && <button className="btn danger" type="button" onClick={archive}>Archive</button>}>
      <article className="card lead-sheet">
        <div className="lead-sheet-top">
          <StatusBadge status={lead.status} label={statusLabel} />
          <PriorityBadge priority={lead.priority} />
          <FirmBadge firm={lead.firm} firms={leadFirms} />
          <span className="muted">{[lead.source, lead.district].filter(Boolean).join(' · ') || 'No source'}</span>
        </div>
        <p className="lead-phone">{lead.phoneDisplay || 'No phone'}</p>
        {can('leads.edit') && !editingContact && (
          <button className="btn secondary" type="button" onClick={startEditContact}>Edit name and number</button>
        )}
        {can('leads.edit') && editingContact && (
          <form className="form-grid" onSubmit={saveContact}>
            <Field label="Name"><input aria-label="Lead name" value={contact.name} onChange={(event) => setContact({ ...contact, name: event.target.value })} required minLength={2} /></Field>
            <Field label="Mobile number"><input aria-label="Mobile number" value={contact.phone} onChange={(event) => setContact({ ...contact, phone: event.target.value })} required /></Field>
            <div className="full actions">
              <button className="btn" type="submit">Save</button>
              <button className="btn secondary" type="button" onClick={() => setEditingContact(false)}>Cancel</button>
            </div>
          </form>
        )}
        <p className="muted">On the phone, use the browser menu and choose Install app or Add to Home screen. Installing this website does not give Android call-log permission.</p>
        {lead.phoneNormalized && (
          <div className="lead-contact-actions">
            <a className="btn" href={`tel:+${lead.phoneNormalized}`} onClick={startPhoneCall}><Phone size={16} /> Call</a>
            <a className="btn secondary" href={`https://wa.me/${lead.phoneNormalized}`} target="_blank" rel="noreferrer"><MessageCircle size={16} /> WhatsApp</a>
          </div>
        )}
        {callSheet && can('calls.manual') && (
          <div className="phone-log">
            <p>The phone dialer is open. This website cannot read Android’s call log, even after you install it. When you come back, save the result.</p>
            <label className="field"><span>Result</span>
              <select aria-label="Call result" value={callResult.status} onChange={(event) => setCallResult({ ...callResult, status: event.target.value })}>
                <option value="connected">Connected</option>
                <option value="no_answer">No answer</option>
                <option value="missed">Missed</option>
                <option value="rejected">Rejected</option>
                <option value="busy">Busy</option>
              </select>
            </label>
            <label className="field"><span>Minutes</span>
              <input type="number" min="0" aria-label="Call minutes" value={callResult.minutes} onChange={(event) => setCallResult({ ...callResult, minutes: event.target.value })} />
            </label>
            {!callSheet.savedId && <button className="btn" type="button" onClick={savePhoneCall}>Save call result</button>}
            <label className="check-row">
              <input type="checkbox" checked={recordingConsent} onChange={(event) => setRecordingConsent(event.target.checked)} />
              <span>I am uploading a recording this phone already saved, and the other person was told the call may be recorded.</span>
            </label>
            <input aria-label="Recording file" type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.amr,.3gp" onChange={(event) => setRecordingFile(event.target.files?.[0] || null)} />
            <button className="btn secondary" type="button" onClick={uploadRecording}>Upload recording</button>
          </div>
        )}
        {can('leads.edit') && (
          <button className="btn lead-wide lead-pipeline" type="button" onClick={addPipeline}>{lead.inPipeline ? 'Open pipeline' : 'Add to pipeline'}</button>
        )}
        <dl className="lead-facts">
          <div><dt>Assigned</dt><dd>{day(lead.assignmentDate)}</dd></div>
          <div><dt>Follow-up</dt><dd>{day(lead.followUpAt)}</dd></div>
          <div><dt>Last contacted</dt><dd>{day(lead.lastContactedAt)}</dd></div>
          <div><dt>Owner</dt><dd>{lead.assignedTo?.name || 'Unassigned'}</dd></div>
          <div><dt>Client</dt><dd>{leadRoles.find((role) => role.key === lead.leadRole)?.label || '—'}</dd></div>
          <div><dt>Firm</dt><dd><FirmBadge firm={lead.firm} firms={leadFirms} /></dd></div>
          <div className="wide"><dt>Consultancy name</dt><dd>{lead.consultancyName || '—'}</dd></div>
          <div className="wide"><dt>Next action</dt><dd>{lead.nextActionTitle || 'None set'}</dd></div>
          <div className="wide"><dt>Expected</dt><dd>{money(lead.expectedRevenue)} <span className="muted">Not collected cash</span></dd></div>
          {lead.comment ? <div className="wide"><dt>Comment</dt><dd>{lead.comment}</dd></div> : null}
          {lead.remarks ? <div className="wide"><dt>Remark</dt><dd>{lead.remarks}</dd></div> : null}
        </dl>
        {lead.notes && <p className="lead-note">{lead.notes}</p>}
      </article>

      {can('leads.edit') && (
        <article className="card lead-block">
          <h3>Expected cash</h3>
          <p className="muted">Expected amount for this lead. This is not collected payment.</p>
          <form onSubmit={saveExpectedCash}>
            <Field label="Expected cash (₹)">
              <input
                type="number"
                min="0"
                step="1"
                aria-label="Expected cash"
                value={expectedCash}
                onChange={(event) => setExpectedCash(event.target.value)}
                required
              />
            </Field>
            <button className="btn lead-wide" type="submit" disabled={savingCash}>
              {savingCash ? 'Saving…' : 'Save expected cash'}
            </button>
          </form>
        </article>
      )}

      {can('leads.edit') && (
        <article className="card lead-block">
          <h3>Status</h3>
          <Field label="Update status">
            <select aria-label="Update status" value={lead.status} onChange={(event) => changeStatus(event.target.value)}>
              {statuses.map((status) => {
                const color = LEAD_STATUS_COLORS[status.key] || { bg: '#eef2f7', fg: '#334155' };
                return <option key={status.key} value={status.key} style={{ background: color.bg, color: color.fg }}>{status.label}</option>;
              })}
            </select>
          </Field>
        </article>
      )}

      {can('followups.manage') && (
        <article className="card lead-block">
          <h3>Follow-up</h3>
          <form onSubmit={addFollowUp}>
            <Field label="Next action"><input aria-label="Next action" value={nextAction.title} onChange={(event) => setNextAction({ ...nextAction, title: event.target.value })} required /></Field>
            <div className="lead-when">
              <Field label="Date"><input aria-label="Follow-up date" type="date" value={nextAction.date} onChange={(event) => setNextAction({ ...nextAction, date: event.target.value })} required /></Field>
              <Field label="Time"><input aria-label="Follow-up time" type="time" value={nextAction.time} onChange={(event) => setNextAction({ ...nextAction, time: event.target.value })} /></Field>
            </div>
            <button className="btn lead-wide" type="submit">Save follow-up</button>
          </form>
        </article>
      )}

      {can('leads.edit') && (
        <article className="card lead-block">
          <h3>Note</h3>
          <form onSubmit={addNote}>
            <Field label="Add a note"><textarea aria-label="Add a note" value={note} onChange={(event) => setNote(event.target.value)} required /></Field>
            <button className="btn secondary lead-wide" type="submit">Add note</button>
          </form>
        </article>
      )}

      <article className="card lead-block">
        <h3>Calls</h3>
        {calls.map((call) => (
          <article key={call._id}>
            <strong>{call.callType} · {call.status}</strong>
            <div className="muted">{call.staff?.name || 'Employee'} · {new Date(call.startedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · {duration(call.durationSeconds)} · {call.dataSource}</div>
            {call.notes && <p>{call.notes}</p>}
          </article>
        ))}
        {!calls.length && <p className="muted">No stored calls match this lead’s phone yet. A shared number is left unmatched until someone chooses the lead.</p>}
      </article>

      <article className="card lead-block">
        <h3>History</h3>
        <section className="staff-journey" aria-label="Staff who handled this lead">
          <h4>Staff who handled this lead{handlers.length ? ` (${handlers.length})` : ''}</h4>
          <p className="muted">From first assign to the latest owner — previous staff, dates, and what they did.</p>
          {!handlers.length && <p className="muted">No assignment history yet.</p>}
          <ol className="staff-journey-list">
            {handlers.map((row) => (
              <li key={`${row.order}-${row.staff?.id}-${row.assignedAt}`} className={row.current ? 'current' : ''}>
                <div className="staff-journey-head">
                  <strong>{row.order}. {row.staff?.name || 'Staff'}</strong>
                  {row.current ? <span className="badge priority-high">Current</span> : null}
                </div>
                <div className="muted">
                  Assigned {formatStamp(row.assignedAt)}
                  {row.endedAt ? ` · Left ${formatStamp(row.endedAt)}` : ' · Still holding'}
                </div>
                {row.fromStaff?.name && (
                  <div className="muted">Previous staff: {row.fromStaff.name}</div>
                )}
                {(row.reason || row.mode) && (
                  <div className="muted">
                    {[row.mode ? String(row.mode).replaceAll('_', ' ') : '', row.reason].filter(Boolean).join(' · ')}
                  </div>
                )}
                <p className="staff-journey-summary">{row.summary}</p>
                {!!row.actions?.length && (
                  <ul className="staff-journey-actions">
                    {row.actions.slice(0, 8).map((action) => (
                      <li key={action.id}>
                        <span>{action.label}</span>
                        <span className="muted">{formatStamp(action.at)}</span>
                      </li>
                    ))}
                    {row.actions.length > 8 && (
                      <li className="muted">+{row.actions.length - 8} more actions</li>
                    )}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </section>
        <h4 className="timeline-heading">Timeline</h4>
        <div className="timeline">
          {timeline.map((item) => (
            <article key={item._id}>
              <strong>{String(item.type || '').replaceAll('_', ' ')}</strong>
              <div className="muted">{item.actorName || 'System'} · {formatStamp(item.at)}</div>
              <p>{item.description}</p>
            </article>
          ))}
          {!timeline.length && <p className="muted">No timeline events yet.</p>}
        </div>
      </article>

      {demoPrompt && (
        <DemoScheduleModal
          leadName={lead.name}
          onCancel={() => setDemoPrompt(null)}
          onConfirm={async ({ demoDate, demoTime }) => {
            const ok = await applyStatus('demo_booked', { demoDate, demoTime });
            if (ok) setDemoPrompt(null);
          }}
        />
      )}
    </Page>
  );
}
