# Quickstart (cold start)

This is a **from-zero** runbook for the reference implementation in this repo.

Goal: get a local stack running (PostGIS + backend), ingest an SOS, and generate **proof + queryable logs**.

## Prereqs

- macOS + `zsh`
- Docker Desktop (daemon running)
- Node.js 18+ (`node -v`)

Repo layout used below:

- Backend: `backend/`
- Packet generator (client): `tools/packetgen/`

## 0) Start Docker Desktop (if needed)

```zsh
docker info >/dev/null 2>&1 || (open -a Docker && echo 'Starting Docker Desktop...')
```

Wait until Docker is fully up (Docker icon stops “starting”).

## 1) Start the database (PostGIS)

```zsh
cd /Users/rizzy/Documents/GitHub/fuzzy-spoon/backend
docker compose up -d
```

## 2) Install backend deps + migrate schema

```zsh
cd /Users/rizzy/Documents/GitHub/fuzzy-spoon/backend
npm install
npm run db:migrate
```

Optional: copy env file (defaults are already fine for local Docker DB):

```zsh
cd /Users/rizzy/Documents/GitHub/fuzzy-spoon/backend
cp .env.example .env
```

This creates/updates:

- `sos_messages` (ingested SOS)
- `event_logs` (structured logs in Postgres)

Default DB connection (if you don’t set `DATABASE_URL`):

- `postgres://echo:echo@localhost:5432/echo`

## 3) Start the backend (stable way)

Important: use `127.0.0.1` in client URLs (avoid `localhost` IPv6 quirks).

### Option A — foreground (simple)

```zsh
cd /Users/rizzy/Documents/GitHub/fuzzy-spoon/backend
LOG_LEVEL=info LOG_DB_LEVEL=info LOG_TO_DB=1 PORT=3000 npm start
```

### Option B — background with a log file (easy evidence)

```zsh
cd /Users/rizzy/Documents/GitHub/fuzzy-spoon/backend
LOG_LEVEL=error LOG_DB_LEVEL=info LOG_TO_DB=1 PORT=3000 node src/index.mjs > /tmp/echo-backend.log 2>&1 &
echo $! > /tmp/echo-backend.pid
```

Health check:

```zsh
curl -sS http://127.0.0.1:3000/healthz | cat
```

Expected: `{"ok":true}`

## 4) One-command “proof” (PASS/FAIL + DB log evidence)

This runs:

- `/healthz`
- ingest valid → 200
- replay → 409
- tamper → 401
- `/v1/sos/recent`
- prints `EVIDENCE event_logs ...` from Postgres

```zsh
cd /Users/rizzy/Documents/GitHub/fuzzy-spoon/backend
npm run proof
```

## 5) Send a packet manually (optional)

```zsh
cd /Users/rizzy/Documents/GitHub/fuzzy-spoon/tools/packetgen
npm install

# valid send
node send_sos.mjs --url http://127.0.0.1:3000

# demonstrate signature rejection
node send_sos.mjs --url http://127.0.0.1:3000 --tamper
```

## 6) Showcase logs “intelligently” (query Postgres)

Instead of tailing a file, pull structured events from `event_logs`:

```zsh
cd /Users/rizzy/Documents/GitHub/fuzzy-spoon/backend
npm run logs:show -- --limit 25
```

You should see events like:

- `http_request`
- `sos_accepted`
- `sos_duplicate`
- `sos_rejected` (e.g. `invalid_signature`)

## 7) Show persisted SOS records

```zsh
curl -sS "http://127.0.0.1:3000/v1/sos/recent?limit=5" | cat
```

## Stop / cleanup

### Stop backend (if background)

```zsh
test -f /tmp/echo-backend.pid && kill "$(cat /tmp/echo-backend.pid)" || true
```

### Stop database

```zsh
cd /Users/rizzy/Documents/GitHub/fuzzy-spoon/backend
docker compose down
```

## Troubleshooting

### Docker isn’t running

- Symptom: `Cannot connect to the Docker daemon`
- Fix:

```zsh
open -a Docker
```

### Port 3000 is already in use

```zsh
lsof -nP -iTCP:3000 -sTCP:LISTEN
# then kill the PID
kill <PID>
```

### `localhost` fails but `127.0.0.1` works

Use `http://127.0.0.1:3000` in:

- `tools/packetgen/send_sos.mjs --url ...`
- `ECHO_URL=... npm run proof`

### Proof can’t reach the DB

- If you set a custom DB, export `DATABASE_URL` before `npm run proof` / `npm run logs:show`.
- Default is `postgres://echo:echo@localhost:5432/echo`.
