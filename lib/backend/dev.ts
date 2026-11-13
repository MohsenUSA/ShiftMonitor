import type { TeamSnapshot, User, WriteOp } from '../model.ts';
import type { Backend, TeamSummary } from './types.ts';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch('/api/dev' + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export const devBackend: Backend = {
  kind: 'dev',

  async currentUser() {
    return (await call<{ user: User | null }>('/session')).user;
  },
  async signIn(email, name) {
    return (await call<{ user: User }>('/session', post({ email, name }))).user;
  },
  async signOut() {
    await call('/session', { method: 'DELETE' });
  },

  async listTeams() {
    return (await call<{ teams: TeamSummary[] }>('/teams')).teams;
  },
  async createTeam(name) {
    return (await call<{ team: TeamSummary }>('/teams', post({ name }))).team;
  },
  async joinTeam(code) {
    return (await call<{ team: TeamSummary }>('/teams/join', post({ code }))).team;
  },

  loadTeam(teamId) {
    return call<TeamSnapshot>(`/teams/${encodeURIComponent(teamId)}`);
  },
  async write(teamId, ops, clientId) {
    await call(`/teams/${encodeURIComponent(teamId)}/ops`, post({ ops, clientId }));
  },

  subscribe(teamId, clientId, { onOps, onResync, onStatus }) {
    const es = new EventSource(`/api/dev/teams/${encodeURIComponent(teamId)}/events`);
    let dropped = false;
    es.onopen = () => {
      onStatus?.(true);
      if (dropped) { dropped = false; onResync(); }   // catch up on anything missed
    };
    es.onerror = () => { dropped = true; onStatus?.(false); };   // EventSource retries by itself
    es.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data) as { clientId: string; ops: WriteOp[] };
        if (msg.clientId !== clientId) onOps(msg.ops);
      } catch { /* ignore malformed */ }
    };
    return () => es.close();
  },
};
