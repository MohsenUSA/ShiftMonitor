'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { devBackend } from '@/lib/backend/dev';
import type { Backend, TeamSummary } from '@/lib/backend/types';
import type { User } from '@/lib/model';
import { getPref, setPref } from '@/lib/prefs';
import { Dashboard } from './Dashboard';
import { ToastProvider } from './Toast';
import { BrandMark } from './Topbar';
import { NowProvider } from './useNow';

// The AWS backend plugs in here once it exists.
const backend: Backend = devBackend;

function Gate({ children }: { children: ReactNode }) {
  return (
    <div className="gate">
      <div className="gate-card">
        <div className="brand"><BrandMark />Shift Monitor{backend.kind === 'dev' && <span className="dev-badge">LOCAL DEV</span>}</div>
        {children}
      </div>
    </div>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: (u: User) => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { onSignedIn(await backend.signIn(email, name)); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Gate>
      <h1>Sign in</h1>
      <p className="sub">Local development sign-in — no password. Use different emails in different browsers to test as several people.</p>
      <form onSubmit={submit}>
        <label htmlFor="si-email">Email</label>
        <input id="si-email" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
        <label htmlFor="si-name">Your name <span className="lbl-hint">optional</span></label>
        <input id="si-name" type="text" autoComplete="name" value={name} onChange={e => setName(e.target.value)} />
        {error && <div className="form-error inline">{error}</div>}
        <button className="btn-primary" disabled={busy || !email.trim()}>Continue</button>
      </form>
    </Gate>
  );
}

function TeamGate({ user, teams, onPick, onSignOut, onBack }: {
  user: User; teams: TeamSummary[]; onPick: (t: TeamSummary) => void; onSignOut: () => void; onBack?: () => void;
}) {
  const [teamName, setTeamName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const act = (fn: () => Promise<TeamSummary>) => async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { onPick(await fn()); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Gate>
      <h1>{teams.length ? 'Your teams' : 'Set up your team'}</h1>
      <p className="sub">Everyone on a team sees the same schedule, live. Create a team, or join one with the code a teammate shares from the team menu.</p>
      {teams.length > 0 && (
        <div className="team-list">
          {teams.map(t => <button key={t.id} className="btn-outline" onClick={() => onPick(t)}><span>{t.name}</span><span>→</span></button>)}
        </div>
      )}
      <form onSubmit={act(() => backend.createTeam(teamName))}>
        <label htmlFor="tg-name">New team name</label>
        <input id="tg-name" type="text" placeholder="e.g. Downtown store" value={teamName} onChange={e => setTeamName(e.target.value)} />
        <button className="btn-primary" disabled={busy || !teamName.trim()}>Create team</button>
      </form>
      <div className="or">or</div>
      <form onSubmit={act(() => backend.joinTeam(code))}>
        <label htmlFor="tg-code">Join code</label>
        <input id="tg-code" type="text" placeholder="6-character code" autoComplete="off" value={code}
               style={{ textTransform: 'uppercase', fontFamily: 'var(--mono)', letterSpacing: '.08em' }}
               onChange={e => setCode(e.target.value)} />
        <button className="btn-outline" disabled={busy || code.trim().length < 6}>Join team</button>
      </form>
      {error && <div className="form-error inline">{error}</div>}
      <div className="gate-foot">
        <span>Signed in as {user.email}</span>
        <span>{onBack && <button onClick={onBack}>Back</button>} <button onClick={onSignOut}>Sign out</button></span>
      </div>
    </Gate>
  );
}

function Root() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);
  const [teamId, setTeamId] = useState<string | null>(() => getPref('lastTeam'));
  const [managing, setManaging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    backend.currentUser().then(setUser, e => { setError((e as Error).message); setUser(null); });
  }, []);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    backend.listTeams().then(t => { if (alive) setTeams(t); }, e => { if (alive) setError((e as Error).message); });
    return () => { alive = false; };
  }, [user]);

  const pick = (t: TeamSummary) => {
    setTeams(ts => (ts && !ts.some(x => x.id === t.id) ? [...ts, t] : ts));
    setTeamId(t.id);
    setPref('lastTeam', t.id);
    setManaging(false);
  };

  const signOut = async () => {
    await backend.signOut().catch(() => {});
    setPref('lastTeam', null);
    setTeamId(null);
    setTeams(null);
    setUser(null);
  };

  if (user === undefined || (user && !teams)) {
    return <Gate><p className="sub">{error ? `⚠️ ${error}` : 'Loading…'}</p></Gate>;
  }
  if (!user) return <SignIn onSignedIn={setUser} />;

  const team = teams!.find(t => t.id === teamId);
  if (!team || managing) {
    return <TeamGate user={user} teams={teams!} onPick={pick} onSignOut={signOut}
                     onBack={team ? () => setManaging(false) : undefined} />;
  }

  return (
    <Dashboard key={team.id} backend={backend} user={user} team={team} teams={teams!}
               onSwitchTeam={id => { const t = teams!.find(x => x.id === id); if (t) pick(t); }}
               onManageTeams={() => setManaging(true)} onSignOut={signOut} />
  );
}

export default function App() {
  return (
    <ToastProvider>
      <NowProvider>
        <Root />
      </NowProvider>
    </ToastProvider>
  );
}
