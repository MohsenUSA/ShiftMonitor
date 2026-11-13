import type { TeamSnapshot, User, WriteOp } from '../model.ts';

export interface TeamSummary {
  id: string;
  name: string;
  joinCode: string;
}

/* What the UI needs from a backend. The local dev backend implements it
   against Next.js route handlers; the AWS backend will implement it with
   Cognito + AppSync. */
export interface Backend {
  readonly kind: 'dev' | 'aws';
  currentUser(): Promise<User | null>;
  signIn(email: string, name: string): Promise<User>;
  signOut(): Promise<void>;

  listTeams(): Promise<TeamSummary[]>;
  createTeam(name: string): Promise<TeamSummary>;
  joinTeam(code: string): Promise<TeamSummary>;

  loadTeam(teamId: string): Promise<TeamSnapshot>;
  write(teamId: string, ops: WriteOp[], clientId: string): Promise<void>;

  /* Live changes made by other clients. onOps gets each batch of ops; onResync
     fires after a reconnect, when the caller should reload the snapshot. */
  subscribe(teamId: string, clientId: string, handlers: {
    onOps: (ops: WriteOp[]) => void;
    onResync: () => void;
    onStatus?: (connected: boolean) => void;
  }): () => void;
}
