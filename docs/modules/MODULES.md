# ECHO System Modules

Three-part stack for **battery-aware, delay-tolerant disaster communications**:

1. **Communication** — BLE/LoRa/Wi-Fi Direct mesh + store-and-forward + RSSI suppression.
2. **Battery Optimization** — power-aware message filtering, LoRa CAD duty cycling, cloud-side node prioritization.
3. **Resource Allocation** — scenario-based supply routing (warehouses → hospitals), robust margins, HITL overrides.

## 1. Communication Layer

**Purpose**: Mesh relay of SOS messages across Layer 1–3 (phones, ESP32, vehicles) before reaching cloud.

**Key components**:

- **BLE store-and-forward** ("frog-jump"): phones relay messages in range.
- **LoRa TX/RX** (ESP32 sentinels): capture from BLE, forward via LoRa ~10 km.
- **Vehicle DTN**: LoRa mules vacuum packets, dump to cloud when internet returns.
- **RSSI suppression**: skip rebroadcast if signal already strong (redundant, saves power).

**Constraints**:

- Delay tolerant: seconds to minutes.
- Broadcast-storm safe: dedupe by `msg_id`, TTL hops.
- Works offline-first.

**Referenced in**: `README.md` (Layers 1–3), `ALLOCATION.md` (Layer 4 integration).

## 2. Battery Optimization Layer

**Purpose**: Extend device lifetime by intelligent message routing + duty cycling.

**Files**: `backend/src/battery_optimization.py`

### On-device (phone / ESP32)

```python
from backend.src.battery_optimization import BatteryOptimizer, PowerState

optimizer = BatteryOptimizer(device_id="esp32_001")
optimizer.set_battery(18)  # 18% battery

# Decide: should I rebroadcast this SOS?
should_fwd, reason = optimizer.should_forward_message(
    msg_id="abc123",
    priority=2.5,
    rssi_dbm=-65  # -65 dBm = moderate signal
)
# Result: False, "low_battery" (critical/low battery = don't relay non-critical)

# LoRa CAD duty cycle: sleep 2.9s, sniff 0.1s
cycle = optimizer.lora_cad_duty_cycle()
# -> 97% power savings vs always-listening
```

### Strategy

**Message forwarding filters** (priority + RSSI + power state):

- `CRITICAL battery` (<5%): only forward emergency SOS (priority >= 3.0).
- `LOW battery` (5–20%): forward if strong signal (RSSI strong) OR high priority.
- `MEDIUM battery` (20–60%): forward all with jittered delay.
- `GOOD battery` (>60%): forward all.

**LoRa CAD duty cycle**:

- Sleep 2.9s, sniff ~0.1s = **97% power savings**.
- Still catches incoming LoRa packets (CAD detects preamble during sniff).

**Message retention** (cache time):

- CRITICAL: 1 hour (expire cache quickly, save memory).
- LOW: 24 hours.
- GOOD: 7 days.

### Cloud-side (resource allocator)

```python
from backend.src.battery_optimization import CloudBatteryAwareTriage

cloud_triage = CloudBatteryAwareTriage()
cloud_triage.update_node_state("esp32_A", battery_pct=5, timestamp=now)

# Adjust allocation weight: low-battery node gets lower priority
weight = cloud_triage.priority_weight_for_node("esp32_A", base_weight=1.0)
# -> 0.2 (avoid routing critical supplies through)

# Adjust route cost: prefer routes avoiding critical nodes
cost = cloud_triage.route_energy_cost("route_1", node_battery_map)
# -> higher cost = less likely to use (planners avoid)
```

The cloud knows device battery state (sent in SOS or separate heartbeat); it deprioritizes nodes at risk, avoiding routing critical supplies through them.

## 3. Resource Allocation Layer

**Purpose**: Post-ingest triage—optimize supply routing to maximize coverage under constraints.

**Files**: `backend/src/disaster_alloc.py`, `backend/src/allocation_example.py`

### Model

**Nodes**: warehouses, distribution hubs, hospitals, shelters (each has supply/demand/priority/tier).

**Edges**: routes with capacity, vehicle types (truck/bike/drone), degradation factors (weather/damage).

**Scenarios**: outages, demand spikes, road closures, weather impact.

### Run allocation

```python
from backend.src.disaster_alloc import DynamicGraph, Node, Edge, Scenario, DisasterResourceAllocator

g = DynamicGraph()
g.add_node(Node("warehouse_1", role="warehouse", tier=1, supply=500))
g.add_node(Node("hospital_1", role="hospital", tier=3, demand=200, priority=3.0))
g.add_edge(Edge("route_1", "warehouse_1", "hospital_1", base_capacity=300))

scenarios = [
    Scenario("baseline", demand_mult=1.0),
    Scenario("road_damage", demand_mult=1.2, route_impact={"route_1": False})
]

allocator = DisasterResourceAllocator(g)
result = allocator.run(scenarios, mode="static")

# Result:
# - flows: [{from, to, edge, qty, vehicle, time}, ...]
# - active_nodes: list of operational facilities
# - critical_routes: list of usable corridors
# - unmet_demand: shortfalls per scenario
# - robust_margin: extra stock to pre-position for worst-case
# - explanations: why each decision (transparency for operators)
```

### HITL overrides

Operators can force decisions:

```python
hitl = {
    "weights": {"hospital_1": 4.0},    # boost priority
    "force_node": {"hub_2": True},      # keep open
    "force_route": {"route_3": False}   # close route
}
result = allocator.run(scenarios, mode="static", hitl_overrides=hitl)
```

## Integration: Communication + Battery + Allocation

### Typical flow

1. **Phone user in disaster zone** → taps "SOS" → signed payload with `battery_pct` field.
2. **Phone's BatteryOptimizer** → checks battery + priority; if <5%, only forwards if emergency.
3. **ESP32 sentinel** receives via BLE → runs BatteryOptimizer + LoRa CAD; relays to cloud with RSSI metadata.
4. **Vehicle mule** (LoRa + storage) → holds packets, bulk-dumps when internet returns.
5. **Cloud backend** (`/v1/ingest/sos`) → verifies signature, stores in PostGIS, logs event.
6. **CloudBatteryAwareTriage** → marks ESP32 as low-battery based on battery_pct in SOS.
7. **DisasterResourceAllocator** → builds network from SOS locations + known hubs; runs allocation.
   - Deprioritizes low-battery nodes in routing.
   - Computes supply routing: warehouse → hub → hospital.
   - Outputs robust margin (pre-position stock to handle worst-case outages).
8. **Operator dashboard** → shows flows, critical routes, explanations, robust margins.

### Real-world scenario

**Earthquake in rural area:**

- SOS from phone (battery 12%) → ESP32 relays (battery 8%) → vehicle mule.
- Vehicle Internet returns → posts 500 SOS messages to cloud.
- **Cloud allocation** sees:
  - Hospital_A: demand 100, priority 3.0.
  - Hospital_B: demand 150, priority 2.5.
  - Warehouse_1: supply 200, good road.
  - Warehouse_2: supply 180, road damaged (1.2x demand spike in scenario).
  - ESP32_A: battery 8% → route weight 0.2x.
- **Allocator outputs**:
  - Flow: Warehouse_1 → Hospital_A (100 units).
  - Flow: Warehouse_1 → Warehouse_2 → Hospital_B (100 units, multi-hop to avoid low-battery ESP32_A).
  - Robust margin: Hospital_A +20 units, Hospital_B +30 units (worst-case buffer).
- **Dashboard**: operator sees "Critical: Hospital_B unmet 20 units in damage scenario; pre-position 30 for margin."

## Modules summary

| Module | File | Purpose | Input | Output |
| --- | --- | --- | --- | --- |
| Communication | README.md (Layers 1–3) | BLE/LoRa mesh relay | Phone SOS | Packets relayed Layer 1→4 |
| Battery Opt | `battery_optimization.py` | Power-aware filtering + duty cycling | Battery %, priority, RSSI | Forward decision, retention time, CAD cycle |
| Resource Alloc | `disaster_alloc.py` | Supply routing + margins | Network, scenarios, HITL | Flows, margins, explanations |

## Deployment checklist

- [ ] Phone SDK: battery-aware BLE advertise (battery field in payload).
- [ ] ESP32 firmware: BatteryOptimizer + LoRa CAD duty cycling.
- [ ] Cloud backend: `/v1/ingest/sos` stores battery_pct; CloudBatteryAwareTriage updates state.
- [ ] Resource allocator: builds network from SOS locations; runs allocation on ingest/schedule.
- [ ] Dashboard: shows flows, robust margins, battery state, explanations.

---

See `ALLOCATION.md`, `quickstart.md`, `README.md` for detailed docs.
