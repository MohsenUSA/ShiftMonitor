import type { Break, BreakRules, ShiftTimes } from './model.ts';
import { H, addMinutes, breakAbs, minutesBetween, offEndMin, offStartMin, shiftSpan } from './time.ts';

/* ---------- Break rules (all values in minutes) ---------- */

export const BREAK_RULE_DEFAULTS: BreakRules = {
  restLen: 10,        // quick break length (0 = no quick breaks)
  restEvery: 180,     // one quick break per this much work (or the major part of it)
  restMinShift: 120,  // quick breaks only on shifts longer than this
  lunchLen: 30,       // lunch length
  lunchAfter: 300,    // lunch only on shifts longer than this (0 = never)
  lunchAt: 300,       // lunch starts this far into the shift (earlier if it wouldn't fit)
  lunch2After: 600,   // second lunch on shifts longer than this (0 = never)
};

export type RuleField =
  | { group: string }
  | { key: keyof BreakRules; label: string; opts: [number, string][] };

export const BREAK_RULE_FIELDS: RuleField[] = [
  { group: 'Quick breaks' },
  { key: 'restLen', label: 'Quick break length',
    opts: [[0, 'No quick breaks'], [5, '5 min'], [10, '10 min'], [15, '15 min'], [20, '20 min']] },
  { key: 'restEvery', label: 'One quick break every',
    opts: [120, 150, 180, 210, 240, 270, 300, 360].map(m => [m, H(m) + ' of work']) },
  { key: 'restMinShift', label: 'Only on shifts longer than',
    opts: [60, 90, 120, 150, 180, 210, 240].map(m => [m, H(m)]) },
  { group: 'Lunch' },
  { key: 'lunchLen', label: 'Lunch length',
    opts: [[20, '20 min'], [30, '30 min'], [45, '45 min'], [60, '60 min']] },
  { key: 'lunchAfter', label: 'Lunch on shifts longer than',
    opts: [[0, 'No lunch'], ...[240, 300, 360, 420, 480].map((m): [number, string] => [m, H(m)])] },
  { key: 'lunchAt', label: 'Lunch starts',
    opts: [120, 150, 180, 210, 240, 270, 300, 330, 360].map(m => [m, H(m) + ' into the shift']) },
  { key: 'lunch2After', label: 'Second lunch on shifts longer than',
    opts: [[0, 'No second lunch'], ...[480, 540, 600, 660, 720].map((m): [number, string] => [m, H(m)])] },
];

/* Keep only values the dropdowns offer; anything else falls back to the default. */
export function sanitizeRules(saved: unknown): BreakRules {
  const src = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>;
  const out = { ...BREAK_RULE_DEFAULTS };
  for (const f of BREAK_RULE_FIELDS) {
    if (!('key' in f)) continue;
    const v = Number(src[f.key]);
    if (f.opts.some(o => o[0] === v)) out[f.key] = v;
  }
  return out;
}

export function breakRulesSummary(R: BreakRules): string {
  const parts: string[] = [];
  parts.push(R.restLen
    ? `${R.restLen}-min quick break every ${H(R.restEvery)} on shifts over ${H(R.restMinShift)}`
    : 'no quick breaks');
  parts.push(R.lunchAfter
    ? `${R.lunchLen}-min lunch ${H(R.lunchAt)} in on shifts over ${H(R.lunchAfter)}`
    : 'no lunch');
  if (R.lunchAfter && R.lunch2After) parts.push(`second lunch on shifts over ${H(R.lunch2After)}`);
  return parts.join(' · ') + '. Adjust in Break Rules.';
}

/* ---------- Break planning ---------- */

/* Plan the breaks for a working window. Every break fits inside it and
   breaks never overlap.
   - Lunch: on shifts longer than lunchAfter, starting lunchAt in (pulled
     earlier if it wouldn't fit). A second lunch on shifts over lunch2After.
   - Quick breaks: the shift is cut into restEvery-long blocks; each full
     block, plus a final block more than half full, gets one break near the
     middle of its block. A break that would land on a lunch moves to right
     after the lunch. */
export function createBreaks(start: string, end: string, R: BreakRules): Break[] {
  const total = minutesBetween(start, end);
  const plan: { type: string; off: number; len: number }[] = [];

  if (R.lunchAfter && total > R.lunchAfter && total > R.lunchLen) {
    const off = Math.min(R.lunchAt, total - R.lunchLen);
    plan.push({ type: 'Lunch', off, len: R.lunchLen });
    if (R.lunch2After && total > R.lunch2After) {
      const off2 = Math.min(R.lunch2After, total - R.lunchLen);
      if (off2 >= off + R.lunchLen) plan.push({ type: 'Lunch #2', off: off2, len: R.lunchLen });
    }
  }

  if (R.restLen && total > R.restMinShift) {
    const n = Math.floor((total + R.restEvery / 2 - 1) / R.restEvery);
    const lunches = plan.filter(b => b.type.startsWith('Lunch'));
    for (let i = 0; i < n; i++) {
      const blockStart = i * R.restEvery, blockEnd = Math.min((i + 1) * R.restEvery, total);
      let off = Math.floor((blockStart + blockEnd) / 2 / 5) * 5;
      lunches.forEach(l => { if (off < l.off + l.len && off + R.restLen > l.off) off = l.off + l.len; });
      plan.push({ type: 'rest', off, len: R.restLen });
    }
  }

  plan.sort((a, b) => a.off - b.off);
  const out: Break[] = [];
  let cursor = 0, restNo = 0;
  plan.forEach(b => {
    const off = Math.max(b.off, cursor);
    if (off + b.len > total) return;
    cursor = off + b.len;
    const type = b.type === 'rest' ? `Break #${++restNo}` : b.type;
    out.push({ type, scheduled: addMinutes(start, off), expected: b.len,
               status: 'scheduled', actualStart: null, actualEnd: null });
  });
  return out;
}

/* Plan breaks for the working window (shift minus off-time at each edge). */
export function planBreaksFor(start: string, end: string, offStart: number, offEnd: number, R: BreakRules): Break[] {
  const workMin = minutesBetween(start, end) - (offStart || 0) - (offEnd || 0);
  if (workMin <= 0) return [];
  const effStart = addMinutes(start, offStart || 0);
  return createBreaks(effStart, addMinutes(effStart, workMin), R);
}

/* Re-plan a shift's breaks from the rules, carrying over any break that
   already ran (matched by type) so its record isn't lost. */
export function replanBreaks(shift: ShiftTimes & { breaks: Break[] }, R: BreakRules): Break[] {
  const old = shift.breaks || [];
  const plan = planBreaksFor(shift.start, shift.end, offStartMin(shift), offEndMin(shift), R);
  plan.forEach(nb => {
    const ran = old.find(b => b.type === nb.type && b.status !== 'scheduled');
    if (ran) {
      nb.status = ran.status;
      nb.actualStart = ran.actualStart;
      nb.actualEnd = ran.actualEnd;
    }
  });
  old.filter(b => b.status !== 'scheduled' && !plan.some(nb => nb.type === b.type))
     .forEach(b => plan.push({ ...b }));
  return plan;
}

/* Drop planned breaks that don't fit inside their shift (older data). */
export function dropOverflowBreaks(shift: ShiftTimes & { breaks: Break[] }): Break[] {
  const { e } = shiftSpan(shift);
  return shift.breaks.filter(b => b.status !== 'scheduled' || breakAbs(b, shift) + b.expected <= e);
}
