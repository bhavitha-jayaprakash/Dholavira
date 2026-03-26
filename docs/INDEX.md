# Documentation Index

Welcome to ECHO/Adrishya documentation. Use this index to navigate all resources.

## 🚀 Quick Start

**New to the project?** Start here:
- **[Quickstart Guide](guides/quickstart.md)** — Local setup (5 min)
- **[README](../README.md)** — Project overview

## 📚 Documentation Structure

### 🏗️ Architecture & Design

- **[Modules Overview](modules/MODULES.md)** — Three-module architecture (communication, battery, allocation)
- **[Requirements](architecture/REQUIREMENTS.md)** — System dependencies & stack
- **[Protocol Blueprint](../README.md#protocol-blueprint)** — SOS payload, identifiers, cryptography

### 🚛 Resource Allocation

- **[Allocation v1 (Legacy)](allocation/ALLOCATION.md)** — Original greedy algorithm
- **[Allocation v2 (Advanced)](allocation/ALLOCATION_V2.md)** — Linear Programming with multi-scenario optimization
  - **[Quick Reference](allocation/ALLOCATION_V2_QUICK_REF.md)** — API endpoints & examples (2 min)
  - **[Migration Guide](allocation/ALLOCATION_MIGRATION.md)** — Gradual rollout plan (4 weeks)
  - **[Status Report](allocation/ALLOCATION_V2_STATUS.md)** — Production readiness checklist
  - **[Integration Analysis](allocation/ALLOCATION_INTEGRATION_SUMMARY.md)** — Feature comparison

### 🔋 Battery Optimization

- **[Battery Integration Status](battery/BATTERY_INTEGRATION_STATUS.md)** — Cloud + on-device battery tracking
- **[Flutter Integration Guide](battery/FLUTTER_BATTERY_INTEGRATION.md)** — Mobile app implementation (Battery APIs, power states, integration patterns)

### 📖 Integration Guides

- **[Integration Analysis](guides/INTEGRATION_ANALYSIS.md)** — Detailed allocation module analysis
- **[Integration Guide](guides/INTEGRATION_GUIDE.md)** — Technical deep-dive (algorithms, architecture, deployment)

## 🎯 By Use Case

### "I'm a developer integrating the backend"
1. Read: [Quickstart Guide](guides/quickstart.md)
2. Read: [System Requirements](architecture/REQUIREMENTS.md)
3. Run: `npm test` in backend/
4. Reference: [Allocation v2 Quick Ref](allocation/ALLOCATION_V2_QUICK_REF.md)

### "I'm planning resource allocation"
1. Read: [Allocation v1](allocation/ALLOCATION.md) (current system)
2. Read: [Allocation v2 Migration](allocation/ALLOCATION_MIGRATION.md) (future improvements)
3. Review: [Allocation v2 Status](allocation/ALLOCATION_V2_STATUS.md) (metrics & readiness)

### "I'm implementing Flutter mobile"
1. Read: [Battery Integration Status](battery/BATTERY_INTEGRATION_STATUS.md)
2. Read: [Flutter Integration Guide](battery/FLUTTER_BATTERY_INTEGRATION.md)
3. Reference endpoints in [README Battery Section](../README.md#mobile-flutter-android-integration)

### "I'm deploying to production"
1. Read: [Allocation v2 Status](allocation/ALLOCATION_V2_STATUS.md) (production readiness)
2. Review: [Allocation Migration](allocation/ALLOCATION_MIGRATION.md) (deployment options)
3. Check: [Requirements](architecture/REQUIREMENTS.md) (dependencies)

## 📊 Directory Structure

```
fuzzy-spoon/
├── README.md                          # Project overview
├── docs/                              # This documentation
│   ├── allocation/                    # Resource allocation docs
│   │   ├── ALLOCATION.md              # v1 (legacy)
│   │   ├── ALLOCATION_V2.md           # v2 (advanced)
│   │   ├── ALLOCATION_V2_QUICK_REF.md # Quick API reference
│   │   ├── ALLOCATION_V2_STATUS.md    # Production readiness
│   │   ├── ALLOCATION_MIGRATION.md    # Rollout plan
│   │   └── ALLOCATION_INTEGRATION_SUMMARY.md
│   ├── battery/                       # Battery optimization docs
│   │   ├── BATTERY_INTEGRATION_STATUS.md
│   │   └── FLUTTER_BATTERY_INTEGRATION.md
│   ├── modules/                       # Architecture docs
│   │   └── MODULES.md
│   ├── architecture/                  # System design docs
│   │   └── REQUIREMENTS.md
│   ├── guides/                        # Implementation guides
│   │   ├── QUICKSTART.md
│   │   ├── INTEGRATION_ANALYSIS.md
│   │   └── INTEGRATION_GUIDE.md
│   └── INDEX.md (this file)
├── backend/                           # Node.js Express backend
│   ├── src/
│   │   ├── index.mjs                  # Main server + endpoints
│   │   ├── allocationWrapper.mjs      # v2 bridge (NEW)
│   │   ├── disaster_alloc_runner.py   # v2 subprocess (NEW)
│   │   └── ... (other modules)
│   ├── test/
│   │   ├── allocation-v2.test.mjs     # 10 new v2 tests
│   │   └── ... (other tests)
│   └── package.json
└── ...
```

## 🔗 Key Endpoints

### SOS Ingest
- `POST /v1/ingest/sos` — Receive signed SOS messages

### Battery (Flutter)
- `GET /v1/device/battery/:device_id` — Device battery status
- `GET /v1/optimize/config?power_state=...` — Power optimization config
- `POST /v1/stats/battery/record` — Record battery stats
- `GET /v1/admin/battery-status` — Network battery health

### Allocation v1 (Legacy)
- `POST /v1/allocate` — Greedy allocation (10-15ms)

### Allocation v2 (Advanced - NEW)
- `POST /v1/allocate/v2` — LP optimization (50-150ms, 20-30% improvement)
- `POST /v1/allocate/compare` — Compare v1 vs v2 results

## 📈 Key Metrics

| Metric | v1 (Legacy) | v2 (Advanced) |
|--------|-------------|---------------|
| Algorithm | Greedy tier-based | Linear Programming |
| Latency | 10-15ms | 50-150ms (first), <5ms (cached) |
| Unmet Demand | 15-35% | 5-15% |
| Improvement | — | 20-30% ✅ |

## ✅ Testing

```bash
# Run all tests (24/24 passing)
cd backend && npm test

# Run only allocation v2 tests (10 tests)
npm test allocation-v2.test.mjs

# See battery tests
npm test battery-endpoints.test.mjs
```

## 📞 Support

**Documentation Issues?**
- Check relevant guide in this index
- See troubleshooting section in specific document
- Review test files for usage examples

**Code Issues?**
- Check backend README
- Review test suite for expected behavior
- Run `npm test` to validate

---

**Last Updated**: March 27, 2026  
**Status**: ✅ Production Ready  
**All Tests**: 24/24 Passing  
**Allocation v2**: Ready for gradual rollout
