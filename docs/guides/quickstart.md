# Quickstart Guide

**Get a local disaster communications stack running in 5 minutes.**

This guide walks you through:

1. Starting the database (PostGIS)
2. Running the backend server
3. Ingesting a signed SOS message
4. Verifying the proof chain
5. Querying the event log

## Prerequisites

**Required:**

- macOS or Linux (guide uses `zsh`)
- Docker Desktop (running and fully initialized)
- Node.js 18+ (`node --version` to check)
- Git (to clone/access the repo)

**Optional:**

- PostgreSQL client (`psql`) — for direct DB queries
- `curl` — for manual API testing

**Repo structure referenced below:**

- Backend server: `backend/`
- Test packet generator: `tools/packetgen/`
- Documentation: `docs/`

---

## Step 0: Start Docker Desktop

**Why:** The backend requires PostgreSQL with PostGIS extension.

```zsh
docker info >/dev/null 2>&1 || (open -a Docker && echo 'Starting Docker Desktop...')
```

**Wait:** Watch the Docker menu icon in the top-right until it stops animating. This usually takes 30–60 seconds.

**Verify:** Once running:

```zsh
docker ps
```

Should show an empty table (no containers yet). If you get a connection error, Docker isn't fully initialized yet.

---

## Step 1: Start the PostgreSQL Database

**Why:** Backend needs a persistent PostGIS database for SOS records and event logs.

```zsh
cd backend/
docker compose up -d
```

**Verify:** Check that the container started:

```zsh
docker ps | grep postgres
```

You should see a container named `fuzzy-spoon-db-1` with status `Up`.

**Wait:** The first startup can take 10–15 seconds as PostGIS extensions are installed. Subsequent starts are instant.

---

## Step 2: Install Dependencies & Run Migrations

**Why:** Node dependencies provide Express, database drivers, etc. Migrations set up the schema.

```zsh
cd backend/
npm install
npm run db:migrate
```

**What this does:**

- Installs packages from `package.json`
- Creates two database tables:
  - `sos_messages` — ingested signed SOS records
  - `event_logs` — structured audit logs (auth, ingest, errors, etc.)

**Expected output:**

```
✓ tables ready: sos_messages, event_logs
```

**(Optional) Set custom DB credentials:**

If you want to use different credentials:

```zsh
cp .env.example .env
# Edit .env and set DATABASE_URL
```

Defaults (if no `.env` file):

- Host: `localhost:5432`
- User: `echo`
- Password: `echo`
- Database: `echo`

These match the `docker-compose.yml` settings.

---

## Step 3: Start the Backend Server

**Why:** This is the disaster communications ingestion & allocation service.

**Important:** Use `127.0.0.1` for URLs (avoids IPv6 quirks on macOS).

### Option A: Run in Foreground (Recommended for Learning)

Run in the terminal so you can see logs in real-time:

```zsh
cd backend/
LOG_LEVEL=info LOG_DB_LEVEL=info LOG_TO_DB=1 PORT=3000 npm start
```

You should see:

```
Server running on port 3000
Postgres connected at postgres://echo:echo@localhost:5432/echo
```

**Health check (in a new terminal):**

```zsh
curl -sS http://127.0.0.1:3000/healthz | jq .
```

Expected response:

```json
{
  "ok": true,
  "timestamp": "2026-03-27T..."
}
```

### Option B: Run in Background (For Testing)

Keep the server running while you use other terminals:

```zsh
cd backend/
LOG_LEVEL=error LOG_DB_LEVEL=info LOG_TO_DB=1 PORT=3000 node src/index.mjs > /tmp/echo-backend.log 2>&1 &
echo $! > /tmp/echo-backend.pid
```

Watch the logs:

```zsh
tail -f /tmp/echo-backend.log
```

Stop the server later (see "Stop the System" section).

---

## Step 4: Verify the System (Proof Chain)

**Why:** This automated test demonstrates the backend is working correctly—validating signatures, rejecting tampering, and logging everything.

**From the `backend/` directory (with server still running):**

```zsh
cd backend/
npm run proof
```

**What this does:**

1. Checks `/healthz` endpoint → OK
2. Sends a **valid signed SOS** → Accepted (200)
3. Replays the same SOS → Rejected as duplicate (409)
4. Sends a **tampered SOS** → Rejected for invalid signature (401)
5. Queries `/v1/sos/recent` → Shows ingested messages
6. Queries `event_logs` table → Prints audit trail

**Expected output:**

```
✓ health check passed
✓ valid SOS accepted
✓ replay rejected (duplicate)
✓ tamper rejected (signature failure)
✓ SOS records: 1 accepted, 2 rejected
EVIDENCE: event_logs
  sos_accepted
  sos_duplicate
  sos_rejected (invalid_signature)
  http_request
```

**If this passes, your stack is working correctly.** ✅

---

## Step 5: Send a Packet Manually (Optional Deep-Dive)

**Why:** Understand how SOS packets are created, signed, and sent.

The packet generator tool lets you craft custom SOS messages:

```zsh
cd tools/packetgen/
npm install
```

**Send a valid signed SOS:**

```zsh
node send_sos.mjs --url http://127.0.0.1:3000
```

Expected: `✓ SOS accepted (200)`

**Send a tampered SOS (to test rejection):**

```zsh
node send_sos.mjs --url http://127.0.0.1:3000 --tamper
```

Expected: `✗ SOS rejected (401 Unauthorized - signature verification failed)`

**Behind the scenes:**

- Each SOS contains a timestamp, device ID, and message hash
- The `--tamper` flag modifies the message but leaves the signature unchanged
- Backend verifies the signature using TweetNaCl and rejects mismatches
- Both attempts are logged in `event_logs` table for audit

---

## Step 6: Query the Audit Log

**Why:** See the full history of system events in a structured, queryable format.

Instead of tailing text logs, pull structured events from the database:

```zsh
cd backend/
npm run logs:show -- --limit 25
```

**Example output:**

```
Event Log (last 25 events)
────────────────────────────────────────────────────────────────────────
Timestamp         | Event Type      | Details
────────────────────────────────────────────────────────────────────────
2026-03-27 14:23  | http_request    | POST /v1/ingest/sos
2026-03-27 14:23  | sos_accepted    | device_123, timestamp_1234567890
2026-03-27 14:23  | http_request    | POST /v1/ingest/sos (replay)
2026-03-27 14:23  | sos_duplicate   | duplicate of device_123
2026-03-27 14:23  | http_request    | POST /v1/ingest/sos (tampered)
2026-03-27 14:23  | sos_rejected    | invalid_signature
```

**Common event types:**

- `http_request` — incoming request
- `sos_accepted` — valid signed message ingested
- `sos_duplicate` — replay attempt detected
- `sos_rejected` — invalid signature or format
- `allocation_computed` — resource routing calculated

**Query from psql directly (advanced):**

```bash
psql -h localhost -U echo -d echo -c "SELECT event_type, details, created_at FROM event_logs ORDER BY created_at DESC LIMIT 10;"
```

---

## Step 7: Query SOS Records

**Why:** See which SOS messages have been accepted and persisted.

```zsh
curl -sS "http://127.0.0.1:3000/v1/sos/recent?limit=5" | jq .
```

**Example response:**

```json
{
  "sos_messages": [
    {
      "id": "abc123",
      "device_id": "device_001",
      "timestamp": "2026-03-27T14:23:45Z",
      "location": {
        "latitude": 12.9352,
        "longitude": 77.6245,
        "accuracy_meters": 10
      },
      "severity": "CRITICAL",
      "message": "Medical emergency - need supplies",
      "ingested_at": "2026-03-27T14:23:47Z"
    }
  ],
  "count": 1
}
```

**This shows:**

- ✅ Messages are being persisted
- ✅ Signature verification worked (only valid messages appear)
- ✅ Timestamps and locations are intact
- ✅ Spatial indexing is ready for allocation queries

---

## Stop the System

**Stop the backend (if running in background):**

```zsh
test -f /tmp/echo-backend.pid && kill "$(cat /tmp/echo-backend.pid)" || true
rm -f /tmp/echo-backend.pid
```

**Stop the database and clean up:**

```zsh
cd backend/
docker compose down
```

**Remove all data (fresh start next time):**

```zsh
docker compose down -v
```

Note: `-v` removes the database volume, so all SOS records and logs are deleted. Useful for testing.

---

## Troubleshooting

### Port Already in Use

**Error:** `Error: listen EADDRINUSE: address already in use :::3000`

**Solution:** Kill the existing process on port 3000:

```zsh
lsof -i :3000
kill -9 <PID>
```

Or use a different port:

```zsh
PORT=3001 npm start
```

### Docker Daemon Not Running

**Error:** `Cannot connect to Docker daemon`

**Solution:**

1. Open Docker Desktop from Applications
2. Wait for the icon to stop animating
3. Verify: `docker ps` (should show empty table)

### Database Connection Failed

**Error:** `connect ECONNREFUSED 127.0.0.1:5432`

**Solution:**

1. Check container is running: `docker ps | grep postgres`
2. If not, restart: `docker compose up -d`
3. Wait 10 seconds for PostGIS extension to initialize
4. Check logs: `docker compose logs db`

### Node Version Mismatch

**Error:** `node: v16.x.x (requires >=18)`

**Solution:**

```zsh
node -v            # Check current version
nvm install 18     # Install Node 18 (if using nvm)
nvm use 18         # Switch to Node 18
```

### npm install Fails

**Error:** `npm ERR! code ERESOLVE or peer dependency warnings`

**Solution:**

```zsh
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps
```

### Proof Test Fails

**If `npm run proof` returns errors:**

1. Check backend is running: `curl -sS http://127.0.0.1:3000/healthz | jq .`
2. Check database is connected: `docker compose logs db | tail -20`
3. Check migrations ran: `npm run db:migrate`
4. If still failing, review Step 4 output for specific error messages

### "psql: command not found"

**Solution:** Install PostgreSQL client tools (macOS):

```zsh
brew install postgresql
```

---

## Next Steps

✅ **Local stack working?** Explore:

- **Resource Allocation:** See [Allocation v2 API](../allocation/ALLOCATION_V2_QUICK_REF.md)
- **Battery Integration:** See [Flutter Guide](../battery/FLUTTER_BATTERY_INTEGRATION.md)
- **Deployment:** See [Allocation Status](../allocation/ALLOCATION_V2_STATUS.md)
- **Full API Docs:** See [Architecture](../architecture/REQUIREMENTS.md)
- **Master Documentation:** See [Documentation Index](../INDEX.md)
