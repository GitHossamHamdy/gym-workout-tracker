import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { openStore } from './store.js';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT must be a whole number from 1 to 65535.');
  process.exit(1);
}

try {
  const filename = process.env.DB_PATH
    ? resolve(process.env.DB_PATH)
    : fileURLToPath(new URL('./data/workouts.sqlite', import.meta.url));
  const store = openStore(filename);
  const server = createApp(store).listen(port, host, () => {
    console.log(`Workout journal: http://${host}:${port}`);
    console.log('Local single-user app. No authentication; do not expose this server publicly.');
  });
  server.on('error', (error) => {
    console.error('Could not start server:', error.code ?? error.name);
    store.close();
    process.exitCode = 1;
  });
  let stopping = false;
  function shutdown() {
    if (stopping) return;
    stopping = true;
    server.close(() => store.close());
    server.closeIdleConnections();
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  console.error('Could not open workout database:', error.code ?? error.name);
  process.exitCode = 1;
}
