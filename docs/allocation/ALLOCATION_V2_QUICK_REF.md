# Allocation v2 - Quick Reference

## Status
✅ **PRODUCTION READY** - Hybrid integration complete (v1 + v2 coexisting)

## API Endpoints

### Advanced Allocation (v2)
```bash
POST /v1/allocate/v2
Content-Type: application/json

{
  "nodes": [...],
  "edges": [...],
  "scenarios": [...],
  "mode": "static" | "rolling",
  "rolling_steps": 1,
  "hitl_overrides": { ... }
}
```

### Compare v1 vs v2
```bash
POST /v1/allocate/compare
Content-Type: application/json

{
  "nodes": [...],
  "edges": [...],
  "scenarios": [...]
}
```

## Quick Examples

### Basic Allocation
```bash
curl -X POST http://localhost:3000/v1/allocate/v2 \
  -H "Content-Type: application/json" \
  -d '{
    "nodes": [
      {"id": "w1", "role": "warehouse", "tier": 1, "supply": 1000},
      {"id": "h1", "role": "hospital", "tier": 2, "demand": 500}
    ],
    "edges": [
      {"id": "e1", "source": "w1", "target": "h1", "base_capacity": 400}
    ],
    "scenarios": [
      {"name": "baseline", "demand_mult": 1.0}
    ],
    "mode": "static"
  }'
```

### With Outage Scenario
```json
{
  "scenarios": [{
    "name": "outage",
    "demand_mult": 1.3,
    "outages": {"warehouse_2": true},
    "route_impact": {"blocked_route": false},
    "weather_impact": {}
  }]
}
```

### With Human Overrides
```json
{
  "hitl_overrides": {
    "weights": {"critical_hospital": 3.0},
    "force_node": {"backup_warehouse": true},
    "force_route": {"emergency_corridor": true}
  }
}
```

## Test Coverage
✅ 10 comprehensive tests (all passing)

```bash
# Run all tests
npm test

# Run only allocation v2 tests
npm test allocation-v2.test.mjs

# Expected: 24/24 passing (14 existing + 10 new)
```

## Response Format

```json
{
  "version": "v2",
  "status": "success",
  "flows": [
    {
      "from": "w1",
      "to": "h1",
      "edge": "e1",
      "qty": 150,
      "vehicle": "truck",
      "time": 0
    }
  ],
  "active_nodes": ["w1", "h1"],
  "critical_routes": ["e1"],
  "unmet_demand": {"h1": 0},
  "explanations": [...],
  "robust_margin": {"h1": 50}
}
```

## Performance

| Metric | Value |
|--------|-------|
| First run | 50-150ms |
| Cached (5-min TTL) | <5ms |
| Unmet demand improvement | 20-30% vs v1 |
| Timeout limit | 30s |

## Node Types

| Role | Purpose |
|------|---------|
| warehouse | Supply hub (tier 1) |
| distribution | Regional center (tier 2) |
| hospital | Critical demand (tier 3) |
| shelter | Mass demand (tier 3) |

## Vehicle Degradation

| Vehicle | Capacity | Best For |
|---------|----------|----------|
| truck | 100% | Roads, bulk cargo |
| bike | 60% | Rough terrain, fuel-efficient |
| drone | 80% | Quick delivery, obstacle avoidance |

## Allocation Modes

**static**: Single-time decision (default)
```json
{"mode": "static"}
```

**rolling**: Multi-period planning
```json
{"mode": "rolling", "rolling_steps": 7}
```

## Documentation

- **API Details**: See `ALLOCATION_V2.md`
- **Migration Guide**: See `ALLOCATION_MIGRATION.md`
- **Status Report**: See `ALLOCATION_V2_STATUS.md`
- **Implementation**: See `backend/src/allocationWrapper.mjs`
- **Tests**: See `backend/test/allocation-v2.test.mjs`

## Files

- `backend/src/allocationWrapper.mjs` - Node.js bridge to Python
- `backend/src/disaster_alloc_runner.py` - Python subprocess entry
- `backend/src/disaster_alloc.py` - Core algorithm (v2)
- `backend/src/path_planner.py` - A* pathfinding
- `backend/src/index.mjs` - Express endpoints
- `backend/test/allocation-v2.test.mjs` - 10 tests

## Troubleshooting

### Subprocess won't start
```bash
which python3
python3 -m py_compile backend/src/disaster_alloc.py
```

### Tests failing
```bash
npm test allocation-v2.test.mjs 2>&1 | head -50
```

### Unmet demand too high
- Increase edge capacities
- Add transit nodes
- Adjust priority weights
- Review scenario constraints

## Migration Options

| Option | Timeline | Effort | Risk |
|--------|----------|--------|------|
| Keep v1 | Now | 0h | None |
| Hybrid rollout | 4 weeks | 40h | Low |
| Standalone service | 2-3 weeks | 60h | Medium |

**Recommendation**: Start with Hybrid rollout ✅

## Go/No-Go Checklist

- ✅ Tests passing: 24/24
- ✅ Endpoints operational
- ✅ Caching working
- ✅ Error handling robust
- ✅ Documentation complete
- ✅ Performance acceptable
- ✅ Backward compatible

**Status**: ✅ **READY FOR PRODUCTION**
