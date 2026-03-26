# ECHO / Adrishya (Human-Mesh Bharat) — Stack Requirements

Complete dependency list for the disaster communications system.

## System requirements

- **OS**: macOS, Linux, or Windows (with WSL2).
- **Docker**: Desktop (for PostGIS database).
- **Node.js**: 18+ (backend, packet generator, proof runner).
- **Python**: 3.8+ (resource allocation, battery optimization modules).

## Backend stack

### Node.js runtime + packages

**`backend/package.json`**

```json
{
  "engines": { "node": ">=18" },
  "dependencies": {
    "dotenv": "^16.4.5",       // Environment configuration
    "express": "^4.19.2",      // REST API framework
    "pg": "^8.12.0",           // PostgreSQL client
    "tweetnacl": "^1.0.3"      // Ed25519 cryptography
  }
}
```

**Installation**:

```bash
cd backend
npm install
```

### Database (PostGIS)

**Docker image**: `postgis/postgis:16-3.4`

**Setup**:

```bash
cd backend
docker compose up -d
npm run db:migrate  # Create schema + indexes
```

### Python modules (optional, embedded or subprocess)

**`backend/requirements.txt`**

Core modules (disaster_alloc.py, battery_optimization.py) use only Python stdlib.

Optional dependencies:

```python
# For future HTTP integration / data analysis
requests >= 2.28.0
pandas >= 1.5.0
flask >= 2.3.0

# Development
pytest >= 7.0.0
black >= 23.0.0
pylint >= 2.16.0
```

**Installation** (if using):

```bash
pip install -r backend/requirements.txt
```

## Tools

### Packet generator

**`tools/packetgen/package.json`**

```json
{
  "engines": { "node": ">=18" },
  "dependencies": {
    "minimist": "^1.2.8",    // CLI argument parsing
    "tweetnacl": "^1.0.3"    // Ed25519 signing
  }
}
```

**Installation**:

```bash
cd tools/packetgen
npm install
```

## Quick start (from zero)

```bash
# 1) Ensure Docker Desktop is running
docker info >/dev/null 2>&1 || (open -a Docker && echo 'Starting Docker Desktop...')

# 2) Backend: install + DB
cd backend
npm install
docker compose up -d
npm run db:migrate

# 3) Start backend
npm start

# 4) Verify (proof runner)
npm run proof

# 5) Optional: send test packet
cd ../tools/packetgen
npm install
node send_sos.mjs --url http://127.0.0.1:3000

# 6) View logs
cd ../backend
npm run logs:show -- --limit 25
```

## Development

### Format / lint

```bash
cd backend

# Node.js linting (ESLint config via package.json)
# (not included by default; add if needed)
npm install --save-dev eslint

# Python formatting (optional)
pip install black pylint
black src/*.py
pylint src/*.py
```

### Run tests

```bash
cd backend
npm test                 # Unit tests (Node)
python3 -m pytest src/   # Unit tests (Python, if pytest installed)
```

### Run allocation example

```bash
cd backend
npm run allocate:example  # Runs src/allocation_example.py
```

## Deployment

### Cloud backend

- **Runtime**: Node.js 18+ (Lambda, Cloud Run, App Engine, EC2, etc.).
- **Database**: Managed PostgreSQL with PostGIS extension.
- **Environment variables**: see `backend/.env.example`.

### Edge nodes (ESP32)

- **Firmware**: FreeRTOS or Arduino-based.
- **Libraries**: BLE stack, LoRa driver (SX127x), NVS storage.
- **No dependencies**: battery_optimization.py logic ported to C/embedded Python.

### Mobile SDK

- **Android**: Native BLE API + Ed25519 signing (Tink or BoringSSL).
- **iOS**: Core Bluetooth + CryptoKit (Ed25519 support >= iOS 14).
- **Cross-platform**: React Native with native modules.

## Troubleshooting

### Docker not running

```bash
open -a Docker  # macOS
# or start Docker Desktop manually
```

### Node version mismatch

```bash
node -v  # Check version
# Install 18+ via nvm, homebrew, or nodejs.org
```

### Python not found

```bash
python3 --version  # Check installation
# Install via homebrew, conda, or python.org
```

### Port 3000 in use

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
kill <PID>
```

### PostGIS migration fails

```bash
# Check database is running
docker compose ps

# View logs
docker compose logs db

# Ensure DATABASE_URL is set or uses default
export DATABASE_URL=postgres://echo:echo@localhost:5432/echo
npm run db:migrate
```

## Architecture reference

- **Layer 1–3**: BLE/LoRa/vehicle DTN (firmware level).
- **Layer 4**: Cloud backend (Node.js + PostGIS + allocation).
- **Communication module**: `README.md` (protocol + constraints).
- **Battery optimization**: `MODULES.md` + `backend/src/battery_optimization.py`.
- **Resource allocation**: `ALLOCATION.md` + `backend/src/disaster_alloc.py`.

---

See `quickstart.md` for step-by-step setup and `MODULES.md` for system architecture.
