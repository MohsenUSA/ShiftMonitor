import type { Collection, TeamSnapshot, WriteOp } from './model.ts';

/* Apply write ops to a snapshot, immutably. Used for optimistic local
   updates, for changes pushed from other users, and by the dev server's
   store. Puts are upserts by id, so applying the same op twice is harmless. */
export function applyOps(snap: TeamSnapshot, ops: WriteOp[]): TeamSnapshot {
  let { team, employees, shifts, history } = snap;
  const lists = { employees, shifts, history } as Record<Collection, { id: string }[]>;
  const touched = new Set<Collection>();

  for (const op of ops) {
    if (op.op === 'team') {
      team = { ...team, ...op.patch };
      continue;
    }
    const c = op.collection;
    if (!touched.has(c)) { lists[c] = [...lists[c]]; touched.add(c); }
    const list = lists[c];
    const id = op.op === 'put' ? op.record.id : op.id;
    const i = list.findIndex(r => r.id === id);
    if (op.op === 'put') {
      if (i >= 0) list[i] = op.record; else list.push(op.record);
    } else if (i >= 0) {
      list.splice(i, 1);
    }
  }

  employees = lists.employees as TeamSnapshot['employees'];
  shifts = lists.shifts as TeamSnapshot['shifts'];
  history = lists.history as TeamSnapshot['history'];
  return { team, employees, shifts, history };
}
