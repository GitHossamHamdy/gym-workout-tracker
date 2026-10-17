import express from 'express';
import { fileURLToPath } from 'node:url';
import { isCalendarDate, validateWorkout } from './validation.js';

export function createApp(store) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    next();
  });
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', express.json({ limit: '512kb' }));

  app.get('/api/workouts', (req, res) => {
    const { date } = req.query;
    if (date !== undefined && !isCalendarDate(date)) {
      return res.status(400).json({ error: 'Choose a valid date filter (YYYY-MM-DD).' });
    }
    res.json({ workouts: store.list(date) });
  });

  app.param('id', (req, res, next, value) => {
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
      return res.status(400).json({ error: 'Workout ID must be a positive whole number.' });
    }
    req.workoutId = Number(value);
    next();
  });

  app.get('/api/workouts/:id', (req, res) => {
    const workout = store.get(req.workoutId);
    if (!workout) return res.status(404).json({ error: 'Workout not found.' });
    res.json({ workout });
  });

  function save(req, res) {
    if (!req.is('application/json')) return res.status(415).json({ error: 'Send workouts as application/json.' });
    const { errors, value } = validateWorkout(req.body);
    if (errors.length) return res.status(400).json({ error: 'Please check your workout.', details: errors });
    const workout = req.method === 'POST' ? store.create(value) : store.update(req.workoutId, value);
    if (!workout) return res.status(404).json({ error: 'Workout not found. Your changes have not been saved.' });
    if (req.method === 'POST') res.location(`/api/workouts/${workout.id}`).status(201);
    res.json({ workout });
  }
  app.post('/api/workouts', save);
  app.put('/api/workouts/:id', save);
  app.delete('/api/workouts/:id', (req, res) => {
    if (!store.delete(req.workoutId)) return res.status(404).json({ error: 'Workout not found.' });
    res.sendStatus(204);
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));
  app.use((_req, res) => res.status(404).type('text').send('Page not found.'));
  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Workout is too large. Use at most 50 exercises with 50 sets each.' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON. Please check your request.' });
    if (error.status >= 400 && error.status < 500) return res.status(error.status).json({ error: 'Unable to read this request. Send valid UTF-8 JSON.' });
    console.error('Request failed:', error.code ?? error.name);
    res.status(500).json({ error: 'Unable to save or load your workout. Please try again.' });
  });
  return app;
}
