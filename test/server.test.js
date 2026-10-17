import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const networkAddress = Object.values(networkInterfaces()).flat()
  .find((address) => address.family === 'IPv4' && !address.internal)?.address;
async function freePort() {
  const reservation = createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const { port } = reservation.address();
  await new Promise((resolve) => reservation.close(resolve));
  return port;
}
async function start(t, port, filename, host) {
  const env = { ...process.env, PORT: String(port), DB_PATH: filename };
  delete env.HOST;
  if (host !== undefined) env.HOST = host;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
    }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server did not start within 10 seconds.')), 10000);
    let output = '';
    const cleanup = () => { clearTimeout(timer); child.stdout.off('data', onData); child.off('exit', onExit); child.off('error', onError); };
    function onData(chunk) {
      output += chunk;
      if (output.includes(`http://${host || '127.0.0.1'}:${port}`)) { cleanup(); resolve(); }
    }
    function onExit(code) { cleanup(); reject(new Error(`Server exited before startup: ${code}`)); }
    function onError(error) { cleanup(); reject(error); }
    child.stdout.on('data', onData); child.once('exit', onExit); child.once('error', onError);
  });
  return child;
}
async function stop(child) {
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const [code, signal] = await exited;
  assert.equal(code, 0);
  assert.equal(signal, null);
}

test('real server starts on loopback, serves HTTP CRUD, and retains SQLite data after restart', { timeout: 20000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'form-server-'));
  const filename = join(directory, 'workouts.sqlite');
  const port = await freePort();
  let child;
  try {
    child = await start(t, port, filename);
    const base = `http://127.0.0.1:${port}`;
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Workout journal/);
    await t.test('default listener rejects non-loopback connections', { skip: !networkAddress }, async () => {
      await assert.rejects(fetch(`http://${networkAddress}:${port}/`, { signal: AbortSignal.timeout(2000) }), { name: 'TypeError' });
    });
    const data = { date: '2026-03-08', exercises: [{ name: 'Synthetic test exercise', sets: [{ weight: 12.5, reps: 8, unit: 'kg' }] }] };
    const created = await fetch(`${base}/api/workouts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    assert.equal(created.status, 201);
    const original = (await created.json()).workout;
    assert.ok(existsSync(`${filename}-wal`), 'SQLite can create its WAL alongside the database');
    assert.ok(existsSync(`${filename}-shm`), 'SQLite can create its shared-memory file alongside the database');
    await stop(child);
    child = await start(t, port, filename);
    const restored = await fetch(`${base}/api/workouts/${original.id}`);
    assert.deepEqual((await restored.json()).workout, original);
    const updated = await fetch(`${base}/api/workouts/${original.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, date: '2026-11-01' }) });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).workout.date, '2026-11-01');
    assert.equal((await fetch(`${base}/api/workouts/${original.id}`, { method: 'DELETE' })).status, 204);
    assert.deepEqual((await (await fetch(`${base}/api/workouts`)).json()).workouts, []);
    await stop(child);
  } finally {
    if (child?.exitCode === null && child.signalCode === null) await stop(child);
    rmSync(directory, { recursive: true, force: true });
  }
});

test('configured HOST exposes HTTP on the requested interface', { timeout: 15000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'form-host-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const port = await freePort();
  const child = await start(t, port, join(directory, 'workouts.sqlite'), '0.0.0.0');
  try {
    // GET / is the container health/readiness probe: it never reads or writes workouts.
    assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200);
    await t.test('all-interface listener accepts non-loopback connections', { skip: !networkAddress }, async () => {
      assert.equal((await fetch(`http://${networkAddress}:${port}/`, { signal: AbortSignal.timeout(2000) })).status, 200);
    });
  } finally {
    await stop(child);
  }
});

test('empty HOST keeps the safe loopback default', { timeout: 15000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'form-host-empty-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const port = await freePort();
  const child = await start(t, port, join(directory, 'workouts.sqlite'), '');
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200);
    await t.test('empty HOST rejects non-loopback connections', { skip: !networkAddress }, async () => {
      await assert.rejects(fetch(`http://${networkAddress}:${port}/`, { signal: AbortSignal.timeout(2000) }), { name: 'TypeError' });
    });
  } finally {
    await stop(child);
  }
});

test('invalid PORT fails with a useful startup error', async () => {
  const child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: 'not-a-port' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let error = ''; child.stderr.on('data', (chunk) => { error += chunk; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 1);
  assert.match(error, /PORT must be a whole number/);
});
