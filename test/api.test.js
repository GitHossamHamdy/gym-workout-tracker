import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { openStore } from '../store.js';

const sample = () => ({ date: '2026-11-01', exercises: [
  { name: ' Squat ', sets: [{ weight: 22.25, reps: 8, unit: 'kg' }, { weight: 50.5, reps: 5, unit: 'lb' }] },
  { name: 'Push-up', sets: [{ weight: 0, reps: 12, unit: 'kg' }] },
] });
async function fixture(t, store = openStore(':memory:')) {
  const server = createApp(store).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (path, method = 'GET', body) => {
    const response = await fetch(base + path, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
    return { status: response.status, headers: response.headers, data };
  };
}

test('HTTP CRUD supports multiple exercises/sets, date filtering, editing, and deletion', async (t) => {
  const api = await fixture(t);
  assert.deepEqual((await api('/api/workouts')).data, { workouts: [] });
  const created = await api('/api/workouts', 'POST', sample());
  assert.equal(created.status, 201);
  const { workout } = created.data;
  assert.equal(created.headers.get('location'), `/api/workouts/${workout.id}`);
  assert.equal(workout.date, '2026-11-01');
  assert.equal(workout.exercises[0].name, 'Squat');
  assert.deepEqual(workout.exercises[0].sets, sample().exercises[0].sets);
  assert.deepEqual((await api(`/api/workouts/${workout.id}`)).data.workout, workout);
  const older = await api('/api/workouts', 'POST', { ...sample(), date: '2024-02-29' });
  assert.deepEqual((await api('/api/workouts')).data.workouts.map((entry) => entry.id), [workout.id, older.data.workout.id]);
  assert.equal((await api('/api/workouts?date=2024-02-29')).data.workouts.length, 1);
  assert.deepEqual((await api('/api/workouts?date=2020-01-01')).data.workouts, []);
  const changes = { date: '2026-03-08', exercises: [{ name: 'Bench press', sets: [{ weight: 55.125, reps: 9, unit: 'lb' }] }] };
  const updated = await api(`/api/workouts/${workout.id}`, 'PUT', changes);
  assert.equal(updated.status, 200);
  assert.equal(updated.data.workout.id, workout.id);
  assert.equal(updated.data.workout.date, changes.date);
  assert.deepEqual(updated.data.workout.exercises, changes.exercises);
  assert.equal((await api('/api/workouts?date=2026-11-01')).data.workouts.length, 0);
  assert.equal((await api(`/api/workouts/${workout.id}`, 'DELETE')).status, 204);
  assert.equal((await api(`/api/workouts/${workout.id}`)).status, 404);
  assert.equal((await api('/api/workouts')).data.workouts.length, 1);
});

const invalidInputs = [
  ['missing workout', {}], ['null workout', null], ['array workout', []],
  ['invalid leap day', { ...sample(), date: '2025-02-29' }],
  ['timestamp instead of date', { ...sample(), date: '2026-11-01T00:00:00Z' }],
  ['no exercises', { ...sample(), exercises: [] }],
  ['too many exercises', { ...sample(), exercises: Array(51).fill(sample().exercises[0]) }],
  ['null exercise', { ...sample(), exercises: [null] }],
  ['blank exercise name', { ...sample(), exercises: [{ name: '   ', sets: [{ weight: 1, reps: 1, unit: 'kg' }] }] }],
  ['long exercise name', { ...sample(), exercises: [{ name: 'x'.repeat(101), sets: [{ weight: 1, reps: 1, unit: 'kg' }] }] }],
  ['numeric exercise name', { ...sample(), exercises: [{ name: 42, sets: [{ weight: 1, reps: 1, unit: 'kg' }] }] }],
  ['control characters in name', { ...sample(), exercises: [{ name: 'Squat\u0000hidden', sets: [{ weight: 1, reps: 1, unit: 'kg' }] }] }],
  ['missing sets', { ...sample(), exercises: [{ name: 'Squat' }] }],
  ['empty sets', { ...sample(), exercises: [{ name: 'Squat', sets: [] }] }],
  ['too many sets', { ...sample(), exercises: [{ name: 'Squat', sets: Array(51).fill({ weight: 1, reps: 1, unit: 'kg' }) }] }],
  ...[
    ['null set', null], ['missing weight', { reps: 8, unit: 'kg' }],
    ['negative weight', { weight: -1, reps: 8, unit: 'kg' }],
    ['excessive weight', { weight: 100001, reps: 8, unit: 'kg' }],
    ['string weight', { weight: '20', reps: 8, unit: 'kg' }],
    ['null weight', { weight: null, reps: 8, unit: 'kg' }],
    ['zero reps', { weight: 20, reps: 0, unit: 'kg' }],
    ['negative reps', { weight: 20, reps: -1, unit: 'kg' }],
    ['decimal reps', { weight: 20, reps: 1.5, unit: 'kg' }],
    ['string reps', { weight: 20, reps: '8', unit: 'kg' }],
    ['excessive reps', { weight: 20, reps: 10001, unit: 'kg' }],
    ['missing unit', { weight: 20, reps: 8 }],
    ['unknown unit', { weight: 20, reps: 8, unit: 'stone' }],
  ].map(([name, set]) => [name, { ...sample(), exercises: [{ name: 'Squat', sets: [set] }] }]),
];

test('invalid creates and updates return helpful errors without changing saved data', async (t) => {
  const api = await fixture(t);
  const original = (await api('/api/workouts', 'POST', sample())).data.workout;
  for (const [name, input] of invalidInputs) {
    await t.test(name, async () => {
      for (const [path, method] of [['/api/workouts', 'POST'], [`/api/workouts/${original.id}`, 'PUT']]) {
        const result = await api(path, method, input);
        assert.equal(result.status, 400);
        assert.equal(typeof result.data.error, 'string');
      }
      assert.deepEqual((await api(`/api/workouts/${original.id}`)).data.workout, original);
      assert.equal((await api('/api/workouts')).data.workouts.length, 1);
    });
  }
});

test('rejects invalid IDs and filters; missing workouts return 404', async (t) => {
  const api = await fixture(t);
  for (const id of ['0', '-1', '1.5', 'abc', '9007199254740992', '01']) {
    for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await api(`/api/workouts/${id}`, method, method === 'PUT' ? sample() : undefined)).status, 400);
  }
  for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await api('/api/workouts/999', method, method === 'PUT' ? sample() : undefined)).status, 404);
  for (const query of ['date=2026-02-30', 'date=', 'date=2026-01-01&date=2026-01-02', 'date=%27%20OR%201%3D1']) assert.equal((await api(`/api/workouts?${query}`)).status, 400);
  assert.equal((await api('/api/unknown')).status, 404);
});

test('serves the UI with security headers and API responses are not cached', async (t) => {
  const api = await fixture(t);
  const page = await api('/');
  assert.equal(page.status, 200);
  assert.match(page.data, /Make every set count/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('x-powered-by'), null);
  assert.equal((await api('/app.js')).status, 200);
  assert.equal((await api('/styles.css')).status, 200);
  assert.equal((await api('/api/workouts')).headers.get('cache-control'), 'no-store');
  assert.equal((await api('/not-a-page')).status, 404);
});

test('malformed, wrong-content-type, and oversized requests receive clear JSON errors', async (t) => {
  const store = openStore(':memory:');
  const server = createApp(store).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); store.close(); });
  for (const [body, type, status] of [['{broken', 'application/json', 400], ['not json', 'text/plain', 415], ['{}', 'application/json; charset=iso-8859-1', 415], ['x'.repeat(513 * 1024), 'application/json', 413]]) {
    const response = await fetch(`${base}/api/workouts`, { method: 'POST', headers: { 'Content-Type': type }, body });
    assert.equal(response.status, status);
    assert.equal(typeof (await response.json()).error, 'string');
  }
});

test('GET / is a read-only health probe independent of workout storage', async (t) => {
  const api = await fixture(t, { close() {} });
  // A probe must work without invoking any store method or schema migration.
  const result = await api('/');
  assert.equal(result.status, 200);
  assert.match(result.headers.get('content-type'), /text\/html/);
  assert.match(result.data, /Workout journal/);
});

test('unexpected storage errors return a generic JSON error without database details', async (t) => {
  const api = await fixture(t, {
    list() { throw Object.assign(new Error('Private database details'), { code: 'SQLITE_ERROR' }); },
    close() {},
  });
  const log = t.mock.method(console, 'error', () => {});
  const result = await api('/api/workouts');
  assert.equal(result.status, 500);
  assert.equal(result.data.error, 'Unable to save or load your workout. Please try again.');
  assert.equal(JSON.stringify(result.data).includes('Private'), false);
  assert.equal(log.mock.callCount(), 1);
});

test('parameterized SQL stores SQL-like and HTML-like names as plain data', async (t) => {
  const api = await fixture(t);
  for (const name of ["Squat'); DROP TABLE workouts; --", '<img src=x onerror=alert(1)>']) {
    const result = await api('/api/workouts', 'POST', { ...sample(), exercises: [{ name, sets: [{ weight: 1, reps: 1, unit: 'kg' }] }] });
    assert.equal(result.status, 201);
    assert.equal(result.data.workout.exercises[0].name, name);
  }
  assert.equal((await api('/api/workouts')).data.workouts.length, 2);
});
