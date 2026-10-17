import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openStore(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS workouts (
      id INTEGER PRIMARY KEY,
      date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS workouts_date ON workouts(date DESC, id DESC);
    CREATE TABLE IF NOT EXISTS exercises (
      id INTEGER PRIMARY KEY,
      workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS exercises_workout ON exercises(workout_id);
    CREATE TABLE IF NOT EXISTS sets (
      id INTEGER PRIMARY KEY,
      exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      weight REAL NOT NULL CHECK(weight >= 0 AND weight <= 100000),
      reps INTEGER NOT NULL CHECK(reps BETWEEN 1 AND 10000),
      unit TEXT NOT NULL CHECK(unit IN ('kg', 'lb'))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS sets_exercise ON sets(exercise_id);
  `);

  const insertExercise = db.prepare('INSERT INTO exercises (workout_id, position, name) VALUES (?, ?, ?)');
  const insertSet = db.prepare('INSERT INTO sets (exercise_id, position, weight, reps, unit) VALUES (?, ?, ?, ?, ?)');
  const insertWorkout = db.prepare('INSERT INTO workouts (date) VALUES (?)');
  const updateWorkout = db.prepare("UPDATE workouts SET date = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?");
  const clearExercises = db.prepare('DELETE FROM exercises WHERE workout_id = ?');
  const deleteWorkout = db.prepare('DELETE FROM workouts WHERE id = ?');
  const query = `
    SELECT w.id, w.date, w.created_at, w.updated_at,
           e.id AS exercise_id, e.name, s.weight, s.reps, s.unit
    FROM workouts w
    JOIN exercises e ON e.workout_id = w.id
    JOIN sets s ON s.exercise_id = e.id
  `;
  const ordering = ' ORDER BY w.date DESC, w.id DESC, e.position, s.position';
  const allRows = db.prepare(query + ordering);
  const dateRows = db.prepare(query + ' WHERE w.date = ?' + ordering);
  const idRows = db.prepare(query + ' WHERE w.id = ?' + ordering);

  function assemble(rows) {
    const workouts = new Map();
    const exercises = new Map();
    for (const row of rows) {
      if (!workouts.has(row.id)) {
        workouts.set(row.id, { id: row.id, date: row.date, createdAt: row.created_at, updatedAt: row.updated_at, exercises: [] });
      }
      if (!exercises.has(row.exercise_id)) {
        const exercise = { name: row.name, sets: [] };
        exercises.set(row.exercise_id, exercise);
        workouts.get(row.id).exercises.push(exercise);
      }
      exercises.get(row.exercise_id).sets.push({ weight: row.weight, reps: row.reps, unit: row.unit });
    }
    return [...workouts.values()];
  }

  function transaction(action) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function saveExercises(id, exercises) {
    exercises.forEach((exercise, index) => {
      const exerciseId = insertExercise.run(id, index, exercise.name).lastInsertRowid;
      exercise.sets.forEach((set, setIndex) => {
        insertSet.run(exerciseId, setIndex, set.weight, set.reps, set.unit);
      });
    });
  }

  const store = {
    list(date) { return assemble(date ? dateRows.all(date) : allRows.all()); },
    get(id) { return assemble(idRows.all(id))[0] ?? null; },
    create(workout) {
      return transaction(() => {
        const id = Number(insertWorkout.run(workout.date).lastInsertRowid);
        saveExercises(id, workout.exercises);
        return store.get(id);
      });
    },
    update(id, workout) {
      return transaction(() => {
        if (!updateWorkout.run(workout.date, id).changes) return null;
        clearExercises.run(id);
        saveExercises(id, workout.exercises);
        return store.get(id);
      });
    },
    delete(id) { return deleteWorkout.run(id).changes > 0; },
    close() { db.close(); },
  };
  return store;
}
