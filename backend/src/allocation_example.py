"""
Example: integrate disaster resource allocator into the backend.

This shows how to:
1. Build a resource network from SOS ingest data.
2. Create scenarios (e.g., roads damaged, demand spike).
3. Run allocation to optimize supply routing.
4. Expose a `/v1/allocate` endpoint for operators.
"""

from disaster_alloc import DynamicGraph, Node, Edge, Scenario, DisasterResourceAllocator


def build_network_from_sos_data(sos_messages, supply_hubs, demand_points):
    """
    Build a DynamicGraph from ingested SOS and known infrastructure.
    
    Args:
        sos_messages: list of {"msg_id", "lat_e7", "lon_e7", "emergency_code", ...}
        supply_hubs: list of {"id", "name", "lat", "lon", "supply_qty"}
        demand_points: list of {"id", "name", "lat", "lon", "demand_qty", "priority"}
    
    Returns:
        DynamicGraph with nodes and edges.
    """
    g = DynamicGraph()

    # Add supply nodes
    for hub in supply_hubs:
        node = Node(
            node_id=hub["id"],
            role="warehouse",
            tier=1,
            supply=hub.get("supply_qty", 0),
            priority=2.0
        )
        g.add_node(node)

    # Add demand nodes (hospitals, shelters, distribution centers)
    for dem in demand_points:
        node = Node(
            node_id=dem["id"],
            role=dem.get("role", "hospital"),
            tier=dem.get("tier", 3),
            demand=dem.get("demand_qty", 0),
            priority=dem.get("priority", 1.5)
        )
        g.add_node(node)

    # Add intermediate hubs for multi-tier routing
    g.add_node(Node("hub_central", "distribution", tier=2, supply=0, demand=0, priority=1.5))

    # Add edges (routes) with capacity based on distance/vehicle type
    # In a real system, these come from GIS/OSM.
    edge_id = 0
    for hub in supply_hubs:
        for dem in demand_points:
            # simple: capacity decreases with rough distance
            dist_estimate = ((hub["lat"] - dem["lat"]) ** 2 + (hub["lon"] - dem["lon"]) ** 2) ** 0.5
            capacity = max(50, 500 - dist_estimate * 100)  # degrade with distance
            edge = Edge(
                edge_id=f"route_{edge_id}",
                source=hub["id"],
                target=dem["id"],
                base_capacity=capacity,
                base_cost=1.0 + dist_estimate * 0.1
            )
            g.add_edge(edge)
            edge_id += 1

    return g


def example_allocation():
    """
    Demo: allocate resources given a network, scenarios, and HITL input.
    """
    # Example network
    g = DynamicGraph()

    # Warehouses (supply)
    g.add_node(Node("W1", "warehouse", tier=1, supply=500, priority=2.0))
    g.add_node(Node("W2", "warehouse", tier=1, supply=400, priority=1.8))

    # Distribution hubs
    g.add_node(Node("H1", "distribution", tier=2, supply=0, demand=0, priority=1.5))
    g.add_node(Node("H2", "distribution", tier=2, supply=0, demand=0, priority=1.2))

    # Hospitals and shelters (demand)
    g.add_node(Node("S1", "hospital", tier=3, supply=0, demand=200, priority=3.0))
    g.add_node(Node("S2", "shelter", tier=3, supply=0, demand=150, priority=2.5))
    g.add_node(Node("S3", "hospital", tier=3, supply=0, demand=180, priority=2.2))

    # Routes
    g.add_edge(Edge("E1", "W1", "H1", base_capacity=300, base_cost=1.0))
    g.add_edge(Edge("E2", "W2", "H1", base_capacity=250, base_cost=1.1))
    g.add_edge(Edge("E3", "W1", "H2", base_capacity=200, base_cost=1.2))
    g.add_edge(Edge("E4", "H1", "S1", base_capacity=180, base_cost=1.5))
    g.add_edge(Edge("E5", "H1", "S2", base_capacity=150, base_cost=1.4))
    g.add_edge(Edge("E6", "H2", "S3", base_capacity=160, base_cost=1.6))

    # Scenarios: baseline, road damage, high demand
    scenarios = [
        Scenario("baseline", demand_mult=1.0, outages={}, route_impact={}, weather_impact={}),
        Scenario("road_damage", demand_mult=1.2, outages={}, route_impact={"E1": False, "E4": True}, weather_impact={"E3": {"truck": 0.5}}),
        Scenario("node_outage", demand_mult=1.3, outages={"H1": True}, route_impact={"E5": False}, weather_impact={"E6": {"drone": 0.5}})
    ]

    # Human-in-the-loop: boost priority of hospital S3, ensure H2 stays open, disable E1
    hitl_overrides = {
        "weights": {"S3": 3.0},
        "force_node": {"H2": True},
        "force_route": {"E1": False}
    }

    # Run allocation
    allocator = DisasterResourceAllocator(g)
    result = allocator.run(scenarios, mode="static", hitl_overrides=hitl_overrides)

    return result


if __name__ == "__main__":
    result = example_allocation()
    import json
    print(json.dumps(result, indent=2, default=str))
