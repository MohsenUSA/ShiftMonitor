import type { Break, Employee, HistoryEntry, Shift, ShiftTimes } from './model.ts';
import {
  anchorMin, breakAbs, dayMin, fmtDur, fmtIso, minutesBetween, nowAbs, offSummary, shiftSpan,
  workMinutes, workSpan,
} from './time.ts';

export const CLOCK_GRACE = 5;  // minutes either side of shift start/end that count as on time
export const REMIND_BEFORE = 5; // minutes before a scheduled break

export type BreakStateKey = 'done' | 'active' | 'overdue' | 'soon' | 'upcoming' | 'later';

export function breakState(br: Break, shift: ShiftTimes, now: Date = new Date()): { key: BreakStateKey; label: string } {
  if (br.status === 'completed') return { key: 'done', label: 'Completed' };
  if (br.status === 'active') return { key: 'active', label: 'On break' };

  const diff = breakAbs(br, shift) - nowAbs(shift, now);
  if (diff <= 0) return { key: 'overdue', label: `Overdue ${fmtDur(-diff)}` };
  if (diff <= 15) return { key: 'soon', label: `In ${fmtDur(diff)}` };
  if (diff <= 30) return { key: 'upcoming', label: `In ${fmtDur(diff)}` };
  return { key: 'later', label: 'Scheduled' };
}

/* PTO / drop time is off the clock — no breaks then. */
export function withinShift(shift: ShiftTimes, now: Date = new Date()): boolean {
  const { s, e } = workSpan(shift);
  const n = nowAbs(shift, now);
  return n >= s && n <= e;
}

export function clockStatus(iso: string, schedMin: number, shift: ShiftTimes, dir: 'in' | 'out'):
  { color: 'ok' | 'warn' | 'bad'; label: string } {
  const m = anchorMin(dayMin(new Date(iso)), shift);
  const diff = m - schedMin;
  const mag = Math.abs(diff);
  const early = diff < 0;
  if (mag < 1) return { color: 'ok', label: 'on time' };
  if (mag <= CLOCK_GRACE) return { color: 'ok', label: `grace period · ${fmtDur(mag)} ${early ? 'early' : 'late'}` };
  const harmful = dir === 'in' ? !early : early;   // late in, early out
  return { color: harmful ? 'bad' : 'warn', label: `${fmtDur(mag)} ${early ? 'early' : 'late'}` };
}

/* Earliest start first; ties keep creation order. */
export function sortShifts(shifts: Shift[]): Shift[] {
  return [...shifts].sort((a, b) =>
    shiftSpan(a).s - shiftSpan(b).s || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/* Shared schedule totals — used by the stat cards and the exports so the
   numbers always agree. Scheduled time is shift length minus lunches. */
export function scheduleSummary(shifts: Shift[], employees: Employee[]) {
  let schedMins = 0, lunchMins = 0, lunchCount = 0;
  shifts.forEach(s => {
    schedMins += minutesBetween(s.start, s.end);
    s.breaks.forEach(b => { if (b.type.startsWith('Lunch')) { lunchMins += b.expected; lunchCount++; } });
  });
  const netMins = Math.max(0, schedMins - lunchMins);
  return {
    schedMins, lunchMins, lunchCount, netMins,
    netHours: Math.round(netMins / 60 * 10) / 10,
    shiftCount: shifts.length,
    teamCount: employees.length,
    scheduledCount: new Set(shifts.map(s => s.employeeId)).size,
  };
}

/* ---------- History ---------- */

type EntryBase = Omit<HistoryEntry, 'id' | 'teamId' | 'loggedAt'>;

export function breakHistoryEntry(shift: Shift, br: Break, employeeName: string): EntryBase {
  const duration = Math.round((+new Date(br.actualEnd!) - +new Date(br.actualStart!)) / 60000);
  return {
    shiftId: shift.id,
    employeeId: shift.employeeId,
    employee: employeeName,
    type: br.type,
    start: fmtIso(br.actualStart!),
    end: fmtIso(br.actualEnd!),
    duration: duration + ' min',
    durationMins: duration,
    expected: br.expected,
  };
}

export function shiftHistoryEntry(shift: Shift, employeeName: string): EntryBase {
  const worked = Math.round((+new Date(shift.clockOut!) - +new Date(shift.clockIn!)) / 60000);
  const { s, e } = workSpan(shift);
  return {
    shiftId: shift.id,
    employeeId: shift.employeeId,
    employee: employeeName,
    type: 'Shift',
    start: fmtIso(shift.clockIn!),
    end: fmtIso(shift.clockOut!),
    duration: fmtDur(worked),
    durationMins: worked,
    expected: workMinutes(shift),   // expected working time (shift minus all off)
    inStatus: clockStatus(shift.clockIn!, s, shift, 'in').label,
    outStatus: clockStatus(shift.clockOut!, e, shift, 'out').label,
    ptoNote: offSummary(shift),
  };
}

export function sortHistory(history: HistoryEntry[]): HistoryEntry[] {
  return [...history].sort((a, b) => a.loggedAt.localeCompare(b.loggedAt) || a.id.localeCompare(b.id));
}

/* Entries bundled per employee, in the order they were logged. */
export function groupedHistory(history: HistoryEntry[]): [string, HistoryEntry[]][] {
  const byEmployee = new Map<string, HistoryEntry[]>();
  sortHistory(history).forEach(h => {
    if (!byEmployee.has(h.employee)) byEmployee.set(h.employee, []);
    byEmployee.get(h.employee)!.push(h);
  });
  return [...byEmployee.entries()];
}

export function entryStatus(h: HistoryEntry): { label: string; color: string } {
  const mins = h.durationMins ?? parseInt(h.duration);

  if (h.type === 'Shift') {
    if (isNaN(mins) || h.expected == null) return { label: 'shift record', color: '#eef2ff' };
    const d = mins - h.expected;
    if (Math.abs(d) <= CLOCK_GRACE) return { label: 'worked as scheduled', color: '#dcfce7' };
    return d < 0
      ? { label: `worked ${-d} min short`, color: '#fee2e2' }
      : { label: `worked +${d} min`, color: '#fffbeb' };
  }

  if (h.type === 'Unscheduled') {
    return { label: `unscheduled${isNaN(mins) ? '' : ' · ' + mins + ' min'}`, color: '#f3e8ff' };
  }

  if (h.expected == null || isNaN(mins)) return { label: '', color: '' };
  return mins <= h.expected
    ? { label: 'within expected', color: '#dcfce7' }
    : { label: `+${mins - h.expected} min over`, color: '#fee2e2' };
}
