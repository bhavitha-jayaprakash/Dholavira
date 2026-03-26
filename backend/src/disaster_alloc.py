"""
Disaster Resource Allocator

Optimizes supply routing and resource deployment across a disaster zone given:
- Nodes: warehouses, distribution centers, hospitals, shelters (with supply/demand)
- Routes: edges with capacity, vehicle types, degradation factors
- Scenarios: outages, weather, demand multipliers
- Human-in-the-loop: force node state, route usability, priority weights

Outputs:
- Flow plan: which supply moves where, by vehicle, at what time
- Active nodes: operational facilities in each scenario
- Critical routes: usable supply corridors
- Robust margin: extra stock needed to handle worst-case scenario
- Explanations: why each decision was made (for operator transparency)
"""

import json
import random
from copy import deepcopy


class Node:
    def __init__(self, node_id, role, tier, supply=0.0, demand=0.0, priority=1.0):
        self.id = node_id
        self.role = role
        self.tier = tier
        self.supply = supply
        self.demand = demand
        self.priority = priority
        self.active = True
        self.forced_state = None  # None, True, False

    def set_priority(self, new_w):
        self.priority = new_w

    def set_active(self, on):
        self.active = on
        self.forced_state = on

    def reset_forced(self):
        self.forced_state = None

    def effective_active(self):
        if self.forced_state is not None:
            return self.forced_state
        return self.active


class Edge:
    def __init__(self, edge_id, source, target, base_capacity, base_cost=1.0, vehicle_types=None):
        self.id = edge_id
        self.source = source
        self.target = target
        self.base_capacity = base_capacity
        self.base_cost = base_cost
        self.vehicle_types = vehicle_types or ["truck", "bike", "drone"]
        self.usable = True
        self.forced_state = None
        self.degradation = {"truck": 1.0, "bike": 1.0, "drone": 1.0}

    def set_usable(self, ok):
        self.usable = ok
        self.forced_state = ok

    def reset_forced(self):
        self.forced_state = None

    def effective_usable(self):
        if self.forced_state is not None:
            return self.forced_state
        return self.usable

    def capacity_for_vehicle(self, vehicle_type):
        if not self.effective_usable():
            return 0.0
        factor = self.degradation.get(vehicle_type, 1.0)
        return self.base_capacity * factor


class Scenario:
    def __init__(self, name, demand_mult=1.0, outages=None, route_impact=None, weather_impact=None):
        self.name = name
        self.demand_mult = demand_mult
        self.outages = outages or {}  # node_id -> closed bool
        self.route_impact = route_impact or {}  # edge_id -> usable bool
        self.weather_impact = weather_impact or {}  # edge_id -> {v: factor}


class DynamicGraph:
    def __init__(self):
        self.nodes = {}
        self.edges = {}
        self.adj = {}

    def add_node(self, node):
        self.nodes[node.id] = node
        self.adj[node.id] = []

    def add_edge(self, edge):
        self.edges[edge.id] = edge
        self.adj.setdefault(edge.source, []).append(edge.id)

    def update_scenario(self, scenario):
        for nid, closed in scenario.outages.items():
            if nid in self.nodes:
                self.nodes[nid].active = not closed
        for eid, usable in scenario.route_impact.items():
            if eid in self.edges:
                self.edges[eid].usable = usable
        for eid, impacts in scenario.weather_impact.items():
            if eid in self.edges:
                self.edges[eid].degradation.update(impacts)

    def reset_state(self):
        for n in self.nodes.values():
            n.active = True
            n.reset_forced()
        for e in self.edges.values():
            e.usable = True
            e.degradation = {"truck": 1.0, "bike": 1.0, "drone": 1.0}
            e.reset_forced()


class DisasterResourceAllocator:
    def __init__(self, graph):
        self.graph = graph
        self.locked_edges = set()
        self.explanations = []

    def degradation_factor(self, vehicle_type):
        return {
            "truck": 1.0,
            "bike": 0.6,
            "drone": 0.8
        }.get(vehicle_type, 1.0)

    def compute_flow_capacity(self, edge, vehicle_type):
        insp = edge.capacity_for_vehicle(vehicle_type)
        # apply global factor
        return insp * self.degradation_factor(vehicle_type)

    def stage1_plan(self, scenarios, time_period=0):
        plan = {
            "y": {},
            "preposition": {},
            "scenario_outcomes": {}
        }
        # base policy: open top priority nodes, close others if no requirement.
        sorted_nodes = sorted(self.graph.nodes.values(), key=lambda n: (-n.priority, n.tier))
        for n in sorted_nodes:
            plan["y"][n.id] = int(n.priority >= 0.5)

        # preposition: allocate supplies along shortest tier path (greedy) across scenarios
        for s in scenarios:
            # apply scenario to temp graph
            temp_graph = deepcopy(self.graph)
            temp_graph.reset_state()
            temp_graph.update_scenario(s)
            flow_plan, unmatched = self.allocate_for_scenario(temp_graph, s, time_period)
            plan["scenario_outcomes"][s.name] = {
                "flow": flow_plan,
                "unmet": unmatched
            }

        return plan

    def allocate_for_scenario(self, graph_state, scenario, time_period=0):
        flows = []
        unmet = {}
        # apply demand multiplier then flow from supply to demand by tier.
        demands = {nid: n.demand * scenario.demand_mult for nid, n in graph_state.nodes.items() if n.role in ("hospital", "shelter", "distribution")}
        supplies = {nid: n.supply for nid, n in graph_state.nodes.items() if n.role in ("warehouse", "distribution")}

        # simple rule: send upstream->downstream by tier order
        tier_sorted_demands = sorted(demands.items(), key=lambda x: (graph_state.nodes[x[0]].tier, -graph_state.nodes[x[0]].priority))

        for dem_node, dem_val in tier_sorted_demands:
            if not graph_state.nodes[dem_node].effective_active():
                unmet[dem_node] = dem_val
                continue
            remaining = dem_val
            # source from any active supply node in lower tier or same tier
            for src_id, src_val in supplies.items():
                if remaining <= 0:
                    break
                if not graph_state.nodes[src_id].effective_active():
                    continue
                # find edges from src to dem
                candidate_edges = [graph_state.edges[eid] for eid in graph_state.adj.get(src_id, []) if graph_state.edges[eid].target == dem_node]
                if not candidate_edges:
                    continue
                for e in candidate_edges:
                    if not e.effective_usable():
                        continue
                    vehicle = "truck"
                    cap = self.compute_flow_capacity(e, vehicle)
                    if cap <= 0:
                        continue
                    send = min(cap, remaining, supplies[src_id])
                    if send <= 0:
                        continue
                    flows.append({"from": src_id, "to": dem_node, "edge": e.id, "qty": send, "vehicle": vehicle, "time": time_period})
                    supplies[src_id] -= send
                    remaining -= send
                    if remaining <= 1e-8:
                        break
            if remaining > 0:
                # allow transit via one-hop if direct not enough
                for transit_id, transit_node in graph_state.nodes.items():
                    if transit_id == dem_node or transit_id in supplies and supplies[transit_id] <= 0:
                        continue
                    if not transit_node.effective_active():
                        continue
                    path1_edges = [graph_state.edges[eid] for eid in graph_state.adj.get(transit_id, []) if graph_state.edges[eid].target == dem_node]
                    if not path1_edges:
                        continue
                    # try pulling from source to transit then transit to demand
                    for src_id in supplies:
                        if supplies[src_id] <= 0 or not graph_state.nodes[src_id].effective_active():
                            continue
                        path0_edges = [graph_state.edges[eid] for eid in graph_state.adj.get(src_id, []) if graph_state.edges[eid].target == transit_id]
                        if not path0_edges:
                            continue
                        e0 = path0_edges[0]
                        e1 = path1_edges[0]
                        if not e0.effective_usable() or not e1.effective_usable():
                            continue
                        cap0 = self.compute_flow_capacity(e0, "truck")
                        cap1 = self.compute_flow_capacity(e1, "truck")
                        cap = min(cap0, cap1, supplies[src_id], remaining)
                        if cap <= 0:
                            continue
                        flows.append({"from": src_id, "to": transit_id, "edge": e0.id, "qty": cap, "vehicle": "truck", "time": time_period})
                        flows.append({"from": transit_id, "to": dem_node, "edge": e1.id, "qty": cap, "vehicle": "truck", "time": time_period})
                        supplies[src_id] -= cap
                        remaining -= cap
                        if remaining <= 1e-8:
                            break
                    if remaining <= 1e-8:
                        break
            unmet[dem_node] = max(0.0, remaining)

        return flows, unmet

    def compute_robust_adjustment(self, plan, scenarios):
        # find worst-case unmet demand across scenarios, adjust by adding extra dispatch margin
        worst_unmet = {}
        for sname, out in plan["scenario_outcomes"].items():
            for nid, unmet in out["unmet"].items():
                worst_unmet[nid] = max(worst_unmet.get(nid, 0), unmet)

        robust_margin = {nid: worst_unmet[nid] * 0.5 for nid in worst_unmet}
        # simply report robust margin hinged to worst-case to ensure min service
        return robust_margin

    def explain_plan(self, stage1, stage2, robust_margin):
        explanations = []
        # for each node and route determine top factors
        for nid, node in self.graph.nodes.items():
            factors = []
            if node.priority > 1.0:
                factors.append("High priority weight")
            if node.tier == 1:
                factors.append("Central tier1 role")
            if node.role == "warehouse":
                factors.append("Supply hub")
            if len(factors) < 3:
                factors.append("Availability in scenario")
            level = "low" if node.priority >= 2.0 else "medium" if node.priority >= 1.0 else "high"
            explanations.append({
                "node": nid,
                "top_factors": factors[:3],
                "risk": level,
                "sensitivity": "high" if node.tier >= 2 else "medium"
            })

        for eid, edge in self.graph.edges.items():
            factors = []
            if not edge.effective_usable():
                factors.append("Route outage")
            if edge.base_capacity < 20:
                factors.append("Limited base capacity")
            if len(factors) < 3:
                factors.append("Used by critical demand")
            level = "high" if not edge.effective_usable() else "medium"
            explanations.append({
                "edge": eid,
                "top_factors": factors[:3],
                "risk": level,
                "sensitivity": "high" if edge.base_capacity < 50 else "medium"
            })

        # include robust margin summary
        explanations.append({
            "robust_margin": robust_margin,
            "risk": "medium",
            "comment": "Margins protect against worst-case unmet demand"
        })

        return explanations

    def run(self, scenarios, mode="static", rolling_steps=1, hitl_overrides=None):
        self.explanations = []
        if hitl_overrides:
            self.apply_hitl(hitl_overrides)

        results = {
            "flows": [],
            "active_nodes": [],
            "critical_routes": [],
            "unmet_demand": [],
            "explanations": [],
            "robust_margin": {}
        }

        if mode == "static":
            stage1 = self.stage1_plan(scenarios)
            robust = self.compute_robust_adjustment(stage1, scenarios)
            chosen_scenario = scenarios[0]
            # stage2 realized
            gs = deepcopy(self.graph)
            gs.reset_state(); gs.update_scenario(chosen_scenario)
            flow2, unmet = self.allocate_for_scenario(gs, chosen_scenario)
            results["flows"] = flow2
            results["active_nodes"] = [nid for nid,n in gs.nodes.items() if n.effective_active()]
            results["critical_routes"] = [eid for eid, e in gs.edges.items() if e.effective_usable()]
            results["unmet_demand"] = [{"scenario": chosen_scenario.name, "unmet": unmet}]
            results["explanations"] = self.explain_plan(stage1, flow2, robust)
            results["robust_margin"] = robust
        elif mode == "rolling":
            cumulative_unmet = {}
            for t in range(1, rolling_steps+1):
                scenario = random.choice(scenarios)
                gs = deepcopy(self.graph)
                gs.reset_state(); gs.update_scenario(scenario)
                stage1 = self.stage1_plan(scenarios, time_period=t)
                robust = self.compute_robust_adjustment(stage1, scenarios)
                flow2, unmet = self.allocate_for_scenario(gs, scenario, time_period=t)
                self.explanations = self.explain_plan(stage1, flow2, robust)
                results["flows"].extend(flow2)
                results["active_nodes"] = [nid for nid,n in gs.nodes.items() if n.effective_active()]
                results["critical_routes"] = [eid for eid,e in gs.edges.items() if e.effective_usable()]
                for k,v in unmet.items():
                    cumulative_unmet[k] = cumulative_unmet.get(k, 0)+v
            results["unmet_demand"] = [{"rolling_horizon": cumulative_unmet}]
            results["explanations"] = self.explanations
            results["robust_margin"] = robust
        else:
            raise ValueError("Unknown mode")

        return results

    def apply_hitl(self, overrides):
        if "weights" in overrides:
            for nid, w in overrides["weights"].items():
                if nid in self.graph.nodes:
                    self.graph.nodes[nid].set_priority(w)

        if "force_node" in overrides:
            for nid, state in overrides["force_node"].items():
                if nid in self.graph.nodes:
                    self.graph.nodes[nid].set_active(state)

        if "force_route" in overrides:
            for eid, state in overrides["force_route"].items():
                if eid in self.graph.edges:
                    self.graph.edges[eid].set_usable(state)
