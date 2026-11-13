/* Local development backend: a JSON file on disk plus an in-process event
   bus for live updates. Stands in for AWS (Cognito + AppSync + DynamoDB)
   while the app is built and tested on this machine. Not for production. */

import { randomUUID, randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { applyOps } from '../apply.ts';
import type { Employee, HistoryEntry, Shift, Team, TeamSnapshot, User, WriteOp } from '../model.ts';
import { BREAK_RULE_DEFAULTS, sanitizeRules } from '../rules.ts';
import type { TeamSummary } from '../backend/types.ts';

interface StoredTeam extends Team { memberIds: string[] }

interface DB {
  users: User[];
  teams: StoredTeam[];
  employees: Employee[];
  shifts: Shift[];
  history: HistoryEntry[];
}

export interface TeamEvent { clientId: string; ops: WriteOp[] }
type Listener = (e: TeamEvent) => void;

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

class DevStore {
  private db: DB;
  private listeners = new Map<string, Set<Listener>>();
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    this.db = this.read();
  }

  private read(): DB {
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8'));
      return { users: [], teams: [], employees: [], shifts: [], history: [], ...raw };
    } catch {
      return { users: [], teams: [], employees: [], shifts: [], history: [] };
    }
  }

  /* Write to a temp file and rename, so a crash never leaves half a file. */
  private persist() {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = this.path + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    renameSync(tmp, this.path);
  }

  /* ---------- users ---------- */

  user(id: string | undefined): User | null {
    return (id && this.db.users.find(u => u.id === id)) || null;
  }

  signIn(emailRaw: string, nameRaw: string): User {
    const email = emailRaw.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
    let user = this.db.users.find(u => u.email === email);
    if (!user) {
      user = { id: randomUUID(), email, name: nameRaw.trim() || email.split('@')[0] };
      this.db.users.push(user);
      this.persist();
    }
    return user;
  }

  /* ---------- teams ---------- */

  private summary = (t: StoredTeam): TeamSummary => ({ id: t.id, name: t.name, joinCode: t.joinCode });

  private member(userId: string, teamId: string): StoredTeam {
    const t = this.db.teams.find(x => x.id === teamId);
    if (!t) throw new HttpError(404, 'Team not found.');
    if (!t.memberIds.includes(userId)) throw new HttpError(403, 'You are not a member of this team.');
    return t;
  }

  listTeams(userId: string): TeamSummary[] {
    return this.db.teams.filter(t => t.memberIds.includes(userId)).map(this.summary);
  }

  /* 6 characters, no look-alikes (0/O, 1/I/L). */
  private newJoinCode(): string {
    const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    for (;;) {
      const code = Array.from({ length: 6 }, () => A[randomInt(A.length)]).join('');
      if (!this.db.teams.some(t => t.joinCode === code)) return code;
    }
  }

  createTeam(userId: string, nameRaw: string): TeamSummary {
    const name = nameRaw.trim();
    if (!name) throw new HttpError(400, 'Team name is required.');
    const team: StoredTeam = {
      id: randomUUID(), name, joinCode: this.newJoinCode(),
      breakRules: { ...BREAK_RULE_DEFAULTS }, createdAt: new Date().toISOString(), memberIds: [userId],
    };
    this.db.teams.push(team);
    this.persist();
    return this.summary(team);
  }

  joinTeam(userId: string, codeRaw: string): TeamSummary {
    const code = codeRaw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const team = this.db.teams.find(t => t.joinCode === code);
    if (!team) throw new HttpError(404, 'No team has that join code.');
    if (!team.memberIds.includes(userId)) {
      team.memberIds.push(userId);
      this.persist();
    }
    return this.summary(team);
  }

  snapshot(userId: string, teamId: string): TeamSnapshot {
    const stored = this.member(userId, teamId);
    const team: Team = {
      id: stored.id, name: stored.name, joinCode: stored.joinCode,
      breakRules: stored.breakRules, createdAt: stored.createdAt,
    };
    return {
      team,
      employees: this.db.employees.filter(r => r.teamId === teamId),
      shifts: this.db.shifts.filter(r => r.teamId === teamId),
      history: this.db.history.filter(r => r.teamId === teamId),
    };
  }

  /* ---------- writes ---------- */

  write(userId: string, teamId: string, ops: WriteOp[], clientId: string) {
    const stored = this.member(userId, teamId);
    if (!Array.isArray(ops)) throw new HttpError(400, 'ops must be an array.');

    // Every record must belong to this team, and a delete may only remove
    // this team's records — the same rule AWS will enforce per team.
    for (const op of ops) {
      if (op.op === 'put') {
        if (!op.record || typeof op.record.id !== 'string' || op.record.teamId !== teamId) {
          throw new HttpError(400, 'Record is missing an id or belongs to another team.');
        }
        const existing = (this.db[op.collection] as { id: string; teamId: string }[]).find(r => r.id === op.record.id);
        if (existing && existing.teamId !== teamId) throw new HttpError(403, 'Record belongs to another team.');
      } else if (op.op === 'delete') {
        const existing = (this.db[op.collection] as { id: string; teamId: string }[] | undefined)?.find(r => r.id === op.id);
        if (existing && existing.teamId !== teamId) throw new HttpError(403, 'Record belongs to another team.');
      } else if (op.op === 'team') {
        if (op.patch.breakRules) op.patch = { ...op.patch, breakRules: sanitizeRules(op.patch.breakRules) };
        if (op.patch.name !== undefined && !String(op.patch.name).trim()) throw new HttpError(400, 'Team name is required.');
      } else {
        throw new HttpError(400, 'Unknown op.');
      }
    }

    const next = applyOps(this.snapshot(userId, teamId), ops);
    stored.name = next.team.name;
    stored.breakRules = next.team.breakRules;
    const others = <T extends { teamId: string }>(list: T[]) => list.filter(r => r.teamId !== teamId);
    this.db.employees = [...others(this.db.employees), ...next.employees];
    this.db.shifts = [...others(this.db.shifts), ...next.shifts];
    this.db.history = [...others(this.db.history), ...next.history];
    this.persist();

    this.listeners.get(teamId)?.forEach(fn => {
      try { fn({ clientId, ops }); } catch { /* a dead stream unsubscribes itself */ }
    });
  }

  /* ---------- live updates ---------- */

  subscribe(userId: string, teamId: string, fn: Listener): () => void {
    this.member(userId, teamId);
    if (!this.listeners.has(teamId)) this.listeners.set(teamId, new Set());
    this.listeners.get(teamId)!.add(fn);
    return () => { this.listeners.get(teamId)?.delete(fn); };
  }
}

/* One store per server process. Kept on globalThis so dev-mode hot reloads
   and separately bundled route handlers all share the same instance. */
const g = globalThis as unknown as { __shiftMonitorDevStore?: DevStore };

export function devStore(): DevStore {
  const path = resolve(/*turbopackIgnore: true*/ process.env.DEV_DB_PATH || '.data/dev-db.json');
  if (!g.__shiftMonitorDevStore || g.__shiftMonitorDevStore.path !== path) {
    g.__shiftMonitorDevStore = new DevStore(path);
  }
  return g.__shiftMonitorDevStore;
}
