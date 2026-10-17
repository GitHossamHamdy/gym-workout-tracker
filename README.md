# Form — Workout journal

A small, mobile-friendly, single-user workout journal. Log a calendar date, add exercises and sets, and revisit, edit, or delete past workouts. Each set stores its own weight, reps, and kg/lb unit.

## Run locally

1. Install **Node.js 24.21.0 or later** (tested with 24.21.0; `.nvmrc` pins that version). With nvm, run `nvm install` then `nvm use`.
2. From this repository, run `npm ci`.
3. Run `npm start` and open **http://127.0.0.1:3000**.
4. Stop with Ctrl+C. Workouts remain in SQLite and return on the next start.

There is no build step. `npm run dev` restarts the server on file changes. Express is the only package dependency; SQLite uses Node's built-in `node:sqlite`, so no native driver/build tooling is needed.

**There is no authentication.** Local `npm start` binds to `127.0.0.1` by default; another device cannot connect to that listener. Containers explicitly set `HOST=0.0.0.0` so container networking works, not to make the app public. Anyone with network access to the app can read or change workouts. Never expose it externally without authentication, TLS, and reverse-proxy protection.

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
- Optional environment variables: `HOST` (bind address; default/empty `127.0.0.1`, containers use `0.0.0.0`), `PORT` (1–65535, default 3000), and `DB_PATH` (SQLite file location; relative paths resolve from your working directory). No `.env` loader is needed.
- To back up, stop the server and copy the database file somewhere private. To restore, stop the server and replace that file with your backup.
- Data stays on the host or persistent volume you choose; there are no accounts, analytics, cloud services, or external UI resources. SQLite is not encrypted; protect the host, storage, and backups accordingly.
- This first version is intended for one local user, not concurrent editing across tabs: the last saved edit wins. History loads all matching workouts; large-scale pagination, offline/PWA support, charts, and synchronization are not included.

## Docker

Build and run with a disposable image tag and a persistent named volume:

```sh
docker build -t workout-tracker:local .
docker volume create workout-tracker-data
docker run --name workout-tracker --detach --read-only --cap-drop=ALL --security-opt=no-new-privileges --publish 127.0.0.1:3000:3000 --mount source=workout-tracker-data,target=/data workout-tracker:local
```

Open **http://127.0.0.1:3000**. `docker stop workout-tracker` sends SIGTERM directly to Node for clean shutdown; `docker start workout-tracker` reuses the stored workouts. Removing the container does not remove the named volume. Do not delete that volume unless you intend to erase its data.

The image pins Node **24.21.0-bookworm-slim** and its verified multi-platform digest, installs only locked production dependencies with `npm ci --omit=dev`, and runs as **UID/GID 1000**. Review/rebuild the base image deliberately when updating Node or OS security fixes. `.dockerignore` allowlists runtime files, excluding dependencies, Git history, data, and secret/env files. Never put credentials in `public/` (those files are served to users).

`HOST=0.0.0.0`, `PORT=3000`, and `DB_PATH=/data/workouts.sqlite` are explicit image defaults. The entire `/data` directory must be writable by UID/GID 1000, including SQLite's adjacent `-wal` and `-shm` files. Fresh Docker named volumes inherit the image directory's ownership; pre-existing volumes or bind mounts must already have suitable permissions. No root startup/init container is required. Only use synthetic data for deployment smoke tests.

## Kubernetes (your own cluster)

The `k8s/` examples create **one** Deployment, a **LoadBalancer Service on port 3000**, and a **1 Gi ReadWriteOnce PVC**. They do not specify a namespace, credentials, registry, Ingress, static external IP, TLS configuration, or storage class.

**The app has no authentication or TLS.** A LoadBalancer can make every workout readable and writable by anyone who can reach it. Restrict access and provide authentication/TLS protection before exposing real data.

1. The Deployment uses Docker Hub image `hossameldinhamdy2008/gym-app:latest` with `imagePullPolicy: Always` so newly started pods resolve the mutable tag. Before deploying, confirm the image is available and built for your cluster's CPU architecture; prefer an immutable digest for reproducible releases. Building locally does not publish an image.
2. Select your own kube context and namespace. Confirm a suitable default storage class or pre-provisioned PV can satisfy the PVC. Use a SQLite-compatible filesystem with working file locks and shared memory, not NFS/SMB. The storage driver must honor `fsGroup: 1000`; otherwise ask your storage administrator to provision writable UID/GID 1000 storage, not a privileged/root init-container workaround.
3. Review the rendered resources, then deploy **only when you choose**:

```sh
kubectl kustomize k8s
kubectl apply -k k8s
kubectl rollout status deployment/workout-tracker
kubectl get service workout-tracker
kubectl port-forward --address 127.0.0.1 service/workout-tracker 3000:3000
```

Check **EXTERNAL-IP** in `kubectl get service workout-tracker`; it may be an IP address or hostname. A working LoadBalancer implementation/cloud controller is required, otherwise the address may stay `<pending>`. Once access is protected/restricted, use that address on port **3000** (the app itself serves plain HTTP; supply TLS termination separately).

Optional localhost access remains **http://127.0.0.1:3000** while port-forward runs. Port-forward does not disable the LoadBalancer or protect its external endpoint.

**Do not scale horizontally or add an autoscaler.** SQLite WAL is a local, single-writer database, not a shared multi-pod service; ReadWriteOnce alone does not prevent multiple pods on the same node. `replicas: 1` with `strategy: Recreate` avoids overlapping pods during updates, at the cost of brief downtime. Keep the same PVC across restarts and stop the app before backups/restores; deleting the PVC may permanently delete workouts depending on the PV's reclaim policy.

Probes use the existing **GET /** UI route without returning workout/database details or writing data. SQLite schema setup occurs once before listening, never as a readiness side effect. Startup allows approximately 60 seconds; readiness/liveness check HTTP responsiveness, not ongoing database integrity. Requests/limits are conservative starting points, not measured capacity guarantees. The pod drops capabilities, disables privilege escalation and service-account token mounting, uses a read-only image filesystem, and allows 30 seconds for clean SIGTERM shutdown.

These are generic deployment examples, not a deployment service. No image is published or cluster changed by building the image or rendering manifests.

## Checks

- `npm test` — built-in Node test runner: API CRUD, invalid inputs, ordering/filtering, calendar dates, mixed units, SQL-like names, transaction rollback, cascade deletion, and persistence after reopening SQLite. A real `server.js` child process also checks default/empty/configured `HOST` binding, HTTP CRUD, SQLite WAL/shared-memory creation, clean SIGTERM shutdown, and persistence across restart using disposable synthetic data.
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
