# 🛡️ DRI & CA — Disaster Resilience Intelligence API

Backend API for the **Disaster Resilience Intelligence & Community Awareness** module. Built for the Kerala Disaster Resilience Hackathon.

**Tech Stack:** Node.js (ESM) · Express 4 · PostgreSQL 14+ · PostGIS 3+

---

## Quick Start

### 1. Prerequisites
- **Node.js** ≥ 18.0
- **PostgreSQL** ≥ 14 with **PostGIS** extension installed locally
- **npm** ≥ 9.0

### 2. Database Setup

```bash
# Create the database
psql -U postgres -c "CREATE DATABASE dri_db;"

# Run schema + seed data
psql -U postgres -d dri_db -f ../database/init/001_schema.sql
psql -U postgres -d dri_db -f ../database/init/002_alerts.sql
psql -U postgres -d dri_db -f ../database/init/003_historic_disasters.sql
psql -U postgres -d dri_db -f ../database/init/004_expanded_zones.sql
```

### 3. Environment Config

```bash
copy .env.example .env
# Edit .env with your PostgreSQL credentials
```

### 4. Install & Run

```bash
npm install
npm run dev
```

The server starts at **http://localhost:4000**

- 📖 **Swagger Docs:** http://localhost:4000/api/docs
- 💚 **Health Check:** http://localhost:4000/api/v1/health

---

## API Endpoints

All endpoints are versioned under `/api/v1/`.

### 🔍 Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/health` | Server status, DB connectivity, available endpoints |

### 📍 Feasibility (PostGIS Spatial Queries)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/feasibility` | Run site feasibility check against hazard zones |
| `GET` | `/api/v1/feasibility/history` | Paginated history of past checks |
| `GET` | `/api/v1/feasibility/:id` | Retrieve a specific past check |

### 🗺️ Zones
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/zones/flood` | All flood zones with GeoJSON geometry |
| `GET` | `/api/v1/zones/landslide` | All landslide zones with GeoJSON geometry |
| `GET` | `/api/v1/zones/stats` | Aggregate zone statistics |

### 🧠 Remediation (XAI Engine)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/remediation` | Generate explainable remediation recommendations |
| `GET` | `/api/v1/remediation/guidelines` | Full knowledge base for audit/reference |

### 📝 Simplification
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/simplify` | Simplify technical jargon to layperson language |
| `GET` | `/api/v1/simplify/glossary` | Full domain glossary (40+ terms) |

### 🌐 Translation (Bhashini NMT/TTS)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/translate` | Translate text (default: English → Malayalam) |
| `POST` | `/api/v1/translate/tts` | Text-to-Speech (base64 WAV audio) |
| `GET` | `/api/v1/translate/languages` | Supported languages & config status |

### 🚨 Community Alerts
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/alerts` | Create a new community alert |
| `GET` | `/api/v1/alerts` | List active alerts (filterable by type, district, severity) |
| `GET` | `/api/v1/alerts/:id` | Get specific alert detail |
| `PATCH` | `/api/v1/alerts/:id/verify` | Mark an alert as verified |

### 🌦️ Seasonal Tips
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/tips/current` | Tips for the current season |
| `GET` | `/api/v1/tips/seasons` | Overview of all 4 seasons |
| `GET` | `/api/v1/tips/:season` | Tips for a specific season |

---

## cURL Examples

### Feasibility Check (Aluva, Ernakulam — inside flood zone)
```bash
curl -X POST http://localhost:4000/api/v1/feasibility \
  -H "Content-Type: application/json" \
  -d '{"latitude": 10.10, "longitude": 76.40, "buildingType": "residential"}'
```

### Feasibility Check (Safe location — outside all zones)
```bash
curl -X POST http://localhost:4000/api/v1/feasibility \
  -H "Content-Type: application/json" \
  -d '{"latitude": 8.50, "longitude": 76.95, "buildingType": "commercial"}'
```

### Generate XAI Remediation (from check ID)
```bash
curl -X POST http://localhost:4000/api/v1/remediation \
  -H "Content-Type: application/json" \
  -d '{"checkId": 1}'
```

### Generate XAI Remediation (direct input)
```bash
curl -X POST http://localhost:4000/api/v1/remediation \
  -H "Content-Type: application/json" \
  -d '{
    "buildingType": "residential",
    "overallRisk": "high",
    "latitude": 10.10,
    "longitude": 76.40,
    "floodRisk": { "found": true, "zones": [{"risk_level": "high"}] },
    "landslideRisk": { "found": false, "zones": [] }
  }'
```

### Simplify Technical Text
```bash
curl -X POST http://localhost:4000/api/v1/simplify \
  -H "Content-Type: application/json" \
  -d '{"text": "Implement dynamic earth pressure retaining walls and deep soil nailing to mitigate pore-water pressure and alter the mechanical characteristics of the unstable lateritic mass."}'
```

### Translate to Malayalam
```bash
curl -X POST http://localhost:4000/api/v1/translate \
  -H "Content-Type: application/json" \
  -d '{"text": "Build strong retaining walls designed to withstand shaking.", "sourceLang": "en", "targetLang": "ml"}'
```

### Create Community Alert
```bash
curl -X POST http://localhost:4000/api/v1/alerts \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Flooding near Aluva bridge",
    "description": "Water level rising rapidly near the Aluva Manappuram bridge. Periyar River has breached warning level.",
    "alert_type": "flood",
    "severity": "warning",
    "district": "Ernakulam",
    "latitude": 10.1004,
    "longitude": 76.3570,
    "reported_by": "local_resident"
  }'
```

### List Alerts (filtered)
```bash
curl "http://localhost:4000/api/v1/alerts?type=flood&district=Ernakulam&page=1&limit=10"
```

### Get Current Season Tips
```bash
curl http://localhost:4000/api/v1/tips/current
```

### Get Monsoon-Specific Tips
```bash
curl http://localhost:4000/api/v1/tips/monsoon
```

### Get All Flood Zones (GeoJSON)
```bash
curl http://localhost:4000/api/v1/zones/flood
```

---

## XAI — Explainable AI

The remediation engine is **NOT a black-box LLM**. It uses a transparent, rule-based decision tree where every recommendation includes:

| Field | Description |
|-------|-------------|
| `reason` | WHY this recommendation applies to this specific site |
| `source` | Which KSDMA/PDNA/UNDP guideline document it comes from |
| `confidence` | How strongly the rule matched (0.0 – 1.0) |
| `guideline_ref` | Specific section/page reference for verification |
| `reasoning_chain` | Step-by-step trace of how the engine arrived at its conclusions |

**Knowledge Base:** 13+ remediation rules sourced from:
- Earthquake Handbook Edition 2 (Seismic Zone III Mitigation)
- Orange Book of Disaster Management 2025 (Coastal & Cyclonic Resilience)
- KSDMA PDNA Report 2019
- UNDP Shelter Project — Surakshitha Bhavana Nirmanam handbook
- COSTFORD Guidelines
- IS 14680:1999 (Landslide Control)
- IS 2878:1975 (Buildings in Flood-Prone Areas)
- IS 1893:2016 (Criteria for Earthquake Resistant Design)
- Geological Survey of India (GSI)
- KSDMA Nature-Based Solutions Guidelines

---

## Bhashini Translation

Integrates with [Digital India Bhashini](https://bhashini.gov.in/) for:
- **NMT:** Neural Machine Translation (English ↔ Malayalam, Hindi, Tamil, Kannada)
- **TTS:** Text-to-Speech (Malayalam, English, Hindi)

**Setup:**
1. Register at https://bhashini.gov.in/
2. Add `BHASHINI_USER_ID` and `BHASHINI_API_KEY` to `.env`

**No credentials?** The API returns mock translations with a warning flag, so development continues unblocked.

---

## Response Format

All endpoints return consistent JSON:

```json
// Success
{
  "success": true,
  "data": { ... },
  "meta": { "pagination": { ... } }  // optional
}

// Error
{
  "success": false,
  "error": {
    "message": "Human-readable error message",
    "code": "MACHINE_READABLE_CODE",
    "details": ["field-level errors"]
  }
}
```

---

## Project Structure

```
server/
├── src/
│   ├── index.js                 # Express entry (all routes mounted)
│   ├── config/
│   │   ├── db.js                # PostgreSQL + PostGIS pool
│   │   └── constants.js         # Enums, building types, seasons
│   ├── middleware/
│   │   ├── errorHandler.js      # Centralized error handling
│   │   ├── validate.js          # Schema-based request validation
│   │   └── rateLimiter.js       # Rate limiting
│   ├── routes/
│   │   ├── feasibility.js       # POST/GET feasibility checks
│   │   ├── zones.js             # GeoJSON zone listing + stats
│   │   ├── remediation.js       # XAI recommendations
│   │   ├── simplify.js          # Jargon simplification
│   │   ├── translate.js         # Bhashini NMT/TTS
│   │   ├── alerts.js            # Community alerts CRUD
│   │   └── tips.js              # Seasonal awareness tips
│   ├── services/
│   │   ├── xaiEngine.js         # Explainable AI decision engine
│   │   ├── simplifier.js        # Domain glossary + text processor
│   │   ├── bhashiniClient.js    # Bhashini API client
│   │   └── seasonalTips.js      # Seasonal tip knowledge base
│   └── utils/
│       ├── apiResponse.js       # Standardized response helpers
│       └── logger.js            # Structured logging
├── docs/
│   └── openapi.yaml             # OpenAPI 3.0 specification
├── .env.example                 # Environment variable template
├── package.json
└── README.md                    # This file
```

---

## License

MIT
