import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api/client';
import { Badge, Field, Page, SkeletonRows, StatusBadge, LEAD_STATUS_COLORS, day } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

export default function LeadDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can, toast, confirm } = useApp();
  const [lead, setLead] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [people, setPeople] = useState(null);
  const [statuses, setStatuses] = useState([]);
  const [note, setNote] = useState('');
  const [nextAction, setNextAction] = useState({ title: '', date: '', time: '' });

  const load = () => {
    Promise.all([
      api.get(`/api/v1/leads/${id}`),
      api.get(`/api/v1/leads/${id}/timeline?limit=50`),
      api.get(`/api/v1/leads/${id}/involvement`),
      api.get('/api/v1/meta'),
    ]).then(([leadRes, timeRes, peopleRes, metaRes]) => {
      setLead(leadRes.data.data);
      setTimeline(timeRes.data.data);
      setPeople(peopleRes.data.data);
      setStatuses(metaRes.data.data.statuses);
      setNextAction({ title: leadRes.data.data.nextActionTitle || '', date: '', time: '' });
    }).catch((error) => toast(messageFrom(error), 'error'));
  };

  useEffect(() => { load(); }, [id]);

  if (!lead) return <SkeletonRows />;

  const changeStatus = async (status) => {
    let lostReason = lead.lostReason || '';
    if (['lost', 'not_interested', 'disqualified'].includes(status)) {
      lostReason = window.prompt('Why was this lead lost?', lostReason) || '';
      if (!lostReason) return;
    }
    try {
      await api.patch(`/api/v1/leads/${id}`, { status, lostReason });
      toast('Status updated');
      load();
    } catch (error) { toast(messageFrom(error), 'error'); }
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

  return (
    <Page title={`${lead.leadCode} · ${lead.name}`} subtitle={`${lead.phoneDisplay} · ${lead.source} · ${lead.district || 'District not set'}`} actions={can('leads.delete') && <button className="btn danger" type="button" onClick={archive}>Archive</button>}>
      <div className="grid two">
        <article className="card">
          <div className="cluster"><StatusBadge status={lead.status} label={statuses.find((item) => item.key === lead.status)?.label} /><Badge>{lead.priority}</Badge><span className="muted">{lead.ageDays} days old</span></div>
          {can('leads.edit') && <button className="btn secondary" type="button" style={{ marginTop: 12 }} onClick={addPipeline}>{lead.inPipeline ? 'Open pipeline' : 'Add to pipeline'}</button>}
          <p style={{ marginTop: 12 }}><strong>Assigned day:</strong> {day(lead.assignmentDate)}</p>
          <p><strong>Last contacted:</strong> {day(lead.lastContactedAt)}</p>
          <p style={{ marginTop: 12 }}><strong>Next action:</strong> {lead.nextActionTitle || 'None set'}</p>
          <p className="muted">Expected revenue on the lead: {lead.expectedRevenue || 0}. This is not collected cash.</p>
          <p style={{ marginTop: 8 }}>{lead.notes || 'No note yet.'}</p>
          {can('leads.edit') && (
            <div style={{ marginTop: 16 }}>
              <Field label="Update status">
                <select value={lead.status} onChange={(event) => changeStatus(event.target.value)}>
                  {statuses.map((status) => {
                    const color = LEAD_STATUS_COLORS[status.key] || { bg: '#eef2f7', fg: '#334155' };
                    return <option key={status.key} value={status.key} style={{ background: color.bg, color: color.fg }}>{status.label}</option>;
                  })}
                </select>
              </Field>
            </div>
          )}
          {can('followups.manage') && (
            <form className="form-grid" style={{ marginTop: 16 }} onSubmit={addFollowUp}>
              <Field label="Next action" full><input value={nextAction.title} onChange={(event) => setNextAction({ ...nextAction, title: event.target.value })} required /></Field>
              <Field label="Date"><input type="date" value={nextAction.date} onChange={(event) => setNextAction({ ...nextAction, date: event.target.value })} required /></Field>
              <Field label="Time"><input type="time" value={nextAction.time} onChange={(event) => setNextAction({ ...nextAction, time: event.target.value })} /></Field>
              <div className="full"><button className="btn" type="submit">Save follow-up</button></div>
            </form>
          )}
          {can('leads.edit') && (
            <form onSubmit={addNote} style={{ marginTop: 16 }}>
              <Field label="Add a note"><textarea value={note} onChange={(event) => setNote(event.target.value)} required /></Field>
              <button className="btn secondary" style={{ marginTop: 8 }} type="submit">Add note</button>
            </form>
          )}
        </article>
        <article className="card">
          <h3>People involved</h3>
          <p><strong>Current owner:</strong> {lead.assignedTo?.name || 'Unassigned'}</p>
          <p className="muted">Previous owners stay on the record.</p>
          {(people?.previousOwners || []).map((row, index) => <p key={index}>{row.staff?.name || 'Previous owner'} · {row.reason || row.mode}</p>)}
          <h3 style={{ marginTop: 16 }}>Timeline</h3>
          <div className="timeline">
            {timeline.map((item) => (
              <article key={item._id}>
                <strong>{item.type.replaceAll('_', ' ')}</strong>
                <div className="muted">{item.actorName || 'System'} · {new Date(item.at).toLocaleString()}</div>
                <p>{item.description}</p>
              </article>
            ))}
          </div>
        </article>
      </div>
    </Page>
  );
}
