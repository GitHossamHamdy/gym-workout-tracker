# Form — Workout journal

A small, mobile-friendly, single-user workout journal. Log a calendar date, add exercises and sets, and revisit, edit, or delete past workouts. Each set stores its own weight, reps, and kg/lb unit.

## Run locally

1. Install **Node.js 24.21.0 or later** (tested with 24.21.0; `.nvmrc` pins that version). With nvm, run `nvm install` then `nvm use`.
2. From this repository, run `npm ci`.
3. Run `npm start` and open **http://127.0.0.1:3000**.
4. Stop with Ctrl+C. Workouts remain in SQLite and return on the next start.

There is no build step. `npm run dev` restarts the server on file changes. Express is the only package dependency; SQLite uses Node's built-in `node:sqlite`, so no native driver/build tooling is needed.

**Local use only: there is no authentication.** The server always binds to `127.0.0.1`, not the public network. Do not expose it through a proxy, tunnel, or public deployment. Anyone with access to this computer/server can read or change workouts. The responsive UI is not a hosted phone app; another device cannot connect to the default loopback listener.

## Using the journal

- Pick the workout's calendar date, name an exercise, and enter weight and reps for each set. Add more exercises or sets as needed.
- Decimal weights and 0 for bodyweight are supported. Reps must be positive whole numbers. Each workout needs at least one exercise and each exercise at least one set.
- Choose kg/lb per set. **New set unit** only sets the default for newly added sets; it does not relabel or convert existing weights.
- History is newest date first. Filter to one date or choose **Show all**. Multiple workouts on the same date are allowed.
- **Edit** fills the form with a past workout; **Save changes** updates it. **Delete** asks for confirmation and cannot be undone.
- Errors preserve entered form values. Leaving or replacing an unsaved workout prompts for confirmation. Unsaved drafts are not stored across reloads.

Limits: 50 exercises per workout, 50 sets per exercise, 100 characters per exercise name, weights from 0 to 100,000, and 1–10,000 reps. Dates are stored as literal `YYYY-MM-DD` strings, never shifted through a time zone. Units are recorded, not converted.

## Storage and configuration

- Default database: `data/workouts.sqlite`, created automatically. SQLite journals, databases, `data/`, and `node_modules/` are ignored by Git. No sample or real workout data is included.
- Optional environment variables: `PORT` (1–65535, default 3000) and `DB_PATH` (SQLite file location; relative paths resolve from your working directory). No `.env` loader is needed.
- To back up, stop the server and copy the database file somewhere private. To restore, stop the server and replace that file with your backup.
- All data stays on this computer; there are no accounts, analytics, cloud services, or external UI resources. SQLite is not encrypted; protect the computer and backups accordingly.
- This first version is intended for one local user, not concurrent editing across tabs: the last saved edit wins. History loads all matching workouts; large-scale pagination, offline/PWA support, charts, and synchronization are not included.

## Checks

- `npm test` — built-in Node test runner: API CRUD, invalid inputs, ordering/filtering, calendar dates, mixed units, SQL-like names, transaction rollback, cascade deletion, and persistence after reopening SQLite. A real `server.js` child process also checks HTTP startup, CRUD, clean shutdown, and persistence across restart using disposable synthetic data.
- `npm run check` — syntax checks for server and browser JavaScript.
- `npm audit --omit=dev` — dependency vulnerability check.
- GitHub Actions runs syntax checks and tests with Node 24.21.0 in UTC, America/Los_Angeles, and Pacific/Auckland. Workflow permissions are read-only.

Tests use temporary databases or in-memory SQLite, never the default workout database. No browser automation or visual browser verification is included.

## API

All API responses disable caching. POST/PUT require `Content-Type: application/json`; validation errors return JSON with `error` and, when applicable, `details`.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/workouts` | `{ workouts: [...] }`, newest date first |
| GET | `/api/workouts?date=YYYY-MM-DD` | Workouts on the exact calendar date |
| GET | `/api/workouts/:id` | `{ workout: ... }`, or 404 |
| POST | `/api/workouts` | Create; 201 with a Location header |
| PUT | `/api/workouts/:id` | Replace a workout atomically; 200, or 404 |
| DELETE | `/api/workouts/:id` | Delete workout and nested records; 204, or 404 |

POST/PUT shape: `{ "date": "2026-01-15", "exercises": [{ "name": "Example exercise", "sets": [{ "weight": 12.5, "reps": 8, "unit": "kg" }] }] }`.

Successful reads include numeric `id`, `date`, `createdAt`, `updatedAt`, and ordered `exercises`/`sets`. SQL values are parameterized; exercise names are rendered as text, not HTML. Invalid requests return 400 (validation/JSON), 413 (over 512 KiB), or 415 (wrong content type); unexpected storage errors return a generic 500 without database details.
