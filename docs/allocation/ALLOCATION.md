# Allocation layer (Layer 4 triage)

This module handles **post-ingest resource optimization** in ECHO: given SOS messages, known supply/demand, and outage scenarios, it computes robust supply routing and operator-guided (HITL) overrides.

## Overview

The disaster allocator models a **multi-tier DTN** resource graph:

- **Nodes**: warehouses, distribution hubs, hospitals, shelters (with supply/demand/priority).
- **Edges**: routes with capacity, vehicle types, degradation (weather, damage).
- **Scenarios**: outages, demand spikes, road closures, weather impact.
- **Robust margins**: pre-position extra stock to handle worst-case scenario.

## API

### Build a network

```python
from backend.src.disaster_alloc import DynamicGraph, Node, Edge, Scenario

g = DynamicGraph()

# Supply node
g.add_node(Node("warehouse_1", role="warehouse", tier=1, supply=500, priority=2.0))

# Demand node
g.add_node(Node("hospital_1", role="hospital", tier=3, demand=200, priority=3.0))

# Route
g.add_edge(Edge("route_1", source="warehouse_1", target="hospital_1", base_capacity=300))
```

### Define scenarios

```python
scenarios = [
    Scenario("baseline", demand_mult=1.0),
    Scenario("road_damage", demand_mult=1.2, 
             route_impact={"route_1": False},  # road closed
             weather_impact={"route_2": {"truck": 0.5}}),  # 50% capacity
]
```

### Run allocation

```python
from backend.src.disaster_alloc import DisasterResourceAllocator

allocator = DisasterResourceAllocator(g)

# Static planning: optimize once across scenarios
result = allocator.run(scenarios, mode="static")

# Rolling horizon: re-optimize every time step (e.g., 3 steps)
result = allocator.run(scenarios, mode="rolling", rolling_steps=3)
```

### Human-in-the-loop (HITL) overrides

Operators can force decisions:

```python
hitl = {
    "weights": {"hospital_1": 4.0},      # boost priority
    "force_node": {"hub_2": True},       # keep hub open
    "force_route": {"route_3": False},   # close route
}

result = allocator.run(scenarios, mode="static", hitl_overrides=hitl)
```

## Output

```python
result = {
    "flows": [
        {
            "from": "warehouse_1",
            "to": "hospital_1",
            "edge": "route_1",
            "qty": 150,
            "vehicle": "truck",
            "time": 0
        },
        # ... more flows
    ],
    "active_nodes": ["warehouse_1", "hospital_1", "hub_1", ...],
    "critical_routes": ["route_1", "route_2", ...],
    "unmet_demand": [
        {"scenario": "baseline", "unmet": {"hospital_1": 0}}
    ],
    "robust_margin": {"hospital_1": 10},  # pre-position 10 extra units
    "explanations": [
        {
            "node": "hospital_1",
            "top_factors": ["High priority weight", "Central tier1 role"],
            "risk": "medium",
            "sensitivity": "high"
        },
        # ... more explanation nodes
    ]
}
```

## Integration with backend

The backend can ingest SOS messages, build a dynamic network, and then call the allocator:

1. **SOS ingest** (`/v1/ingest/sos`): store geospatial message + metadata.
2. **Allocate** (optional `/v1/allocate`): given current state, compute robust supply routing + HITL input.
3. **Dashboard**: show flows, active routes, explanations, robust margins.

Example:

```bash
# Ingest SOS (Layer 4 knows location, priority)
curl -X POST http://127.0.0.1:3000/v1/ingest/sos -d '...'

# Request allocation (compute supply routing, margins, explanations)
curl http://127.0.0.1:3000/v1/allocate?scenario=baseline \
  -H 'x-hitl-overrides: {"weights": {"S3": 3.0}}'
```

## Tuning

Key parameters:

- **Demand multiplier**: scale demand in scenario (e.g., 1.5x in high-demand scenario).
- **Robust margin**: 0.5x worst-case unmet = safe buffer.
- **Vehicle degradation**: truck=1.0, bike=0.6, drone=0.8 (relative efficiency).
- **RSSI suppression** (BLE/LoRa): prevent broadcast storms; pairs with allocator's "active node" selection.

## See also

- `backend/src/disaster_alloc.py` — core allocation engine.
- `backend/src/allocation_example.py` — runnable example.
