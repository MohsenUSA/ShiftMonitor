import type { Employee, Shift } from './model.ts';
import { parseHM } from './time.ts';

const TIME_RE_SRC = String.raw`\b([01]?\d|2[0-3]):[0-5]\d\b`;

/* Find the employees referenced in pasted text by matching name words as
   whole words; returns those sharing the highest number of matched words. */
export function matchEmployeesInText(text: string, employees: Employee[]): Employee[] {
  const hay = ' ' + text.toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
  let best: Employee[] = [], bestScore = 0;
  employees.forEach(e => {
    const tokens = e.name.toLowerCase().split(/\s+/)
      .map(t => t.replace(/[^a-z0-9]+/g, ''))
      .filter(t => t.length >= 2);
    const score = tokens.filter(t => hay.includes(' ' + t + ' ')).length;
    if (score > 0) {
      if (score > bestScore) { bestScore = score; best = [e]; }
      else if (score === bestScore) { best.push(e); }
    }
  });
  return best;
}

export interface Segment { line: string; matchText: string; start: string; end: string; timeCount: number }

/* Break pasted text into shift segments. Times pair up in order of
   appearance, so one line can hold several shifts ("sam 09:00 12:00 mason
   13:00 17:00"). For a line with a single shift the whole line is matched,
   so a "time first" layout still finds the employee. */
export function extractShiftSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  text.split(/\r?\n/).forEach(rawLine => {
    const line = rawLine.trim();
    if (!line) return;

    const re = new RegExp(TIME_RE_SRC, 'g');
    const found: { t: string; idx: number; end: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      const t = parseHM(m[0]);
      if (t) found.push({ t, idx: m.index, end: m.index + m[0].length });
    }
    if (!found.length) return;

    const multi = found.length > 2;
    let prev = 0;
    for (let i = 0; i < found.length; i += 2) {
      const a = found[i], b = found[i + 1];
      const nameStr = line.slice(prev, a.idx).trim();
      segments.push({
        line,
        matchText: multi ? nameStr : line,
        start: a.t,
        end: b ? b.t : '',
        timeCount: b ? 2 : 1,
      });
      prev = b ? b.end : a.end;
    }
  });
  return segments;
}

export function findTimes(text: string): string[] {
  return (text.match(new RegExp(TIME_RE_SRC, 'g')) || []).map(parseHM).filter((t): t is string => !!t);
}

/* Strip time tokens and separators to recover a candidate employee name. */
export function extractName(line: string): string {
  return line
    .replace(new RegExp(TIME_RE_SRC, 'g'), ' ')
    .replace(/[\t,;|]+/g, ' ')
    .replace(/[-–—]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ---------- Bulk import ---------- */

export interface BulkRow {
  id: number;
  line: string;
  employeeId: string | null;
  name: string;
  isNew: boolean;
  ambiguous: boolean;
  matchCount: number;
  timeCount: number;
  start: string;
  end: string;
  valid: boolean;
  reason: string;
}

export function buildBulkRows(segments: Segment[], employees: Employee[], shifts: Shift[]): BulkRow[] {
  const rows = segments.map((seg, i): BulkRow => {
    const matches = employees.length ? matchEmployeesInText(seg.matchText, employees) : [];
    let employeeId: string | null = null, name = '', isNew = false, ambiguous = false;

    if (matches.length === 1) {
      employeeId = matches[0].id; name = matches[0].name;
    } else if (matches.length > 1) {
      name = matches.map(m => m.name).join(', '); ambiguous = true;
    } else {
      const candidate = extractName(seg.matchText);
      const existing = candidate && employees.find(e => e.name.toLowerCase() === candidate.toLowerCase());
      if (existing) { employeeId = existing.id; name = existing.name; }
      else { name = candidate; isNew = true; }
    }

    return {
      id: i, line: seg.line, employeeId, name, isNew, ambiguous,
      matchCount: matches.length, timeCount: seg.timeCount,
      start: seg.start, end: seg.end, valid: false, reason: '',
    };
  });
  return revalidateBulk(rows, shifts);
}

/* Recompute each row's validity — cheap enough to run after every edit. */
export function revalidateBulk(rows: BulkRow[], shifts: Shift[]): BulkRow[] {
  const seen = new Set<string>();
  return rows.map(r => {
    const reasons: string[] = [];
    if (r.ambiguous) reasons.push(`${r.matchCount} employees matched — remove & pick one`);
    else if (r.isNew && !r.name.trim()) reasons.push('name required');
    if (r.timeCount !== 2) {
      reasons.push(r.timeCount === 0 ? 'no times' : r.timeCount === 1 ? 'only one time' : 'too many times');
    }
    if (!reasons.length) {
      const key = (r.isNew ? 'new:' + r.name.trim().toLowerCase() : r.employeeId) + '|' + r.start + '|' + r.end;
      if (!r.isNew && shifts.some(s => s.employeeId === r.employeeId && s.start === r.start && s.end === r.end)) {
        reasons.push('already scheduled');
      } else if (seen.has(key)) {
        reasons.push('duplicate row');
      } else {
        seen.add(key);
      }
    }
    return { ...r, valid: reasons.length === 0, reason: reasons.join(' · ') };
  });
}
