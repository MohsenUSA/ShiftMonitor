import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sm-devstore-'));
process.env.DEV_DB_PATH = join(dir, 'db.json');
const { devStore, HttpError } = await import('../../lib/server/devStore.ts');

test.after(() => rmSync(dir, { recursive: true, force: true }));

const status = (fn: () => unknown) => {
  try { fn(); } catch (e) { return e instanceof HttpError ? e.status : -1; }
  return 200;
};

test('teams are isolated and join codes grant access', () => {
  const db = devStore();
  const a = db.signIn('a@example.com', 'A');
  const b = db.signIn('B@Example.com ', 'B');
  assert.equal(db.signIn('b@example.com', '').id, b.id);   // same email → same user

  const t = db.createTeam(a.id, 'Store 1');
  assert.match(t.joinCode, /^[A-Z2-9]{6}$/);
  assert.equal(status(() => db.snapshot(b.id, t.id)), 403);

  const emp = { id: 'e1', teamId: t.id, name: 'Sam', createdAt: '' };
  db.write(a.id, t.id, [{ op: 'put', collection: 'employees', record: emp }], 'c1');

  // B can't write to A's team, or smuggle a record in under another team id.
  assert.equal(status(() => db.write(b.id, t.id, [], 'c2')), 403);
  const t2 = db.createTeam(b.id, 'Store 2');
  assert.equal(status(() => db.write(b.id, t2.id, [{ op: 'put', collection: 'employees', record: emp }], 'c2')), 400);
  assert.equal(status(() => db.write(b.id, t2.id, [{ op: 'put', collection: 'employees', record: { ...emp, teamId: t2.id } }], 'c2')), 403);
  assert.equal(status(() => db.write(b.id, t2.id, [{ op: 'delete', collection: 'employees', id: 'e1' }], 'c2')), 403);
  assert.equal(db.snapshot(a.id, t.id).employees.length, 1);

  db.joinTeam(b.id, t.joinCode.toLowerCase());
  assert.equal(db.snapshot(b.id, t.id).employees[0].name, 'Sam');
  assert.deepEqual(db.listTeams(b.id).map(x => x.name).sort(), ['Store 1', 'Store 2']);
  assert.equal(status(() => db.joinTeam(b.id, 'ZZZZZZ')), 404);
});

test('writes reach subscribers with the sender id', () => {
  const db = devStore();
  const a = db.signIn('c@example.com', '');
  const t = db.createTeam(a.id, 'Live');
  const seen: string[] = [];
  const off = db.subscribe(a.id, t.id, e => seen.push(e.clientId));
  db.write(a.id, t.id, [{ op: 'team', patch: { name: 'Live 2' } }], 'tab-1');
  off();
  db.write(a.id, t.id, [{ op: 'team', patch: { name: 'Live 3' } }], 'tab-2');
  assert.deepEqual(seen, ['tab-1']);
  assert.equal(db.snapshot(a.id, t.id).team.name, 'Live 3');
});
