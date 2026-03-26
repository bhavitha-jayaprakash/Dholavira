#!/bin/bash
# TECHNICAL COMPARISON: Current vs. New Allocation Module

cat << 'EOF'

╔═══════════════════════════════════════════════════════════════════════════╗
║         DISASTER ALLOCATION MODULE INTEGRATION GUIDE                     ║
║     Current (Node.js wrapper) vs. New (FastAPI + A* + LP)               ║
╚═══════════════════════════════════════════════════════════════════════════╝

CURRENT ARCHITECTURE (backend/src/disaster_alloc.py)
─────────────────────────────────────────────────────────────────────────

Class Structure:
  • Node(id, role, tier, supply, demand, priority)
  • Edge(id, source, target, capacity, cost)
  • Scenario(name, outages, demand_multiplier)
  • DynamicGraph(nodes, edges)
  • DisasterResourceAllocator(graph)

Flow Allocation:
  • Greedy algorithm: supply nodes → demand nodes
  • Simple path: find source → find route → allocate
  • No obstacle avoidance or risk modeling
  • Returns: flows[], unmet_demand{}, explanations[]

Integration:
  • Python module in backend/src/
  • Called from Node.js via spawn() or import path
  • Results passed to ALLOCATION.md
  • Single /v1/allocate endpoint

Limitations:
  ❌ No realistic pathfinding (ignores obstacles)
  ❌ No vehicle type degradation modeling
  ❌ No linear programming optimization
  ❌ No robust worst-case analysis
  ❌ Limited HITL (force_node, force_route only)


NEW ARCHITECTURE (uploaded files)
─────────────────────────────────────────────────────────────────────────

Enhanced Class Structure:
  • Node (dataclass)
    - active, forced_active, priority, tier
    - set_priority(), set_active(), effective_active()
  
  • Edge (dataclass)
    - vehicle degradation (truck/bike/drone)
    - grid_map, source_pos, target_pos (for pathfinding)
    - compute_path_distance()
    - compute_path_risk()
  
  • Scenario (dataclass)
    - degradation_updates for each vehicle type
    - route_outages, node_outages per scenario
  
  • DynamicGraph (enhanced)
    - apply_scenario() for dynamic updates
    - reset() to clear scenario state

Flow Allocation (Dual methods):
  1. flow_allocation() → Greedy (current approach)
  2. flow_allocation_lp() → LP optimization (NEW)
     - PuLP linear programming
     - Minimizes cost vs. capacity constraints
     - Optimal but slower

Advanced Features:
  ✅ A* pathfinding with obstacle/risk avoidance
  ✅ Vehicle type degradation (truck=1.0, bike=0.7, drone=0.9)
  ✅ Robust worst-case analysis (robust_margin)
  ✅ Rolling horizon planning (multi-step scenarios)
  ✅ Complete HITL (weights, force_node, force_route)
  ✅ FastAPI REST service included

FastAPI Endpoints:
  • GET /health
  • POST /allocate
    - mode: "static" | "rolling"
    - vehicle_type: "truck" | "bike" | "drone"
    - hitl: { weights, force_node, force_route }

Test Suite:
  • test_api.py: 6 comprehensive tests
  • Tests: health, static, rolling, HITL, error cases


MISSING SECTIONS (Code is Incomplete)
─────────────────────────────────────────────────────────────────────────

The uploaded disaster_alloc.py has incomplete sections marked:
  /* Line N omitted */

Must complete before integration:
  1. Node.effective_active() - enforce forced state
  2. Edge.effective_usable() - enforce forced state
  3. Edge.capacity() - apply vehicle degradation
  4. Edge.compute_path_distance() - A* distance
  5. Edge.compute_path_risk() - A* risk scoring
  6. DynamicGraph.reset() - clear forced states
  7. DynamicGraph.apply_scenario() - apply node/edge changes
  8. DisasterResourceAllocator._demand_nodes() - retrieve active demand
  9. DisasterResourceAllocator.flow_allocation_lp() - LP solve + extract results
  10. Other locations with /* omitted */ comments


INTEGRATION PATHS
─────────────────────────────────────────────────────────────────────────

PATH 1: STANDALONE ALLOCATION MICROSERVICE (Recommended for scale)
────────────────────────────────────────────────────────────────

Structure:
  allocation-service/
    app.py (FastAPI, as provided)
    disaster_alloc.py (new, complete)
    path_planner.py (A* planner)
    requirements.txt
    Dockerfile

Backend integration:
  backend/src/allocation_client.mjs
    • POST http://allocation-service:5000/allocate
    • Handles network, retries, fallback
    • Returns result to Express endpoint

Express endpoint:
  POST /v1/allocate
    → Call allocation_client → return result

Pros:
  ✅ Decoupled: allocation service independent
  ✅ Scalable: dedicated resource (Python+LP)
  ✅ Testable: isolated service, own tests
  ✅ Deployment: separate containers

Cons:
  ❌ Extra infrastructure (new service)
  ❌ Network latency between services
  ❌ Complexity (orchestration)


PATH 2: HYBRID IN-BACKEND (Recommended for current setup)
─────────────────────────────────────────────────────────────

Structure:
  backend/src/disaster_alloc_v1.py (current)
  backend/src/disaster_alloc_v2.py (new)
  backend/src/allocation_wrapper.mjs
    • spawn() Python subprocess
    • Call either v1 or v2 based on query param

Express endpoints:
  POST /v1/allocate (uses v1 - existing)
  POST /v1/allocate/v2 (uses v2 - new)
  POST /v1/allocate/compare (runs both, returns comparison)

Pros:
  ✅ No breaking changes
  ✅ Gradual migration
  ✅ Side-by-side testing
  ✅ Single container deployment

Cons:
  ❌ Python subprocess overhead
  ❌ Resource contention (shared container)


PATH 3: DIRECT REPLACEMENT (Fast but breaking)
──────────────────────────────────────────────────

Simply replace backend/src/disaster_alloc.py with new code.

Pros:
  ✅ Simplest
  ✅ Single version to maintain

Cons:
  ❌ Breaking change for all existing clients
  ❌ No rollback path
  ❌ Must update documentation


RECOMMENDATION: PATH 1 (Standalone Microservice)
──────────────────────────────────────────────────

Why:
  1. Cleaner architecture (separation of concerns)
  2. Scales independently (LP solver is CPU-intensive)
  3. Easy testing and updates (own release cycle)
  4. Production-ready FastAPI setup
  5. Easier to debug allocation issues
  6. Can add more allocation strategies later


IMPLEMENTATION CHECKLIST
─────────────────────────────────────────────────────────────────────────

Before starting:
  [ ] Complete all omitted sections in disaster_alloc.py
  [ ] Test path_planner.py with various grids
  [ ] Run test_api.py (all 6 tests must pass)
  [ ] Validate LP solver (install pulp)
  [ ] Benchmark against current greedy algorithm

Setup:
  [ ] Create allocation-service/ directory
  [ ] Add app.py, disaster_alloc.py, path_planner.py
  [ ] Create requirements.txt:
      - fastapi
      - uvicorn
      - pulp
      - pydantic
  [ ] Add Dockerfile + docker-compose entry
  [ ] Add comprehensive tests

Integration (backend):
  [ ] Create backend/src/allocation_client.mjs
  [ ] Add POST /v1/allocate endpoint to Express
  [ ] Update ALLOCATION.md with new API
  [ ] Add example request/response

Testing:
  [ ] Unit tests (allocation logic)
  [ ] Integration tests (backend ↔ service)
  [ ] Performance benchmarks
  [ ] Scenario comparison (v1 vs v2)

Documentation:
  [ ] Update ALLOCATION.md
  [ ] Add API schema
  [ ] Document vehicle types and degradation
  [ ] Explain robust_margin and rolling horizon
  [ ] HITL overrides guide


CODE QUALITY ISSUES TO FIX
─────────────────────────────────────────────────────────────────────────

1. Syntax in uploaded code:
   • Avoid /* */ comments in Python (use #)
   • Fix incomplete method bodies

2. Type hints:
   • Add @dataclass decorator properly
   • Use Optional[T] for nullable fields
   • Import from typing module

3. Error handling:
   • Catch exceptions in flow_allocation_lp()
   • Handle LP solver failures
   • Return meaningful error messages

4. Documentation:
   • Add docstrings to all methods
   • Include examples in docstrings
   • Document vehicle degradation model

5. Testing:
   • Test grid pathfinding edge cases
   • Test LP solver with infeasible scenarios
   • Test HITL overrides
   • Benchmark performance


DEPLOYMENT DOCKER-COMPOSE
─────────────────────────────────────────────────────────────────────────

services:
  allocation-service:
    build: ./allocation-service
    ports:
      - "5000:5000"
    environment:
      - WORKERS=4
      - LOG_LEVEL=info
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5000/health"]
      interval: 30s
      timeout: 10s

  backend:
    build: ./backend
    ports:
      - "3000:3000"
    depends_on:
      - allocation-service
    environment:
      - ALLOCATION_SERVICE=http://allocation-service:5000


ESTIMATED EFFORT
─────────────────────────────────────────────────────────────────────────

Task                              | Effort   | Notes
────────────────────────────────────────────────────────────────────
Complete omitted code sections    | 2-3h     | Fill in A*, LP, apply_scenario
Fix/clean uploaded code           | 1-2h     | Remove comments, add docstrings
Create allocation microservice    | 2h       | Docker, requirements, config
Write allocation_client.mjs       | 1h       | HTTP wrapper, error handling
Add Express /v1/allocate endpoint | 1h       | Request/response handling
Update docs (ALLOCATION.md)       | 1-2h     | API schema, examples, scenarios
Testing (unit + integration)      | 3-4h     | Comprehensive test suite
Performance benchmarking          | 2h       | Compare v1 vs v2 results
────────────────────────────────────────────────────────────────────
TOTAL                             | 13-17h   | 2-3 days full effort

RISK ASSESSMENT
─────────────────────────────────────────────────────────────────────────

Risk                              | Likelihood | Mitigation
────────────────────────────────────────────────────────────────────
Incomplete code (omitted sections) | HIGH      | Complete before starting
LP solver infeasible scenarios     | MEDIUM    | Add fallback to greedy
Performance degradation           | MEDIUM    | Benchmark, optimize LP
Network latency (microservice)    | LOW       | Cache results, async
Missing pathfinding edge cases     | MEDIUM    | Thorough A* testing

EOF
