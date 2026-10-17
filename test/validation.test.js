import test from 'node:test';
import assert from 'node:assert/strict';
import { isCalendarDate, validateWorkout } from '../validation.js';

const valid = () => ({ date: '2024-02-29', exercises: [{ name: ' Squat ', sets: [{ weight: 20.25, reps: 8, unit: 'kg' }] }] });

test('calendar dates are validated without time-zone conversion', () => {
  for (const date of ['0001-01-01', '2000-02-29', '2024-02-29', '2026-03-08', '2026-11-01', '9999-12-31']) {
    assert.equal(isCalendarDate(date), true, date);
    assert.equal(validateWorkout({ ...valid(), date }).value.date, date);
  }
  for (const date of ['0000-01-01', '1900-02-29', '2023-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00', '2026-1-01', '2026-01-01T00:00:00Z', '', null, 20260101]) {
    assert.equal(isCalendarDate(date), false, String(date));
  }
});

test('normalizes names and preserves decimal weights, zero weights, mixed units, and order', () => {
  const input = valid();
  input.exercises[0].sets.push({ weight: 0, reps: 1, unit: 'lb' });
  const { value, errors } = validateWorkout(input);
  assert.deepEqual(errors, []);
  assert.equal(value.exercises[0].name, 'Squat');
  assert.deepEqual(value.exercises[0].sets, input.exercises[0].sets);
  assert.equal(input.exercises[0].name, ' Squat ');
});

test('rejects non-finite numbers that cannot be expressed in JSON', () => {
  for (const weight of [NaN, Infinity, -Infinity]) {
    const input = valid(); input.exercises[0].sets[0].weight = weight;
    assert.ok(validateWorkout(input).errors.some((error) => error.includes('weight')));
  }
});

test('accepts configured upper limits', () => {
  const input = valid();
  input.exercises = Array.from({ length: 50 }, () => ({ name: 'x'.repeat(100), sets: Array.from({ length: 50 }, () => ({ weight: 100000, reps: 10000, unit: 'lb' })) }));
  assert.deepEqual(validateWorkout(input).errors, []);
});
