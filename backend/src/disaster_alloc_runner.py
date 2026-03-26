#!/usr/bin/env python3
"""
Disaster Allocator v2 Runner
Entry point for Node.js subprocess communication
Reads config from stdin (JSON), returns result via stdout (JSON)
"""

import sys
import json
from disaster_alloc import (
    Node, Edge, Scenario, DynamicGraph, DisasterResourceAllocator
)

def main():
    try:
        # Read config from stdin
        config_str = sys.stdin.read()
        config = json.loads(config_str)
        
        # Build graph from config
        graph = DynamicGraph()
        
        # Add nodes
        for node_data in config.get('nodes', []):
            node = Node(
                node_data['id'],
                node_data.get('role', 'distribution'),
                node_data.get('tier', 2),
                node_data.get('supply', 0),
                node_data.get('demand', 0),
                node_data.get('priority', 1.0)
            )
            graph.add_node(node)
        
        # Add edges
        for edge_data in config.get('edges', []):
            edge = Edge(
                edge_data['id'],
                edge_data['source'],
                edge_data['target'],
                edge_data.get('base_capacity', 100),
                edge_data.get('base_cost', 1.0),
                edge_data.get('vehicle_types', ['truck', 'bike', 'drone'])
            )
            
            # Apply degradation if specified
            if 'degradation' in edge_data:
                edge.degradation = edge_data['degradation']
            
            graph.add_edge(edge)
        
        # Build scenarios
        scenarios = []
        for scenario_data in config.get('scenarios', []):
            scenario = Scenario(
                scenario_data['name'],
                scenario_data.get('demand_mult', 1.0),
                scenario_data.get('outages', {}),
                scenario_data.get('route_impact', {}),
                scenario_data.get('weather_impact', {})
            )
            scenarios.append(scenario)
        
        # Run allocator
        allocator = DisasterResourceAllocator(graph)
        result = allocator.run(
            scenarios=scenarios,
            mode=config.get('mode', 'static'),
            rolling_steps=config.get('rolling_steps', 1),
            hitl_overrides=config.get('hitl_overrides')
        )
        
        # Output result as JSON
        print(json.dumps(result, indent=2, default=str))
        sys.exit(0)
        
    except Exception as e:
        error_result = {
            'error': str(e),
            'type': type(e).__name__,
            'flows': [],
            'active_nodes': [],
            'critical_routes': [],
            'unmet_demand': [],
            'explanations': [],
            'robust_margin': {}
        }
        print(json.dumps(error_result, indent=2))
        sys.exit(1)

if __name__ == '__main__':
    main()
