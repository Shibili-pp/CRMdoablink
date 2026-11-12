import { useEffect, useState } from 'react';
import api from '../api/client';
import { Field, Page } from '../components/ui';
import { messageFrom, useApp } from '../context/AppContext';

export default function BranchesPage() {
  const { can, toast } = useApp();
  const [branches, setBranches] = useState([]);
  const [teams, setTeams] = useState([]);
  const [branch, setBranch] = useState({ name: '', code: '', city: '', state: 'Kerala' });
  const [team, setTeam] = useState({ name: '', code: '', branch: '' });

  const load = () => {
    api.get('/api/v1/branches').then((response) => setBranches(response.data.data)).catch((error) => toast(messageFrom(error), 'error'));
    api.get('/api/v1/teams').then((response) => setTeams(response.data.data)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const saveBranch = async (event) => {
    event.preventDefault();
    try { await api.post('/api/v1/branches', branch); toast('Branch created'); load(); }
    catch (error) { toast(messageFrom(error), 'error'); }
  };
  const saveTeam = async (event) => {
    event.preventDefault();
    try { await api.post('/api/v1/teams', team); toast('Team created'); load(); }
    catch (error) { toast(messageFrom(error), 'error'); }
  };

  return (
    <Page title="Branches and teams" subtitle="Owner sees every branch. Other roles stay inside the branch they are assigned to.">
      <div className="grid two">
        <article className="card">
          <h3>Branches</h3>
          {branches.map((item) => <p key={item._id}><strong>{item.name}</strong> · {item.code} · {item.city}</p>)}
          {can('branches.manage') && <form className="form-grid" onSubmit={saveBranch} style={{ marginTop: 12 }}>
            <Field label="Name"><input value={branch.name} onChange={(event) => setBranch({ ...branch, name: event.target.value })} required /></Field>
            <Field label="Code"><input value={branch.code} onChange={(event) => setBranch({ ...branch, code: event.target.value })} required /></Field>
            <Field label="City"><input value={branch.city} onChange={(event) => setBranch({ ...branch, city: event.target.value })} /></Field>
            <div className="full"><button className="btn" type="submit">Add branch</button></div>
          </form>}
        </article>
        <article className="card">
          <h3>Teams</h3>
          {teams.map((item) => <p key={item._id}><strong>{item.name}</strong> · {item.branch?.name} · leader {item.leader?.name || '—'}</p>)}
          {can('teams.manage') && <form className="form-grid" onSubmit={saveTeam} style={{ marginTop: 12 }}>
            <Field label="Name"><input value={team.name} onChange={(event) => setTeam({ ...team, name: event.target.value })} required /></Field>
            <Field label="Code"><input value={team.code} onChange={(event) => setTeam({ ...team, code: event.target.value })} required /></Field>
            <Field label="Branch" full><select value={team.branch} onChange={(event) => setTeam({ ...team, branch: event.target.value })} required><option value="">Choose</option>{branches.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></Field>
            <div className="full"><button className="btn" type="submit">Add team</button></div>
          </form>}
        </article>
      </div>
    </Page>
  );
}
