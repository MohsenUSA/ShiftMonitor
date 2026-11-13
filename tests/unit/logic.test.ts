import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../../lib/actions.ts';
import { applyOps } from '../../lib/apply.ts';
import { crc32, historyCSV, historyXLSX } from '../../lib/export.ts';
import type { Employee, Shift, Team, TeamSnapshot } from '../../lib/model.ts';
import { buildBulkRows, extractShiftSegments, revalidateBulk } from '../../lib/parse.ts';
import { BREAK_RULE_DEFAULTS, createBreaks, replanBreaks, sanitizeRules } from '../../lib/rules.ts';
import { breakState, groupedHistory } from '../../lib/status.ts';
import { clampTimeInput, parseHM, stepHM, workSpan } from '../../lib/time.ts';

const R = BREAK_RULE_DEFAULTS;
const at = (h: number, m = 0) => new Date(2026, 10, 12, h, m, 0);

let n = 0;
const newId = () => `id-${++n}`;

const team: Team = { id: 'T1', name: 'Test', joinCode: 'ABC234', breakRules: R, createdAt: at(0).toISOString() };

function ctxOf(snap: TeamSnapshot, now = at(10)): A.Ctx {
  return { ...snap, now, newId };
}

function emptySnap(): TeamSnapshot {
  return { team, employees: [], shifts: [], history: [] };
}

/* Run actions in sequence, applying their ops like the UI does. */
function play(snap: TeamSnapshot, now: Date, fn: (ctx: A.Ctx) => A.Result): [TeamSnapshot, A.Result] {
  const r = fn(ctxOf(snap, now));
  return [applyOps(snap, r.ops), r];
}

test('time entry helpers', () => {
  assert.equal(parseHM('930'), '09:30');
  assert.equal(parseHM('9'), '09:00');
  assert.equal(parseHM('24:00'), null);
  assert.equal(clampTimeInput('9'), '09');
  assert.equal(clampTimeInput('2999'), '23:59');
  assert.equal(clampTimeInput('1275'), '12:55');
  assert.equal(stepHM('23:00', 1, false), '00:00');
  assert.equal(stepHM('10:59', 1, true), '10:00');
});

test('createBreaks plans an 8h day shift from the default rules', () => {
  const b = createBreaks('09:00', '17:00', R);
  assert.deepEqual(b.map(x => [x.type, x.scheduled, x.expected]), [
    ['Break #1', '10:30', 10],
    ['Break #2', '13:30', 10],
    ['Lunch', '14:00', 30],
    ['Break #3', '16:00', 10],
  ]);
});

test('createBreaks handles overnight shifts and second lunches', () => {
  const b = createBreaks('22:00', '10:00', R);   // 12h, crosses midnight
  const types = b.map(x => x.type);
  assert.ok(types.includes('Lunch') && types.includes('Lunch #2'));
  assert.equal(b.find(x => x.type === 'Lunch')!.scheduled, '03:00');
  assert.equal(b.find(x => x.type === 'Lunch #2')!.scheduled, '08:00');
  // Short shifts get nothing.
  assert.deepEqual(createBreaks('09:00', '10:30', R), []);
});

test('sanitizeRules keeps only offered values', () => {
  assert.deepEqual(sanitizeRules({ restLen: 15, lunchLen: 33 }), { ...R, restLen: 15 });
  assert.deepEqual(sanitizeRules(null), R);
});

test('replanBreaks keeps breaks that already ran', () => {
  const breaks = createBreaks('09:00', '17:00', R);
  breaks[0] = { ...breaks[0], status: 'completed', actualStart: at(10, 31).toISOString(), actualEnd: at(10, 41).toISOString() };
  const next = replanBreaks({ start: '09:00', end: '17:00', breaks }, { ...R, restLen: 15 });
  assert.equal(next[0].status, 'completed');
  assert.equal(next[0].actualStart, breaks[0].actualStart);
  assert.equal(next[1].expected, 15);
});

test('paste parsing: several shifts on one line, and new names', () => {
  const segs = extractShiftSegments('sam 09:00 12:00 mason 13:00 17:00\nNew Person 08:00 - 16:00');
  assert.equal(segs.length, 3);
  const emps: Employee[] = [
    { id: 'e1', teamId: 'T1', name: 'Sam Lee', createdAt: '' },
    { id: 'e2', teamId: 'T1', name: 'Mason Ray', createdAt: '' },
  ];
  const rows = buildBulkRows(segs, emps, []);
  assert.deepEqual(rows.map(r => [r.name, r.isNew, r.valid]), [
    ['Sam Lee', false, true],
    ['Mason Ray', false, true],
    ['New Person', true, true],
  ]);
  // Renaming the new row to an existing new row's name makes it a duplicate.
  const dup = revalidateBulk([...rows, { ...rows[2], id: 9 }], []);
  assert.equal(dup[3].reason, 'duplicate row');
});

test('bulk add creates each new employee once', () => {
  const snap = emptySnap();
  const rows = buildBulkRows(extractShiftSegments('Pat 09:00 12:00\nPat 13:00 17:00'), [], []);
  const [after, r] = play(snap, at(8), ctx => A.addBulkShifts(ctx, rows));
  assert.equal(after.employees.length, 1);
  assert.equal(after.shifts.length, 2);
  assert.match(r.toast!, /Added 2 shifts, created 1 employee/);
});

test('a full day: clock in, take a break, rename, clock out', () => {
  let snap = emptySnap();
  [snap] = play(snap, at(8), ctx => A.addEmployee(ctx, 'Alex Kim'));
  const empId = snap.employees[0].id;

  let r: A.Result;
  [snap, r] = play(snap, at(8), ctx => A.addShift(ctx, empId, '09:00', '17:00'));
  assert.equal(r.error, undefined);
  [, r] = play(snap, at(8), ctx => A.addShift(ctx, empId, '09:00', '17:00'));
  assert.match(r.error!, /already has a 09:00–17:00 shift/);

  const shiftId = snap.shifts[0].id;
  [, r] = play(snap, at(8), ctx => A.startBreak(ctx, shiftId, 0));
  assert.match(r.error!, /only be taken during the shift/);

  [snap] = play(snap, at(9, 2), ctx => A.clockIn(ctx, shiftId));
  [snap] = play(snap, at(10, 30), ctx => A.startBreak(ctx, shiftId, 0));
  assert.equal(breakState(snap.shifts[0].breaks[0], snap.shifts[0], at(10, 35)).key, 'active');
  [snap] = play(snap, at(10, 42), ctx => A.endBreak(ctx, shiftId, 0));
  assert.equal(snap.history.length, 1);
  assert.equal(snap.history[0].durationMins, 12);

  [snap] = play(snap, at(11), ctx => A.renameEmployee(ctx, empId, 'Alex K.'));
  assert.equal(snap.history[0].employee, 'Alex K.');
  [snap] = play(snap, at(11), ctx => A.addEmployee(ctx, 'Jo'));
  [, r] = play(snap, at(11), ctx => A.renameEmployee(ctx, empId, 'jo'));
  assert.match(r.error!, /already on the team/);

  [snap] = play(snap, at(17, 1), ctx => A.clockOut(ctx, shiftId));
  const groups = groupedHistory(snap.history);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0][1].map(h => h.type), ['Break #1', 'Shift']);

  const csv = historyCSV(snap.history, snap.shifts, snap.employees);
  assert.match(csv, /"Alex K\.","Break #1",.*"12","10"/);

  [snap] = play(snap, at(18), ctx => A.newDay(ctx));
  assert.equal(snap.shifts.length, 0);
  assert.equal(snap.history.length, 0);
  assert.equal(snap.employees.length, 2);
});

test('shift edit: PTO at the start shortens the working window and re-plans', () => {
  let snap = emptySnap();
  [snap] = play(snap, at(8), ctx => A.addEmployee(ctx, 'Rae'));
  [snap] = play(snap, at(8), ctx => A.addShift(ctx, snap.employees[0].id, '09:00', '17:00'));
  const id = snap.shifts[0].id;
  const form: A.ShiftEditForm = {
    start: '09:00', end: '17:00', clockIn: '', clockOut: '', punches: {},
    pto: { when: 'start', mins: 120 }, drop: { when: 'none', mins: 0 },
  };
  [snap] = play(snap, at(8), ctx => A.saveShiftEdit(ctx, id, form));
  const s: Shift = snap.shifts[0];
  assert.equal(s.ptoStart, 120);
  assert.deepEqual(workSpan(s), { s: 660, e: 1020 });
  assert.ok(s.breaks.every(b => b.scheduled >= '11:00'));
  // 6h of work is still over the 5h lunch threshold: lunch 5h into the working window.
  assert.equal(s.breaks.find(b => b.type === 'Lunch')!.scheduled, '16:00');
});

test('changing break rules re-plans only upcoming breaks', () => {
  let snap = emptySnap();
  [snap] = play(snap, at(8), ctx => A.addEmployee(ctx, 'Lee'));
  [snap] = play(snap, at(8), ctx => A.addShift(ctx, snap.employees[0].id, '09:00', '17:00'));
  [snap] = play(snap, at(10, 30), ctx => A.startBreak(ctx, snap.shifts[0].id, 0));
  [snap] = play(snap, at(11), ctx => A.setBreakRules(ctx, { ...R, restLen: 15 }));
  assert.equal(snap.team.breakRules.restLen, 15);
  assert.equal(snap.shifts[0].breaks[0].status, 'active');
  assert.equal(snap.shifts[0].breaks[1].expected, 15);
});

test('applyOps is idempotent', () => {
  const emp: Employee = { id: 'x', teamId: 'T1', name: 'A', createdAt: '' };
  const ops = [{ op: 'put', collection: 'employees', record: emp } as const];
  const once = applyOps(emptySnap(), [...ops]);
  const twice = applyOps(once, [...ops]);
  assert.deepEqual(once, twice);
  const del = applyOps(twice, [{ op: 'delete', collection: 'employees', id: 'x' }, { op: 'delete', collection: 'employees', id: 'x' }]);
  assert.equal(del.employees.length, 0);
});

test('xlsx export is a well-formed zip', () => {
  const zip = historyXLSX([], [], []);
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);                 // first local header
  assert.equal(view.getUint32(zip.length - 22, true), 0x06054b50);   // end of central directory
  assert.equal(view.getUint16(zip.length - 22 + 10, true), 6);        // six parts
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
});
