import json
import random
from dataclasses import dataclass, field
from copy import deepcopy
from typing import Dict, List, Optional, Tuple, Any
from path_planner import AStarPathPlanner
from pulp import LpProblem, LpVariable, LpMinimize, lpSum, LpStatus, LpInteger


@dataclass
class Node:
    id: str
    role: str
    tier: int
    supply: float = 0.0
    demand: float = 0.0
    priority: float = 1.0
    active: bool = True
    forced_active: Optional[bool] = None

    def set_priority(self, weight: float) -> None:
        self.priority = weight

    def set_active(self, active: bool) -> None:
        self.active = active
        self.forced_active = active

    def effective_active(self) -> bool:
        if self.forced_active is not None:
            return self.forced_active
        return self.active


@dataclass
class Edge:
    id: str
    source: str
    target: str
    base_capacity: float
    base_cost: float = 1.0
    usable: bool = True
    forced_usable: Optional[bool] = None
    degradation: Dict[str, float] = field(default_factory=lambda: {"truck": 1.0, "bike": 1.0, "drone": 1.0})
    grid_map: Optional[List[List[int]]] = None  # For path planning
    source_pos: Optional[Tuple[int, int]] = None
    target_pos: Optional[Tuple[int, int]] = None

    def set_usable(self, usable: bool) -> None:
        self.usable = usable
        self.forced_usable = usable

    def effective_usable(self) -> bool:
        if self.forced_usable is not None:
            return self.forced_usable
        return self.usable

    def capacity(self, vehicle_type: str) -> float:
        if not self.effective_usable():
            return 0
        return self.base_capacity * self.degradation.get(vehicle_type, 1.0)

    def compute_path_distance(self) -> float:
        if self.grid_map and self.source_pos and self.target_pos:
            planner = AStarPathPlanner(self.grid_map, self.source_pos, self.target_pos)
            path = planner.plan_path()
            return planner.compute_distance(path) if path else float('inf')
        return self.base_cost  # Fallback to base cost

    def compute_path_risk(self) -> float:
        if self.grid_map and self.source_pos and self.target_pos:
            planner = AStarPathPlanner(self.grid_map, self.source_pos, self.target_pos)
            path = planner.plan_path()
            return planner.compute_risk(path) if path else 1.0
        return 0.0


@dataclass
class Scenario:
    name: str
    demand_multiplier: float = 1.0
    node_outages: Dict[str, bool] = field(default_factory=dict)
    route_outages: Dict[str, bool] = field(default_factory=dict)
    degradation_updates: Dict[str, Dict[str, float]] = field(default_factory=dict)


class DynamicGraph:
    def __init__(self) -> None:
        self.nodes: Dict[str, Node] = {}
        self.edges: Dict[str, Edge] = {}
        self.adjacency: Dict[str, List[str]] = {}

    def add_node(self, node: Node) -> None:
        self.nodes[node.id] = node
        self.adjacency.setdefault(node.id, [])

    def add_edge(self, edge: Edge) -> None:
        if edge.source not in self.nodes or edge.target not in self.nodes:
            raise ValueError("Edge must connect existing nodes")
        self.edges[edge.id] = edge
        self.adjacency.setdefault(edge.source, []).append(edge.id)

    def reset(self) -> None:
        for node in self.nodes.values():
            node.active = True
            node.forced_active = None
        for edge in self.edges.values():
            edge.usable = True
            edge.forced_usable = None
            edge.degradation = {"truck": 1.0, "bike": 1.0, "drone": 1.0}

    def apply_scenario(self, scenario: Scenario) -> None:
        for nid, down in scenario.node_outages.items():
            if nid in self.nodes:
                self.nodes[nid].active = not down
        for eid, blocked in scenario.route_outages.items():
            if eid in self.edges:
                self.edges[eid].usable = not blocked
        for eid, degradation in scenario.degradation_updates.items():
            if eid in self.edges:
                self.edges[eid].degradation.update(degradation)


class DisasterResourceAllocator:
    def __init__(self, graph: DynamicGraph) -> None:
        self.graph = graph

    def _tier_penalty(self, node: Node) -> float:
        return (4 - node.tier) * node.priority

    def stage1_decision(self, thresh_priority: float = 1.0) -> Dict[str, int]:
        decision: Dict[str, int] = {}
        for node in self.graph.nodes.values():
            val = 1 if node.priority >= thresh_priority else 0
            decision[node.id] = val
            node.set_active(bool(val))
        return decision

    def _available_sources(self) -> List[Node]:
        sources = [n for n in self.graph.nodes.values() if n.role in ("warehouse", "distribution") and n.effective_active() and n.supply > 0]
        return sorted(sources, key=lambda n: (-n.priority, n.tier))

    def _demand_nodes(self) -> List[Node]:
        demands = [n for n in self.graph.nodes.values() if n.role in ("hospital", "shelter", "distribution") and n.effective_active() and n.demand > 0]
        return sorted(demands, key=lambda n: (n.tier, -n.priority))

    def flow_allocation(self, vehicle_type: str = "truck") -> Tuple[List[Dict[str, Any]], Dict[str, float]]:
        flows: List[Dict[str, Any]] = []
        unmet: Dict[str, float] = {}

        supplies = {n.id: n.supply for n in self._available_sources()}
        for demand_node in self._demand_nodes():
            required = demand_node.demand
            remaining = required

            in_edges = [e for e in self.graph.edges.values() if e.target == demand_node.id and e.effective_usable()]
            # Sort by source priority and lower tier first
            in_edges_sorted = sorted(in_edges, key=lambda e: (-self.graph.nodes[e.source].priority, self.graph.nodes[e.source].tier))

            for edge in in_edges_sorted:
                if remaining <= 0:
                    break
                if supplies.get(edge.source, 0) <= 0:
                    continue
                capacity = edge.capacity(vehicle_type)
                send = min(capacity, supplies[edge.source], remaining)
                if send <= 0:
                    continue
                flows.append({
                    "from": edge.source,
                    "to": edge.target,
                    "edge": edge.id,
                    "quantity": send,
                    "vehicle": vehicle_type,
                    "cost": send * edge.base_cost,
                })
                supplies[edge.source] -= send
                remaining -= send

            # fallback 1-hop through transit nodes
            if remaining > 0:
                transits = [n for n in self.graph.nodes.values() if n.role == "distribution" and n.effective_active()]
                for transit in transits:
                    if remaining <= 0:
                        break
                    edge1 = next((e for e in self.graph.edges.values() if e.source == transit.id and e.target == demand_node.id and e.effective_usable()), None)
                    if not edge1:
                        continue
                    for src_id, src_supply in supplies.items():
                        if src_supply <= 0 or src_id == transit.id:
                            continue
                        edge0 = next((e for e in self.graph.edges.values() if e.source == src_id and e.target == transit.id and e.effective_usable()), None)
                        if not edge0:
                            continue
                        cap0 = edge0.capacity(vehicle_type)
                        cap1 = edge1.capacity(vehicle_type)
                        cap_left = min(cap0, cap1, supplies[src_id], remaining)
                        if cap_left <= 0:
                            continue
                        flows.append({"from": src_id, "to": transit.id, "edge": edge0.id, "quantity": cap_left, "vehicle": vehicle_type, "cost": cap_left * edge0.base_cost})
                        flows.append({"from": transit.id, "to": demand_node.id, "edge": edge1.id, "quantity": cap_left, "vehicle": vehicle_type, "cost": cap_left * edge1.base_cost})
                        supplies[src_id] -= cap_left
                        remaining -= cap_left

            unmet[demand_node.id] = float(max(0.0, remaining))

        return flows, unmet

    def flow_allocation_lp(self, vehicle_type: str = "truck") -> Tuple[List[Dict[str, Any]], Dict[str, float]]:
        """
        Optimized flow allocation using Linear Programming (PuLP).
        Minimizes total cost subject to capacity, supply, demand constraints.
        """
        flows: List[Dict[str, Any]] = {}
        unmet: Dict[str, float] = {}

        # Collect sources and demands
        sources = {n.id: n.supply for n in self._available_sources()}
        demands = {n.id: n.demand for n in self._demand_nodes()}

        # Collect edges with path distances
        edges = [(e.source, e.target, e.id, e.capacity(vehicle_type), e.compute_path_distance()) for e in self.graph.edges.values() if e.effective_usable()]

        if not sources or not demands:
            return [], demands  # No flows possible

        # LP Model
        prob = LpProblem("Disaster_Resource_Allocation", LpMinimize)

        # Variables: flow from source to demand via edge
        flow_vars = {}
        for src, dem in [(s, d) for s in sources for d in demands]:
            for e_src, e_dem, e_id, cap, cost in edges:
                if e_src == src and e_dem == dem:
                    flow_vars[(src, dem, e_id)] = LpVariable(f"flow_{src}_{dem}_{e_id}", 0, cap, cat=LpInteger)

        # Objective: Minimize total cost (distance-based)
        prob += lpSum(flow_vars[(s, d, e)] * next(cost for es, ed, eid, cap, cost in edges if es == s and ed == d and eid == e) for s, d, e in flow_vars), "Total_Cost"

        # Constraints
        # Supply constraints
        for src in sources:
            prob += lpSum(flow_vars[(src, d, e)] for d, e in [(d, e) for s, d, e in flow_vars if s == src]) <= sources[src], f"Supply_{src}"

        # Demand constraints (can be unmet, but minimize unmet implicitly via objective)
        for dem in demands:
            inflow = lpSum(flow_vars[(s, dem, e)] for s, e in [(s, e) for s, d, e in flow_vars if d == dem])
            unmet_var = LpVariable(f"unmet_{dem}", 0, demands[dem], cat=LpInteger)
            prob += inflow + unmet_var >= demands[dem], f"Demand_{dem}"
            unmet[dem] = unmet_var  # Store for later

        # Solve
        status = prob.solve()
        if LpStatus[status] != "Optimal":
            # Fallback to heuristic if LP fails
            return self.flow_allocation(vehicle_type)

        # Extract results
        flows_list = []
        for (src, dem, e_id), var in flow_vars.items():
            qty = var.varValue
            if qty > 0:
                cost_val = next(cost for s, d, eid, cap, cost in edges if s == src and d == dem and eid == e_id)
                flows_list.append({
                    "from": src,
                    "to": dem,
                    "edge": e_id,
                    "quantity": qty,
                    "vehicle": vehicle_type,
                    "cost": qty * cost_val,
                })

        # Unmet values
        unmet_vals = {dem: unmet[dem].varValue for dem in unmet}

        return flows_list, unmet_vals

    def robust_worst_case(self, scenario_results: Dict[str, Dict[str, float]]) -> Dict[str, float]:
        worst: Dict[str, float] = {}
        for scenario_name, data in scenario_results.items():
            for node, value in data.items():
                worst[node] = max(worst.get(node, 0), value)
        return worst

    def explain(self, flows: List[Dict[str, Any]], unmet: Dict[str, float], robust_margin: Dict[str, float]) -> List[Dict[str, Any]]:
        explanation: List[Dict[str, Any]] = []
        for node in self.graph.nodes.values():
            explanation.append({
                "node": node.id,
                "role": node.role,
                "tier": node.tier,
                "active": node.effective_active(),
                "priority": node.priority,
                "unmet": unmet.get(node.id, 0),
                "robust_margin": robust_margin.get(node.id, 0),
                "top_factors": [
                    "high priority" if node.priority >= 2 else "medium priority", 
                    "tier-{}".format(node.tier),
                    "source" if node.role == "warehouse" else "demand" if node.role in ("hospital", "shelter") else "transit"
                ],
                "risk": "low" if node.priority >= 2 else "medium" if node.priority >= 1 else "high"
            })

        for edge in self.graph.edges.values():
            explanation.append({
                "edge": edge.id,
                "from": edge.source,
                "to": edge.target,
                "usable": edge.effective_usable(),
                "capacity_truck": edge.capacity("truck"),
                "capacity_bike": edge.capacity("bike"),
                "capacity_drone": edge.capacity("drone"),
                "top_factors": ["blocked" if not edge.effective_usable() else "open", "base_cost_{}".format(edge.base_cost)],
                "risk": "high" if not edge.effective_usable() else "medium"
            })

        explanation.append({
            "summary": "robust and explainability metrics",
            "robust_margin": robust_margin,
            "unmet_nodes": unmet
        })
        return explanation

    def run(self,
            scenarios: List[Scenario],
            mode: str = "static",
            rolling_horizon_steps: int = 1,
            hitl_overrides: Optional[Dict[str, Any]] = None,
            vehicle_type: str = "truck") -> Dict[str, Any]:

        if hitl_overrides:
            self.apply_hitl(hitl_overrides)

        result: Dict[str, Any] = {
            "flows": [],
            "active_nodes": [],
            "critical_routes": [],
            "unmet_demand": [],
            "explanations": [],
            "robust_margin": {}
        }

        self.stage1_decision(thresh_priority=1.0)

        scenario_unmet: Dict[str, Dict[str, float]] = {}
        scenario_flow: Dict[str, List[Dict[str, Any]]] = {}

        for scenario in scenarios:
            graph_copy = deepcopy(self.graph)
            graph_copy.apply_scenario(scenario)

            allocator = DisasterResourceAllocator(graph_copy)
            allocator.stage1_decision(thresh_priority=1.0)
            flows, unmet = allocator.flow_allocation(vehicle_type=vehicle_type)

            scenario_flow[scenario.name] = flows
            scenario_unmet[scenario.name] = unmet

        robust_margin = self.robust_worst_case(scenario_unmet)

        if mode == "static":
            baseline = scenarios[0]
            graph_copy = deepcopy(self.graph)
            graph_copy.apply_scenario(baseline)
            allocator = DisasterResourceAllocator(graph_copy)
            allocator.stage1_decision(thresh_priority=1.0)
            flows, unmet = allocator.flow_allocation(vehicle_type=vehicle_type)

            result["flows"] = flows
            result["active_nodes"] = [nid for nid, node in graph_copy.nodes.items() if node.effective_active()]
            result["critical_routes"] = [eid for eid, edge in graph_copy.edges.items() if edge.effective_usable()]
            result["unmet_demand"] = [{"scenario": baseline.name, "unmet": unmet}]
            result["robust_margin"] = robust_margin
            result["explanations"] = self.explain(flows, unmet, robust_margin)

        elif mode == "rolling":
            cumulative_unmet: Dict[str, float] = {}
            for t in range(rolling_horizon_steps):
                scenario = random.choice(scenarios)
                graph_copy = deepcopy(self.graph)
                graph_copy.apply_scenario(scenario)
                allocator = DisasterResourceAllocator(graph_copy)
                allocator.stage1_decision(thresh_priority=1.0)
                flows, unmet = allocator.flow_allocation(vehicle_type=vehicle_type)

                for key, value in unmet.items():
                    cumulative_unmet[key] = cumulative_unmet.get(key, 0) + value

                result["flows"].extend(flows)

            # Use original graph state for listing active nodes/routes, not cumulatively mutated
            result["active_nodes"] = [nid for nid, node in self.graph.nodes.items() if node.effective_active()]
            result["critical_routes"] = [eid for eid, edge in self.graph.edges.items() if edge.effective_usable()]
            result["unmet_demand"] = [{"rolling_horizon": cumulative_unmet}]
            result["robust_margin"] = robust_margin
            result["explanations"] = self.explain(result["flows"], cumulative_unmet, robust_margin)

        else:
            raise ValueError("Unknown mode: {}".format(mode))

        return result

    def apply_hitl(self, overrides: Dict[str, Any]) -> None:
        if "weights" in overrides:
            for nid, w in overrides["weights"].items():
                if nid in self.graph.nodes:
                    self.graph.nodes[nid].set_priority(w)

        if "force_node" in overrides:
            for nid, state in overrides["force_node"].items():
                if nid in self.graph.nodes:
                    self.graph.nodes[nid].set_active(bool(state))

        if "force_route" in overrides:
            for eid, state in overrides["force_route"].items():
                if eid in self.graph.edges:
                    self.graph.edges[eid].set_usable(bool(state))


def build_default_graph() -> DynamicGraph:
    graph = DynamicGraph()
    # Simple 10x10 grid for demo: 0=free, 1=obstacle, 2=risk
    grid = [
        [0,0,0,0,0,0,0,0,0,0],
        [0,1,0,0,0,0,0,0,0,0],
        [0,0,0,2,2,0,0,0,0,0],
        [0,0,0,2,2,0,0,0,0,0],
        [0,0,0,0,0,0,0,0,0,0],
        [0,0,0,0,0,0,0,0,0,0],
        [0,0,0,0,0,0,0,0,0,0],
        [0,0,0,0,0,0,0,0,0,0],
        [0,0,0,0,0,0,0,0,0,0],
        [0,0,0,0,0,0,0,0,0,0],
    ]
    positions = {
        "W1": (0,0), "W2": (0,9), "H1": (5,0), "H2": (5,9),
        "S1": (9,0), "S2": (9,4), "S3": (9,9)
    }

    graph.add_node(Node("W1", "warehouse", tier=1, supply=500, priority=2.0))
    graph.add_node(Node("W2", "warehouse", tier=1, supply=400, priority=1.8))
    graph.add_node(Node("H1", "distribution", tier=2, supply=0, demand=0, priority=1.5))
    graph.add_node(Node("H2", "distribution", tier=2, supply=0, demand=0, priority=1.2))
    graph.add_node(Node("S1", "hospital", tier=3, demand=200, priority=3.0))
    graph.add_node(Node("S2", "shelter", tier=3, demand=150, priority=2.5))
    graph.add_node(Node("S3", "hospital", tier=3, demand=180, priority=2.2))

    graph.add_edge(Edge("E1", "W1", "H1", base_capacity=300, base_cost=1.0, grid_map=grid, source_pos=positions["W1"], target_pos=positions["H1"]))
    graph.add_edge(Edge("E2", "W2", "H1", base_capacity=250, base_cost=1.1, grid_map=grid, source_pos=positions["W2"], target_pos=positions["H1"]))
    graph.add_edge(Edge("E3", "W1", "H2", base_capacity=200, base_cost=1.2, grid_map=grid, source_pos=positions["W1"], target_pos=positions["H2"]))
    graph.add_edge(Edge("E4", "H1", "S1", base_capacity=180, base_cost=1.5, grid_map=grid, source_pos=positions["H1"], target_pos=positions["S1"]))
    graph.add_edge(Edge("E5", "H1", "S2", base_capacity=150, base_cost=1.4, grid_map=grid, source_pos=positions["H1"], target_pos=positions["S2"]))
    graph.add_edge(Edge("E6", "H2", "S3", base_capacity=160, base_cost=1.6, grid_map=grid, source_pos=positions["H2"], target_pos=positions["S3"]))

    return graph


def create_default_scenarios() -> List[Scenario]:
    return [
        Scenario("baseline", demand_multiplier=1.0),
        Scenario("road_damage", demand_multiplier=1.2, route_outages={"E1": True}, degradation_updates={"E3": {"truck": 0.5}}),
        Scenario("node_outage", demand_multiplier=1.3, node_outages={"H1": True}, route_outages={"E5": True}, degradation_updates={"E6": {"drone": 0.5}}),
    ]


def main() -> None:
    graph = build_default_graph()
    scenarios = create_default_scenarios()

    allocator = DisasterResourceAllocator(graph)

    hitl = {
        "weights": {"S3": 3.0},
        "force_node": {"H2": True},
        "force_route": {"E1": False}
    }

    static_out = allocator.run(scenarios, mode="static", hitl_overrides=hitl)
    rolling_out = allocator.run(scenarios, mode="rolling", rolling_horizon_steps=3, hitl_overrides=hitl)

    print("=== Static mode result ===")
    print(json.dumps(static_out, indent=2))

    print("=== Rolling horizon mode result ===")
    print(json.dumps(rolling_out, indent=2))


if __name__ == "__main__":
    main()
