# Documentation Index

**Complete documentation for the ECHO/Adrishya disaster communications platform.**

---

## 🚀 Quick Start (5 minutes)

**New to the project?** Start here:

1. **[Quickstart Guide](guides/quickstart.md)** — Get a local stack running in 5 minutes
2. **[System Requirements](architecture/REQUIREMENTS.md)** — Stack, database, dependencies
3. **[Three-Module Architecture](modules/MODULES.md)** — How the system is organized

---

## 📚 Documentation by Role

### 👨‍💻 Backend Developer

- [Quickstart Guide](guides/quickstart.md) — Local setup (5 min)
- [Integration Guide](guides/INTEGRATION_GUIDE.md) — Detailed API integration
- [System Architecture](modules/MODULES.md) — Three-module overview
- [Requirements](architecture/REQUIREMENTS.md) — Stack & dependencies

### 📊 Resource Allocation Planner

- [Allocation v1 (Current)](allocation/ALLOCATION.md) — Greedy algorithm, real-time
- [Allocation v2 (Advanced)](allocation/ALLOCATION_V2.md) — Linear Programming, robust scenarios
- [Quick Reference](allocation/ALLOCATION_V2_QUICK_REF.md) — API examples
- [Migration Plan](allocation/ALLOCATION_MIGRATION.md) — Gradual v2 rollout (4 weeks)

### 📱 Mobile Developer (Flutter)

- [Battery Integration](battery/FLUTTER_BATTERY_INTEGRATION.md) — Full mobile guide
- [Battery Status](battery/BATTERY_INTEGRATION_STATUS.md) — Cloud-side endpoints

### 🚀 DevOps / Production

- [Allocation v2 Status](allocation/ALLOCATION_V2_STATUS.md) — Production readiness checklist
- [Deployment Options](allocation/ALLOCATION_V2_STATUS.md#deployment-options) — Choose your path
- [Migration Plan](allocation/ALLOCATION_MIGRATION.md) — 4-week gradual rollout

### 🔍 Researcher / Contributor

- [Integration Analysis](guides/INTEGRATION_ANALYSIS.md) — Detailed design analysis
- [Full Index](INDEX.md) — Master navigation (all documents with use cases)

---

## 📁 Documentation Structure

### `/allocation` — Resource Allocation

6 documents covering v1 (current) and v2 (advanced) allocation algorithms:

- `ALLOCATION.md` — v1 greedy algorithm (current production)
- `ALLOCATION_V2.md` — v2 linear programming (advanced, multi-scenario)
- `ALLOCATION_V2_QUICK_REF.md` — API quick reference with curl examples
- `ALLOCATION_V2_STATUS.md` — Production readiness checklist (deployment options)
- `ALLOCATION_MIGRATION.md` — Gradual 4-week rollout plan
- `ALLOCATION_INTEGRATION_SUMMARY.md` — Integration overview

### `/battery` — Battery Optimization

2 documents for mobile power management:

- `FLUTTER_BATTERY_INTEGRATION.md` — Complete Flutter integration guide
- `BATTERY_INTEGRATION_STATUS.md` — Cloud-side battery endpoints

### `/modules` — Architecture

1 document on system design:

- `MODULES.md` — Three-module architecture (DTN, battery, allocation)

### `/architecture` — System Design

1 document on technical stack:

- `REQUIREMENTS.md` — Node.js, PostgreSQL, PostGIS, dependencies

### `/guides` — Implementation

3 implementation and reference guides:

- `quickstart.md` — Get local stack running (5 min) **← Start here!**
- `INTEGRATION_GUIDE.md` — Detailed API integration walkthrough
- `INTEGRATION_ANALYSIS.md` — Deep analysis of allocation v2 design

---

## ✅ System Status

| Component | Status |
|-----------|--------|
| Backend Tests | 24/24 passing ✅ |
| Allocation v2 | Production ready ✅ |
| Battery Integration | Operational ✅ |
| Documentation | Complete ✅ |

---

## 🔗 Key Links

### API Endpoints

- **SOS Ingest:** `POST /v1/ingest/sos` (see Quickstart Step 5)
- **Allocation v1:** `POST /v1/allocate` (current, 10-15ms)
- **Allocation v2:** `POST /v1/allocate/v2` (advanced, 50-150ms, 20-30% better)
- **Compare:** `POST /v1/allocate/compare` (v1 vs v2 results)
- **Battery:** `/v1/device/battery/:device_id` (see Flutter guide)

### Quick References

- [Allocation API Examples](allocation/ALLOCATION_V2_QUICK_REF.md)
- [Flutter Integration](battery/FLUTTER_BATTERY_INTEGRATION.md)
- [Stack Requirements](architecture/REQUIREMENTS.md)

---

## 📖 Full Index

For the complete master index with **all documents, use cases, and detailed descriptions**, see **[INDEX.md](INDEX.md)**.

---

## 🎯 Suggested Learning Path

**First time?** Follow this order:

1. **5 min:** [Quickstart Guide](guides/quickstart.md) → Get local stack running
2. **10 min:** [Three-Module Architecture](modules/MODULES.md) → Understand the system
3. **20 min:** [Integration Guide](guides/INTEGRATION_GUIDE.md) → Learn the APIs
4. **Optional:** Choose your deep-dive:
   - Allocation planning → [Allocation v2 Docs](allocation/ALLOCATION_V2.md)
   - Mobile development → [Flutter Integration](battery/FLUTTER_BATTERY_INTEGRATION.md)
   - Production deployment → [Status & Deployment](allocation/ALLOCATION_V2_STATUS.md)

---

**Question? Check the [full index](INDEX.md) or [quickstart troubleshooting section](guides/quickstart.md#troubleshooting).**
