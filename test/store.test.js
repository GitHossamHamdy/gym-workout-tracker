import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../store.js';

const sample = () => ({ date: '2026-03-08', exercises: [
  { name: "Squat'); DROP TABLE workouts; --", sets: [{ weight: 42.75, reps: 8, unit: 'kg' }, { weight: 95.5, reps: 6, unit: 'lb' }] },
  { name: '<script>alert(1)</script>', sets: [{ weight: 0, reps: 12, unit: 'kg' }] },
] });

test('persists full nested workouts across close/reopen and cascades deletes', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'form-store-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, 'nested', 'workouts.sqlite');
  let store = openStore(filename);
  const created = store.create(sample());
  assert.deepEqual(created.exercises, sample().exercises);
  store.close();
  store = openStore(filename);
  assert.deepEqual(store.get(created.id), created);
  assert.equal(store.list('2026-03-08').length, 1);
  assert.equal(store.delete(created.id), true);
  assert.equal(store.delete(created.id), false);
  store.close();
  const db = new DatabaseSync(filename);
  try {
    for (const table of ['workouts', 'exercises', 'sets']) assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
  } finally { db.close(); }
});

test('a failed nested update rolls back date and all replaced exercises and sets', (t) => {
  const store = openStore(':memory:'); t.after(() => store.close());
  const original = store.create(sample());
  const invalid = sample(); invalid.date = '2026-04-01'; invalid.exercises[1].sets[0].reps = 0;
  assert.throws(() => store.update(original.id, invalid));
  assert.deepEqual(store.get(original.id), original);
  assert.throws(() => store.create(invalid));
  assert.equal(store.list().length, 1);
});

test('updates preserve identity and creation time, replace nested data, and sort by calendar date', (t) => {
  const store = openStore(':memory:'); t.after(() => store.close());
  const first = store.create(sample());
  const sameDay = store.create(sample());
  const older = store.create({ ...sample(), date: '2020-01-01' });
  assert.deepEqual(store.list().map((workout) => workout.id), [sameDay.id, first.id, older.id]);
  const update = { date: '2026-11-01', exercises: [{ name: 'Press', sets: [{ weight: 12.125, reps: 10, unit: 'lb' }] }] };
  const updated = store.update(older.id, update);
  assert.equal(updated.id, older.id);
  assert.equal(updated.createdAt, older.createdAt);
  assert.deepEqual(updated.exercises, update.exercises);
  assert.equal(updated.date, update.date);
  assert.equal(store.list()[0].id, older.id);
  assert.equal(store.update(9999, sample()), null);
  assert.equal(store.get(9999), null);
});
