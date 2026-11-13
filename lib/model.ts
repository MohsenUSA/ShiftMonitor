/* Shared data model. Every record belongs to a team; the shapes mirror what
   the legacy single-file app kept in localStorage so behaviour carries over,
   with string ids and a teamId added so they map cleanly onto a database. */

export type BreakStatus = 'scheduled' | 'active' | 'completed';

export interface Break {
  type: string;              // 'Break #1', 'Lunch', 'Lunch #2', 'Unscheduled'
  scheduled: string;         // 'HH:MM' (24h)
  expected: number;          // planned minutes (0 for unscheduled)
  status: BreakStatus;
  actualStart: string | null; // ISO timestamp
  actualEnd: string | null;
}

export interface Employee {
  id: string;
  teamId: string;
  name: string;
  createdAt: string;
}

/* Off-time carved out of a shift, in minutes, at each edge. PTO is paid
   (gray), Drop is an uncovered dropped portion (red). */
export interface OffTime {
  ptoStart?: number;
  ptoEnd?: number;
  dropStart?: number;
  dropEnd?: number;
}

export interface ShiftTimes extends OffTime {
  start: string;             // 'HH:MM'
  end: string;               // 'HH:MM' — earlier than start means overnight
}

export interface Shift extends ShiftTimes {
  id: string;
  teamId: string;
  employeeId: string;
  breaks: Break[];
  clockIn?: string | null;   // ISO
  clockOut?: string | null;
  createdAt: string;
}

/* A completed break or a clocked-out shift. The employee name is stored as it
   was at the time (so history survives the employee being removed) and is
   rewritten on rename via employeeId. */
export interface HistoryEntry {
  id: string;
  teamId: string;
  shiftId: string;
  employeeId: string;
  employee: string;
  type: string;              // break type, or 'Shift'
  start: string;             // display time, e.g. '9:05 AM'
  end: string;
  duration: string;          // display, e.g. '12 min' or '7h 58m'
  durationMins: number;
  expected: number;
  inStatus?: string;
  outStatus?: string;
  ptoNote?: string;
  loggedAt: string;          // ISO — keeps entries in the order they were logged
}

export interface BreakRules {
  restLen: number;
  restEvery: number;
  restMinShift: number;
  lunchLen: number;
  lunchAfter: number;
  lunchAt: number;
  lunch2After: number;
}

export interface Team {
  id: string;
  name: string;
  joinCode: string;
  breakRules: BreakRules;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface TeamSnapshot {
  team: Team;
  employees: Employee[];
  shifts: Shift[];
  history: HistoryEntry[];
}

export type Collection = 'employees' | 'shifts' | 'history';

export type RecordOf<C extends Collection> =
  C extends 'employees' ? Employee : C extends 'shifts' ? Shift : HistoryEntry;

/* Every change is expressed as a list of these. The local dev backend applies
   them as-is; the AWS backend will map each one onto a GraphQL mutation. */
export type WriteOp =
  | { op: 'put'; collection: 'employees'; record: Employee }
  | { op: 'put'; collection: 'shifts'; record: Shift }
  | { op: 'put'; collection: 'history'; record: HistoryEntry }
  | { op: 'delete'; collection: Collection; id: string }
  | { op: 'team'; patch: Partial<Pick<Team, 'name' | 'breakRules'>> };
