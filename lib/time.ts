import type { ShiftTimes } from './model.ts';

/* All shift math runs on a "shift timeline": minutes since midnight, allowed
   to run past 1440 when a shift crosses midnight. A break scheduled at 01:30
   inside a 23:30–03:30 shift is minute 1530, not minute 90 of today. */

export function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff < 0) diff += 1440;            // overnight shift wraps past midnight
  return diff;
}

export function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = (h * 60 + m) + mins;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function formatTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

export const toMin = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

export const minToHM = (m: number): string => {
  m = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/* 2h · 2h 30m — used in Break Rules labels. */
export const H = (m: number): string => (m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`);

export const fmtDur = (m: number): string => {
  m = Math.max(1, Math.round(m));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};

export const fmtIso = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export const isoToHM = (iso: string): string => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function shiftSpan(shift: ShiftTimes): { s: number; e: number } {
  const s = toMin(shift.start);
  return { s, e: s + minutesBetween(shift.start, shift.end) };
}

export function breakAbs(br: { scheduled: string }, shift: ShiftTimes): number {
  const { s } = shiftSpan(shift);
  return s + ((toMin(br.scheduled) - s + 1440) % 1440);
}

/* ---------- Off-time (PTO / Drop) ---------- */

export type OffKind = 'pto' | 'drop';

export const OFF_KINDS: Record<OffKind, { word: string; emoji: string; cls: string }> = {
  pto: { word: 'PTO', emoji: '🌴', cls: 'pto' },
  drop: { word: 'Drop', emoji: '⛔', cls: 'drop' },
};

export const offStartMin = (s: ShiftTimes): number => (s.ptoStart || 0) + (s.dropStart || 0);
export const offEndMin = (s: ShiftTimes): number => (s.ptoEnd || 0) + (s.dropEnd || 0);

/* The working window — scheduled shift minus all off-time. Everything that
   asks "when is this person actually working" uses this, not shiftSpan. */
export function workSpan(shift: ShiftTimes): { s: number; e: number } {
  const { s, e } = shiftSpan(shift);
  return { s: s + offStartMin(shift), e: e - offEndMin(shift) };
}

export function workMinutes(shift: ShiftTimes): number {
  return minutesBetween(shift.start, shift.end) - offStartMin(shift) - offEndMin(shift);
}

export function isFullOff(shift: ShiftTimes): boolean {
  return (offStartMin(shift) + offEndMin(shift)) > 0 && workMinutes(shift) <= 0;
}

/* For a full-shift carve-out, which kind labels it (the larger one wins). */
export function fullOffKind(shift: ShiftTimes): OffKind {
  return ((shift.dropStart || 0) + (shift.dropEnd || 0)) >= ((shift.ptoStart || 0) + (shift.ptoEnd || 0))
    ? 'drop' : 'pto';
}

/* Summary combining both kinds, e.g. "PTO 1h 00m end · Drop 30m start". */
export function offSummary(shift: ShiftTimes): string {
  if (isFullOff(shift)) return 'Full-shift ' + OFF_KINDS[fullOffKind(shift)].word;
  const part = (kind: OffKind) => {
    const a: string[] = [];
    const st = shift[`${kind}Start`], en = shift[`${kind}End`];
    if (st) a.push(`${fmtDur(st)} start`);
    if (en) a.push(`${fmtDur(en)} end`);
    return a.length ? OFF_KINDS[kind].word + ' ' + a.join(' · ') : '';
  };
  return [part('pto'), part('drop')].filter(Boolean).join(' · ');
}

export interface OffBlock { kind: OffKind; edge: 'start' | 'end'; mins: number; from: number; to: number }

/* Off-time blocks in chronological order, in absolute shift-timeline minutes. */
export function offBlocks(shift: ShiftTimes): OffBlock[] {
  const { s, e } = shiftSpan(shift);
  const out: OffBlock[] = [];
  let cur = s;
  for (const kind of ['pto', 'drop'] as const) {          // start edge, outermost first
    const m = shift[`${kind}Start`] || 0;
    if (m > 0) { out.push({ kind, edge: 'start', mins: m, from: cur, to: cur + m }); cur += m; }
  }
  const endSegs: OffBlock[] = [];
  let endCur = e;
  for (const kind of ['drop', 'pto'] as const) {          // end edge, innermost first
    const m = shift[`${kind}End`] || 0;
    if (m > 0) { endSegs.push({ kind, edge: 'end', mins: m, from: endCur - m, to: endCur }); endCur -= m; }
  }
  endSegs.reverse().forEach(b => out.push(b));             // back to chronological
  return out;
}

/* Clock-time minutes anchored to a shift: early-morning hours count as
   next-day for overnight shifts (with a 6h grace window past shift end). */
export function anchorMin(rawMin: number, shift: ShiftTimes): number {
  const { e } = shiftSpan(shift);
  if (e > 1440 && rawMin < e - 1440 + 360) return rawMin + 1440;
  return rawMin;
}

export const dayMin = (d: Date): number => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;

export function nowAbs(shift: ShiftTimes, now: Date = new Date()): number {
  return anchorMin(dayMin(now), shift);
}

/* ---------- 24-hour text entry ---------- */

/* Normalise loose input to 'HH:MM', or null if invalid.
   Accepts '9', '9:5', '930', '0930', '09:30'. */
export function parseHM(str: string | null | undefined): string | null {
  str = (str || '').trim();
  let h: number, m: number;
  if (str.includes(':')) {
    const parts = str.split(':');
    h = parseInt(parts[0], 10);
    m = parseInt(parts[1] || '0', 10);
  } else {
    const d = str.replace(/\D/g, '');
    if (!d) return null;
    if (d.length <= 2) { h = parseInt(d, 10); m = 0; }
    else { h = parseInt(d.slice(0, d.length - 2), 10); m = parseInt(d.slice(-2), 10); }
  }
  if (!Number.isInteger(h) || !Number.isInteger(m) || h > 23 || m > 59) return null;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

/* Live keystroke clamp: keeps the field a valid partial 24-hour time.
     · first digit 3–9  → single-digit hour, padded ('9' → '09')
     · two-digit hour   → clamped to ≤ 23
     · minute tens 6–9  → clamped to 5
     · minute pair      → clamped to ≤ 59 */
export function clampTimeInput(value: string): string {
  let d = value.replace(/\D/g, '');
  if (!d) return '';

  let hour: string;
  if (+d[0] > 2) {
    hour = '0' + d[0];
    d = d.slice(1);
  } else if (d.length >= 2) {
    hour = d.slice(0, 2);
    if (+hour > 23) hour = '23';
    d = d.slice(2);
  } else {
    return d;
  }

  let min = d.slice(0, 2);
  if (min.length) {
    if (+min[0] > 5) min = '5' + min.slice(1);
    if (min.length === 2 && +min > 59) min = '59';
  }
  return min.length ? hour + ':' + min : hour;
}

/* Arrow Up/Down on a time field: step the hour or minute segment, wrapping. */
export function stepHM(value: string, delta: 1 | -1, onMinutes: boolean): string {
  let [h, m] = (parseHM(value) || '00:00').split(':').map(Number);
  if (onMinutes) m = (m + delta + 60) % 60;
  else h = (h + delta + 24) % 24;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

/* ---------- Avatars ---------- */

export function initials(name: string): string {
  return name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

export function avatarColor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 60% 48%)`;
}
