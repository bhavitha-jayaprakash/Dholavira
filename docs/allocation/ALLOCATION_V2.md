# Disaster Resource Allocation Module

## Overview

The Echo system includes an advanced resource allocation engine that optimizes supply routing and resource deployment across a disaster zone. The system now features **Hybrid Integration** with both v1 (legacy greedy algorithm) and v2 (advanced linear programming with A* pathfinding).

## Architecture

### Version Timeline

- **v1 (Legacy)**: Greedy algorithm for basic allocation, tier-based demand satisfaction
- **v2 (Advanced, NEW)**: Linear programming optimization with pathfinding, vehicle degradation, rolling horizon planning

Both versions are available and can be compared for validation and gradual migration.

## Allocation v2 (Advanced - Production Ready)

### Core Components

#### Node Structure
Represents facilities in the disaster zone:
```json
{
  "id": "warehouse_1",
  "role": "warehouse",      // warehouse | distribution | hospital | shelter
  "tier": 1,                // 1=hub, 2=regional, 3=local
  "supply": 500.0,          // available stock (units)
  "demand": 0.0,            // needed stock (units)
  "priority": 1.5           // allocation priority weight
}
```

#### Edge Structure
Routes between nodes with capacity and vehicle types:
```json
{
  "id": "route_w1_dc1",
  "source": "warehouse_1",
  "target": "distribution_center_1",
  "base_capacity": 300.0,   // max throughput (units)
  "base_cost": 1.0,         // cost per unit
  "vehicle_types": ["truck", "bike", "drone"],
  "degradation": {          // capability factor by vehicle
    "truck": 1.0,
    "bike": 0.6,
    "drone": 0.8
  }
}
```

#### Scenario Structure
Represents disaster conditions and constraints:
```json
{
  "name": "earthquake_with_outages",
  "demand_mult": 1.5,       // demand multiplier (% increase)
  "outages": {              // node_id -> closed (bool)
    "hospital_2": true
  },
  "route_impact": {         // edge_id -> usable (bool)
    "route_blocked_1": false
  },
  "weather_impact": {       // edge_id -> {vehicle -> degradation}
    "mountain_route": {
      "truck": 0.7,
      "bike": 0.4,
      "drone": 1.0
    }
  }
}
```

### Allocation Modes

#### Static Mode
Single-time allocation decision. Best for immediate disaster response.
```javascript
{
  "mode": "static",         // single decision point
  "rolling_steps": 1        // ignored for static
}
```

#### Rolling Horizon Mode
Multi-period planning across changing scenarios.
```javascript
{
  "mode": "rolling",
  "rolling_steps": 7        // plan across 7 time periods
}
```

### API Endpoints

#### Advanced Allocation
**POST /v1/allocate/v2**

Run the v2 optimization engine with scenarios.

**Request:**
```json
{
  "nodes": [...],
  "edges": [...],
  "scenarios": [...],
  "mode": "static",
  "rolling_steps": 1,
  "hitl_overrides": {
    "weights": {
      "hospital_1": 2.5     // increase priority
    },
    "force_node": {
      "warehouse_2": true   // force active
    },
    "force_route": {
      "critical_route": true
    }
  }
}
```

**Response:**
```json
{
  "version": "v2",
  "status": "success",
  "flows": [
    {
      "from": "warehouse_1",
      "to": "hospital_1",
      "edge": "route_w_h",
      "qty": 150.0,
      "vehicle": "truck",
      "time": 0
    }
  ],
  "active_nodes": ["warehouse_1", "hospital_1", "distribution_center_1"],
  "critical_routes": ["route_w_h", "route_dc_s"],
  "unmet_demand": {
    "shelter_1": 25.5
  },
  "explanations": [
    {
      "node": "hospital_1",
      "top_factors": ["High priority weight", "Critical tier role"],
      "risk": "medium",
      "sensitivity": "high"
    }
  ],
  "robust_margin": {
    "hospital_1": 35.0,     // extra stock for worst-case
    "shelter_1": 40.0
  },
  "_metadata": {
    "timestamp": "2026-03-27T14:22:30Z",
    "mode": "static",
    "req_id": "abc-123-xyz"
  }
}
```

#### Compare Versions
**POST /v1/allocate/compare**

Compare v1 vs v2 allocation results on the same scenario.

**Request:** (same as v2)

**Response:**
```json
{
  "version": "comparison",
  "status": "success",
  "v2_result": {...},
  "comparison_metrics": {
    "flows": {
      "v1": 12,
      "v2": 15,
      "delta": 3,
      "improvement": "25.00%"
    },
    "unmet_demand": {
      "v1": 120.5,
      "v2": 85.3,
      "delta": -35.2,
      "improvement": "29.23%"
    },
    "active_nodes": {
      "v1": 8,
      "v2": 9,
      "delta": 1
    },
    "recommendation": "v2_preferred",
    "summary": {
      "v1": { "flows": 12, "unmet": "120.50", "active": 8 },
      "v2": { "flows": 15, "unmet": "85.30", "active": 9 }
    }
  },
  "_metadata": {...}
}
```

### Algorithms

#### v2 Features

1. **Linear Programming Optimization**
   - Minimize total unmet demand
   - Respect capacity constraints
   - Vehicle-specific routing
   - Robust worst-case analysis

2. **A* Pathfinding** (optional integration)
   - Obstacle avoidance
   - Risk-based cost functions
   - Multi-objective path selection

3. **Vehicle Degradation**
   - Truck: 100% capacity (roads)
   - Bike: 60% capacity (rough terrain, fuel efficiency)
   - Drone: 80% capacity (range limits, weather)

4. **Scenario Planning**
   - Multi-scenario robust margins
   - Worst-case capacity allocation
   - Demand multiplier support

5. **Human-in-the-Loop Overrides**
   - Force node state (active/inactive)
   - Force route availability
   - Adjust priorities

### Performance & Caching

- **Caching**: Identical requests cached for 5 minutes
- **Subprocess**: Python engine runs in isolated subprocess
- **Timeout**: 30-second hard limit per allocation
- **Memory**: Efficient graph representation

### Error Handling

All errors are caught and return graceful responses:

```json
{
  "version": "v2",
  "status": "error",
  "error": "Invalid scenario: demand_mult must be numeric",
  "flows": [],
  "active_nodes": [],
  "critical_routes": [],
  "unmet_demand": [],
  "explanations": [],
  "robust_margin": {}
}
```

## Legacy Integration (v1)

Original greedy algorithm still available for:
- Backward compatibility
- Baseline comparison
- Simple scenarios

Call v1 directly or use `/v1/allocate/compare` to see improvements.

## Migration Guide

### Phase 1: Parallel Validation (Week 1)
1. Run both v1 and v2 on existing scenarios
2. Compare results using `/v1/allocate/compare`
3. Validate business logic matches

### Phase 2: Staged Rollout (Week 2-3)
1. Route small percentage to v2 via feature flags
2. Monitor unmet demand and flow quality
3. Adjust parameters based on results

### Phase 3: Full Migration (Week 4)
1. Switch primary allocation to v2
2. Keep v1 available for fallback
3. Archive monitoring for audit trail

## Example Usage

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

### With Overrides
```bash
curl -X POST http://localhost:3000/v1/allocate/v2 \
  -H "Content-Type: application/json" \
  -d '{
    "nodes": [...],
    "edges": [...],
    "scenarios": [...],
    "mode": "static",
    "hitl_overrides": {
      "weights": {"critical_hospital": 3.0},
      "force_node": {"backup_warehouse": true},
      "force_route": {"critical_corridor": true}
    }
  }'
```

### Compare Results
```bash
curl -X POST http://localhost:3000/v1/allocate/compare \
  -H "Content-Type: application/json" \
  -d '{
    "nodes": [...],
    "edges": [...],
    "scenarios": [...]
  }'
```

## Testing

### Run Allocation Tests
```bash
cd backend
npm test -- allocation-v2.test.mjs
```

### Test Coverage
- ✅ Basic scenario allocation
- ✅ Outage handling
- ✅ Rolling horizon planning
- ✅ Vehicle degradation
- ✅ HITL overrides
- ✅ Result caching
- ✅ Format validation
- ✅ Version comparison
- ✅ Cache management
- ✅ Error handling

## Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│         Express Backend (Node.js)                   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  POST /v1/allocate/v2        POST /v1/allocate/    │
│       │                          compare             │
│       │                               │              │
│       └───────┬─────────────────────┬─┘              │
│               │                     │                │
│        AllocationWrapper.mjs (Cache)                │
│               │                     │                │
│       ┌───────┴─────────────────────┴──┐             │
│       │                                 │             │
│       ▼                                 ▼             │
│  (Subprocess spawning)                            │
│       │                                 │             │
│       └────────────┬────────────────────┘             │
│                    │                                  │
│        disaster_alloc_runner.py                      │
│   (Python JSON wrapper)                             │
│                    │                                  │
│                    ▼                                  │
│  disaster_alloc.py (Core algorithm)                │
│  ├── DisasterResourceAllocator                      │
│  ├── DynamicGraph (nodes, edges, scenarios)         │
│  ├── stage1_plan() - LP optimization                │
│  └── allocate_for_scenario() - flow routing         │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Configuration

### Environment Variables
- `ALLOCATION_CACHE_TTL=300000` - Cache expiry in ms (default: 5 min)
- `ALLOCATION_TIMEOUT=30000` - Python subprocess timeout (default: 30s)

### Python Dependencies
```
pulp>=2.7          # Linear programming solver
```

## Troubleshooting

### Subprocess Won't Start
Check Python installation and path:
```bash
which python3
python3 -m py_compile backend/src/disaster_alloc.py
```

### Allocation Takes Too Long
- Check scenario complexity (number of nodes/edges)
- Consider splitting into smaller regions
- Monitor CPU usage during allocation

### Unmet Demand Too High
- Increase edge capacities
- Add transit nodes (distribution centers)
- Adjust priorities/weights
- Review scenario constraints

## Future Enhancements

- [ ] Integrate FastAPI microservice (standalone deployment)
- [ ] Add time-dependent routing (temporal graphs)
- [ ] Multi-objective optimization (cost vs fairness)
- [ ] Real-time scenario updates via websockets
- [ ] GIS visualization of allocation flows
- [ ] Kubernetes deployment templates

## Support

For integration questions or bug reports:
1. Check test suite: `backend/test/allocation-v2.test.mjs`
2. Review response format in responses above
3. Enable debug logging: `console.log` in `allocationWrapper.mjs`
4. Profile Python execution: add timing to `disaster_alloc_runner.py`
