/* Every user action as a pure function: current team state in, a list of
   WriteOps (plus an optional toast or error) out. The UI applies the ops
   optimistically and hands them to the backend, so the same code drives the
   local dev backend now and AWS later — and it is unit-testable. */

import type { Break, BreakRules, Employee, HistoryEntry, Shift, Team, WriteOp } from './model.ts';
import { createBreaks, replanBreaks } from './rules.ts';
import type { BulkRow } from './parse.ts';
import {
  breakHistoryEntry, clockStatus, shiftHistoryEntry, withinShift,
} from './status.ts';
import { fmtIso, formatTime, minutesBetween, parseHM, workSpan } from './time.ts';

export interface Ctx {
  team: Team;
  employees: Employee[];
  shifts: Shift[];
  history: HistoryEntry[];
  now: Date;
  newId: () => string;
}

export interface Result {
  ops: WriteOp[];
  toast?: string;
  error?: string;
}

const none = (extra: Partial<Result> = {}): Result => ({ ops: [], ...extra });

export const employeeName = (ctx: Pick<Ctx, 'employees'>, id: string) =>
  ctx.employees.find(e => e.id === id)?.name || 'Unknown';

/* History entries need a strictly increasing loggedAt so several written in
   one action keep their order. */
function historyRecords(ctx: Ctx, entries: Omit<HistoryEntry, 'id' | 'teamId' | 'loggedAt'>[]): HistoryEntry[] {
  const base = ctx.now.getTime();
  return entries.map((e, i) => ({
    ...e, id: ctx.newId(), teamId: ctx.team.id, loggedAt: new Date(base + i).toISOString(),
  }));
}

const putShift = (record: Shift): WriteOp => ({ op: 'put', collection: 'shifts', record });
const putHistory = (record: HistoryEntry): WriteOp => ({ op: 'put', collection: 'history', record });

/* ---------- Team roster ---------- */

export function addEmployee(ctx: Ctx, rawName: string): Result {
  const name = rawName.trim();
  if (!name) return none();
  const record: Employee = { id: ctx.newId(), teamId: ctx.team.id, name, createdAt: ctx.now.toISOString() };
  return { ops: [{ op: 'put', collection: 'employees', record }] };
}

export function renameEmployee(ctx: Ctx, id: string, rawName: string): Result {
  const emp = ctx.employees.find(e => e.id === id);
  const name = rawName.trim();
  if (!emp || !name || name === emp.name) return none();
  if (ctx.employees.some(e => e.id !== id && e.name.toLowerCase() === name.toLowerCase())) {
    return none({ error: `${name} is already on the team.` });
  }
  // History stores the name as logged; rewrite it so the person doesn't split
  // into two groups. Legacy imports may lack employeeId, so match the name too.
  const ops: WriteOp[] = [{ op: 'put', collection: 'employees', record: { ...emp, name } }];
  ctx.history
    .filter(h => h.employeeId === id || (!h.employeeId && h.employee === emp.name))
    .forEach(h => ops.push(putHistory({ ...h, employee: name })));
  return { ops, toast: `Renamed ${emp.name} to ${name}.` };
}

export function deleteEmployee(ctx: Ctx, id: string): Result {
  const ops: WriteOp[] = [{ op: 'delete', collection: 'employees', id }];
  ctx.shifts.filter(s => s.employeeId === id).forEach(s => ops.push({ op: 'delete', collection: 'shifts', id: s.id }));
  return { ops };
}

/* ---------- Scheduling ---------- */

function newShift(ctx: Ctx, employeeId: string, start: string, end: string, createdAt = ctx.now.toISOString()): Shift {
  return {
    id: ctx.newId(), teamId: ctx.team.id, employeeId, start, end,
    breaks: createBreaks(start, end, ctx.team.breakRules),
    clockIn: null, clockOut: null, createdAt,
  };
}

export function addShift(ctx: Ctx, employeeId: string | null, startRaw: string, endRaw: string): Result {
  const start = parseHM(startRaw), end = parseHM(endRaw);
  if (!employeeId) {
    return none({ error: ctx.employees.length
      ? 'Select an employee above first.'
      : 'Add a team member first, then select them here.' });
  }
  if (!start || !end) return none({ error: 'Enter start and end as 24-hour HH:MM (e.g. 09:00, 17:30).' });
  if (ctx.shifts.some(s => s.employeeId === employeeId && s.start === start && s.end === end)) {
    return none({ error: `${employeeName(ctx, employeeId)} already has a ${start}–${end} shift.` });
  }
  return { ops: [putShift(newShift(ctx, employeeId, start, end))] };
}

/* Create any new employees first, coalescing rows (and matching existing
   names) so one name never yields two employees. */
export function addBulkShifts(ctx: Ctx, rows: BulkRow[]): Result {
  const valid = rows.filter(r => r.valid);
  if (!valid.length) return none();

  const ops: WriteOp[] = [];
  const newByName = new Map<string, string>();
  let created = 0;
  const base = ctx.now.getTime();

  valid.forEach((r, i) => {
    let employeeId = r.employeeId;
    if (r.isNew) {
      const key = r.name.trim().toLowerCase();
      if (newByName.has(key)) {
        employeeId = newByName.get(key)!;
      } else {
        const existing = ctx.employees.find(e => e.name.toLowerCase() === key);
        if (existing) { employeeId = existing.id; }
        else {
          const emp: Employee = { id: ctx.newId(), teamId: ctx.team.id, name: r.name.trim(),
                                  createdAt: new Date(base + created).toISOString() };
          created++;
          ops.push({ op: 'put', collection: 'employees', record: emp });
          employeeId = emp.id;
        }
        newByName.set(key, employeeId);
      }
    }
    ops.push(putShift(newShift(ctx, employeeId!, r.start, r.end, new Date(base + i).toISOString())));
  });

  const added = valid.length, skipped = rows.length - added;
  return {
    ops,
    toast: `Added ${added} shift${added === 1 ? '' : 's'}`
      + (created ? `, created ${created} employee${created === 1 ? '' : 's'}` : '')
      + (skipped ? `, skipped ${skipped}` : '') + '.',
  };
}

export function deleteShift(ctx: Ctx, id: string): Result {
  return { ops: [{ op: 'delete', collection: 'shifts', id }] };
}

/* ---------- Shift edit panel ---------- */

export type OffWhen = 'none' | 'start' | 'end' | 'full';

export interface ShiftEditForm {
  start: string;
  end: string;
  clockIn: string;                       // 'HH:MM' or ''
  clockOut: string;
  pto: { when: OffWhen; mins: number };
  drop: { when: OffWhen; mins: number };
  punches: Record<number, { start: string; end: string }>;  // by break index
}

export function offFromForm(when: OffWhen, mins: number, total: number): { start: number; end: number } {
  const m = Math.max(0, Math.round(mins || 0));
  if (when === 'full') return { start: total, end: 0 };
  if (when === 'start') return { start: m, end: 0 };
  if (when === 'end') return { start: 0, end: m };
  return { start: 0, end: 0 };
}

export function saveShiftEdit(ctx: Ctx, id: string, f: ShiftEditForm): Result {
  const orig = ctx.shifts.find(s => s.id === id);
  if (!orig || !f.start || !f.end || f.start === f.end) return none();

  const total = minutesBetween(f.start, f.end);
  const pto = offFromForm(f.pto.when, f.pto.mins, total);
  const drop = offFromForm(f.drop.when, f.drop.mins, total);
  if (pto.start + pto.end + drop.start + drop.end > total) {
    return none({ error: 'PTO + drop can’t be longer than the shift.' });
  }

  // Apply an HH:MM onto an existing timestamp's date (or today if none).
  const hmOnto = (hm: string, baseIso?: string | null) => {
    const d = baseIso ? new Date(baseIso) : new Date(ctx.now);
    const [h, m] = hm.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    return d;
  };
  // End punches roll to the next day when they read earlier than their start.
  const endIso = (hm: string, startIso: string) => {
    const d = hmOnto(hm, startIso);
    if (d <= new Date(startIso)) d.setDate(d.getDate() + 1);
    return d.toISOString();
  };

  const shift: Shift = {
    ...orig,
    start: f.start, end: f.end,
    ptoStart: pto.start, ptoEnd: pto.end, dropStart: drop.start, dropEnd: drop.end,
    breaks: orig.breaks.map(b => ({ ...b })),
  };

  // Clock punches — blanking the in-punch clears the out-punch too.
  shift.clockIn = f.clockIn ? hmOnto(f.clockIn, orig.clockIn).toISOString() : null;
  shift.clockOut = (shift.clockIn && f.clockOut) ? endIso(f.clockOut, shift.clockIn) : null;

  // Break punches by original index. A blanked start returns the break to
  // scheduled; a blanked end makes it active again.
  shift.breaks.forEach((br, i) => {
    const p = f.punches[i];
    if (!p) return;
    if (!p.start) {
      br.status = 'scheduled'; br.actualStart = null; br.actualEnd = null;
      return;
    }
    br.actualStart = hmOnto(p.start, br.actualStart).toISOString();
    if (p.end) { br.actualEnd = endIso(p.end, br.actualStart); br.status = 'completed'; }
    else { br.actualEnd = null; br.status = 'active'; }
  });

  shift.breaks = replanBreaks(shift, ctx.team.breakRules);

  // Punches define the records — rebuild this shift's history to match.
  const ops: WriteOp[] = [putShift(shift)];
  ctx.history.filter(h => h.shiftId === id).forEach(h => ops.push({ op: 'delete', collection: 'history', id: h.id }));
  const name = employeeName(ctx, shift.employeeId);
  const entries = shift.breaks
    .filter(b => b.status === 'completed' && b.actualStart && b.actualEnd)
    .sort((a, b) => +new Date(a.actualStart!) - +new Date(b.actualStart!))
    .map(br => breakHistoryEntry(shift, br, name));
  if (shift.clockIn && shift.clockOut) entries.push(shiftHistoryEntry(shift, name));
  historyRecords(ctx, entries).forEach(h => ops.push(putHistory(h)));
  return { ops };
}

/* ---------- Live actions ---------- */

function withBreaks(shift: Shift, fn: (breaks: Break[]) => void): Shift {
  const breaks = shift.breaks.map(b => ({ ...b }));
  fn(breaks);
  return { ...shift, breaks };
}

export function startBreak(ctx: Ctx, shiftId: string, index: number): Result {
  const shift = ctx.shifts.find(s => s.id === shiftId);
  if (!shift || !shift.breaks[index]) return none();
  if (!withinShift(shift, ctx.now)) {
    return none({ error: `Breaks can only be taken during the shift (${formatTime(shift.start)} – ${formatTime(shift.end)}).` });
  }
  return { ops: [putShift(withBreaks(shift, b => {
    b[index].status = 'active';
    b[index].actualStart = ctx.now.toISOString();
  }))] };
}

export function endBreak(ctx: Ctx, shiftId: string, index: number): Result {
  const shift = ctx.shifts.find(s => s.id === shiftId);
  if (!shift || shift.breaks[index]?.status !== 'active') return none();
  const updated = withBreaks(shift, b => {
    b[index].status = 'completed';
    b[index].actualEnd = ctx.now.toISOString();
  });
  const [entry] = historyRecords(ctx, [breakHistoryEntry(updated, updated.breaks[index], employeeName(ctx, shift.employeeId))]);
  return { ops: [putShift(updated), putHistory(entry)] };
}

export function addUnscheduledBreak(ctx: Ctx, shiftId: string): Result {
  const shift = ctx.shifts.find(s => s.id === shiftId);
  if (!shift) return none();
  if (!withinShift(shift, ctx.now)) return none({ error: 'Unscheduled breaks can only be logged while the shift is running.' });
  const now = ctx.now;
  const updated = withBreaks(shift, b => b.push({
    type: 'Unscheduled',
    scheduled: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    expected: 0,
    status: 'active',
    actualStart: now.toISOString(),
    actualEnd: null,
  }));
  return {
    ops: [putShift(updated)],
    toast: `Unscheduled break logged for ${employeeName(ctx, shift.employeeId)} at ${fmtIso(now.toISOString())}.`,
  };
}

export function clockIn(ctx: Ctx, shiftId: string): Result {
  const shift = ctx.shifts.find(s => s.id === shiftId);
  if (!shift || shift.clockIn) return none();
  const updated = { ...shift, clockIn: ctx.now.toISOString() };
  const cs = clockStatus(updated.clockIn, workSpan(shift).s, shift, 'in');
  return {
    ops: [putShift(updated)],
    toast: `${employeeName(ctx, shift.employeeId)} clocked in at ${fmtIso(updated.clockIn)} — ${cs.label}.`,
  };
}

export function clockOut(ctx: Ctx, shiftId: string): Result {
  const shift = ctx.shifts.find(s => s.id === shiftId);
  if (!shift || !shift.clockIn || shift.clockOut) return none();
  const updated = { ...shift, clockOut: ctx.now.toISOString() };
  const [entry] = historyRecords(ctx, [shiftHistoryEntry(updated, employeeName(ctx, shift.employeeId))]);
  const cs = clockStatus(updated.clockOut, workSpan(shift).e, shift, 'out');
  return {
    ops: [putShift(updated), putHistory(entry)],
    toast: `${employeeName(ctx, shift.employeeId)} clocked out at ${fmtIso(updated.clockOut)} — ${cs.label}.`,
  };
}

/* ---------- Day & history ---------- */

export function newDay(ctx: Ctx): Result {
  if (!ctx.shifts.length && !ctx.history.length) return none({ toast: 'Nothing to clear — already a fresh day.' });
  return {
    ops: [
      ...ctx.shifts.map((s): WriteOp => ({ op: 'delete', collection: 'shifts', id: s.id })),
      ...ctx.history.map((h): WriteOp => ({ op: 'delete', collection: 'history', id: h.id })),
    ],
    toast: 'New day started — roster kept, schedule and history cleared.',
  };
}

export function clearHistory(ctx: Ctx): Result {
  return { ops: ctx.history.map((h): WriteOp => ({ op: 'delete', collection: 'history', id: h.id })) };
}

/* ---------- Break rules ---------- */

/* Saving the rules re-plans every break that hasn't started yet. */
export function setBreakRules(ctx: Ctx, rules: BreakRules): Result {
  const ops: WriteOp[] = [{ op: 'team', patch: { breakRules: rules } }];
  ctx.shifts.forEach(s => {
    const breaks = replanBreaks(s, rules);
    if (JSON.stringify(breaks) !== JSON.stringify(s.breaks)) ops.push(putShift({ ...s, breaks }));
  });
  return { ops };
}
