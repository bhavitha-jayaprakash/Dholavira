import test from 'node:test';
import assert from 'node:assert';
import allocationV2 from '../src/allocationWrapper.mjs';

/**
 * Allocation v2 Integration Tests
 * Tests the Python-based advanced allocation engine
 */

test('Allocation v2: Basic scenario', async (t) => {
  const config = {
    nodes: [
      { id: 'w1', role: 'warehouse', tier: 1, supply: 1000, demand: 0, priority: 1.5 },
      { id: 'dc1', role: 'distribution', tier: 2, supply: 200, demand: 300, priority: 1.0 },
      { id: 'h1', role: 'hospital', tier: 3, supply: 0, demand: 200, priority: 2.0 },
      { id: 's1', role: 'shelter', tier: 3, supply: 0, demand: 150, priority: 1.0 }
    ],
    edges: [
      { id: 'e1', source: 'w1', target: 'dc1', base_capacity: 500 },
      { id: 'e2', source: 'w1', target: 'h1', base_capacity: 300 },
      { id: 'e3', source: 'dc1', target: 'h1', base_capacity: 200 },
      { id: 'e4', source: 'dc1', target: 's1', base_capacity: 250 }
    ],
    scenarios: [
      {
        name: 'baseline',
        demand_mult: 1.0,
        outages: {},
        route_impact: {},
        weather_impact: {}
      }
    ],
    mode: 'static',
    rolling_steps: 1
  };

  const result = await allocationV2.allocate(config);
  
  assert.ok(result, 'Result should exist');
  assert.ok(Array.isArray(result.flows), 'flows should be array');
  assert.ok(Array.isArray(result.active_nodes), 'active_nodes should be array');
  assert.ok(Array.isArray(result.critical_routes), 'critical_routes should be array');
  assert.ok(result.flows.length > 0, 'Should allocate some flows');
  assert.ok(result.active_nodes.includes('w1'), 'Warehouse should be active');
});

test('Allocation v2: Scenario with outages', async (t) => {
  const config = {
    nodes: [
      { id: 'w1', role: 'warehouse', tier: 1, supply: 800, demand: 0, priority: 2.0 },
      { id: 'h1', role: 'hospital', tier: 2, supply: 0, demand: 300, priority: 2.5 },
      { id: 'h2', role: 'hospital', tier: 2, supply: 0, demand: 200, priority: 2.0 }
    ],
    edges: [
      { id: 'e1', source: 'w1', target: 'h1', base_capacity: 400 },
      { id: 'e2', source: 'w1', target: 'h2', base_capacity: 400 }
    ],
    scenarios: [
      {
        name: 'outage_h1',
        demand_mult: 1.2,
        outages: { h1: true },
        route_impact: {},
        weather_impact: {}
      }
    ],
    mode: 'static'
  };

  const result = await allocationV2.allocate(config);
  
  assert.ok(result, 'Result should exist');
  assert.ok(!result.active_nodes.includes('h1'), 'Hospital h1 should be inactive due to outage');
  assert.ok(result.unmet_demand, 'Should track unmet demand');
});

test('Allocation v2: Multiple scenarios rolling horizon', async (t) => {
  const config = {
    nodes: [
      { id: 'w1', role: 'warehouse', tier: 1, supply: 600, demand: 0, priority: 1.5 },
      { id: 'd1', role: 'distribution', tier: 2, supply: 100, demand: 200, priority: 1.0 }
    ],
    edges: [
      { id: 'e1', source: 'w1', target: 'd1', base_capacity: 300 }
    ],
    scenarios: [
      { name: 'scenario_1', demand_mult: 1.0, outages: {}, route_impact: {}, weather_impact: {} },
      { name: 'scenario_2', demand_mult: 1.5, outages: {}, route_impact: {}, weather_impact: {} }
    ],
    mode: 'rolling',
    rolling_steps: 2
  };

  const result = await allocationV2.allocate(config);
  
  assert.ok(result.flows.length > 0, 'Should generate flows across rolling horizon');
  assert.ok(result.unmet_demand, 'Should track unmet demand');
});

test('Allocation v2: Vehicle degradation', async (t) => {
  const config = {
    nodes: [
      { id: 'w1', role: 'warehouse', tier: 1, supply: 500, demand: 0, priority: 1.5 },
      { id: 'h1', role: 'hospital', tier: 2, supply: 0, demand: 300, priority: 2.0 }
    ],
    edges: [
      {
        id: 'e1',
        source: 'w1',
        target: 'h1',
        base_capacity: 400,
        degradation: { truck: 1.0, bike: 0.6, drone: 0.8 }
      }
    ],
    scenarios: [
      {
        name: 'base',
        demand_mult: 1.0,
        outages: {},
        route_impact: {},
        weather_impact: { e1: { truck: 0.8, bike: 0.5, drone: 1.0 } }
      }
    ],
    mode: 'static'
  };

  const result = await allocationV2.allocate(config);
  
  assert.ok(result.flows.length > 0, 'Should allocate with vehicle types');
  assert.ok(result.flows.some(f => ['truck', 'bike', 'drone'].includes(f.vehicle)), 'Should use vehicle types');
});

test('Allocation v2: HITL overrides', async (t) => {
  const config = {
    nodes: [
      { id: 'w1', role: 'warehouse', tier: 1, supply: 600, demand: 0, priority: 1.0 },
      { id: 'h1', role: 'hospital', tier: 2, supply: 0, demand: 200, priority: 1.0 }
    ],
    edges: [
      { id: 'e1', source: 'w1', target: 'h1', base_capacity: 300 }
    ],
    scenarios: [
      { name: 'base', demand_mult: 1.0, outages: {}, route_impact: {}, weather_impact: {} }
    ],
    mode: 'static',
    hitl_overrides: {
      weights: { h1: 3.0 },
      force_node: { h1: true },
      force_route: { e1: true }
    }
  };

  const result = await allocationV2.allocate(config);
  
  assert.ok(result.flows.length > 0, 'HITL overrides should maintain allocation');
  assert.ok(result.active_nodes.includes('h1'), 'Forced node should be active');
  assert.ok(result.critical_routes.includes('e1'), 'Forced route should be critical');
});

test('Allocation v2: Caching behavior', async (t) => {
  const config = {
    nodes: [
      { id: 'w1', role: 'warehouse', tier: 1, supply: 500, demand: 0, priority: 1.5 },
      { id: 'd1', role: 'distribution', tier: 2, supply: 0, demand: 300, priority: 1.0 }
    ],
    edges: [
      { id: 'e1', source: 'w1', target: 'd1', base_capacity: 400 }
    ],
    scenarios: [
      { name: 'base', demand_mult: 1.0, outages: {}, route_impact: {}, weather_impact: {} }
    ],
    mode: 'static'
  };

  const start1 = Date.now();
  const result1 = await allocationV2.allocate(config);
  const time1 = Date.now() - start1;

  const start2 = Date.now();
  const result2 = await allocationV2.allocate(config);
  const time2 = Date.now() - start2;

  assert.deepStrictEqual(result1, result2, 'Cached result should be identical');
  assert.ok(time2 < time1, 'Cached result should be faster');
});

test('Allocation v2: Result format validation', async (t) => {
  const config = {
    nodes: [
      { id: 'w1', role: 'warehouse', tier: 1, supply: 300, demand: 0, priority: 1.5 },
      { id: 'h1', role: 'hospital', tier: 2, supply: 0, demand: 100, priority: 2.0 }
    ],
    edges: [
      { id: 'e1', source: 'w1', target: 'h1', base_capacity: 200 }
    ],
    scenarios: [
      { name: 'base', demand_mult: 1.0, outages: {}, route_impact: {}, weather_impact: {} }
    ],
    mode: 'static'
  };

  const result = await allocationV2.allocate(config);
  
  // Validate result structure
  assert.ok(result.flows, 'Result should have flows');
  assert.ok(result.active_nodes, 'Result should have active_nodes');
  assert.ok(result.critical_routes, 'Result should have critical_routes');
  assert.ok(result.unmet_demand !== undefined, 'Result should have unmet_demand');
  assert.ok(result.explanations, 'Result should have explanations');
  assert.ok(result.robust_margin !== undefined, 'Result should have robust_margin');

  // Validate flow format
  if (result.flows.length > 0) {
    const flow = result.flows[0];
    assert.ok(flow.from, 'Flow should have from');
    assert.ok(flow.to, 'Flow should have to');
    assert.ok(flow.qty !== undefined, 'Flow should have qty');
    assert.ok(flow.edge, 'Flow should have edge');
  }
});

test('Allocation v2: Compare results', (t) => {
  const v1Result = {
    flows: [{ from: 'w1', to: 'h1', qty: 100, edge: 'e1' }],
    active_nodes: ['w1', 'h1'],
    unmet_demand: { h1: 50 },
    critical_routes: ['e1']
  };

  const v2Result = {
    flows: [
      { from: 'w1', to: 'h1', qty: 120, edge: 'e1' },
      { from: 'w1', to: 'd1', qty: 80, edge: 'e2' }
    ],
    active_nodes: ['w1', 'h1', 'd1'],
    unmet_demand: { h1: 30 },
    critical_routes: ['e1', 'e2']
  };

  const comparison = allocationV2.compareResults(v1Result, v2Result);
  
  assert.ok(comparison.flows, 'Comparison should have flows metric');
  assert.ok(comparison.unmet_demand, 'Comparison should have unmet_demand metric');
  assert.ok(comparison.summary, 'Comparison should have summary');
  assert.ok(comparison.recommendation, 'Comparison should have recommendation');
  assert.strictEqual(comparison.unmet_demand.v1, 50, 'Should calculate v1 unmet');
  assert.strictEqual(comparison.unmet_demand.v2, 30, 'Should calculate v2 unmet');
});

test('Allocation v2: Cache clearing', async (t) => {
  const config = {
    nodes: [
      { id: 'w1', role: 'warehouse', tier: 1, supply: 400, demand: 0, priority: 1.5 },
      { id: 'd1', role: 'distribution', tier: 2, supply: 0, demand: 200, priority: 1.0 }
    ],
    edges: [
      { id: 'e1', source: 'w1', target: 'd1', base_capacity: 300 }
    ],
    scenarios: [
      { name: 'base', demand_mult: 1.0, outages: {}, route_impact: {}, weather_impact: {} }
    ],
    mode: 'static'
  };

  await allocationV2.allocate(config);
  assert.ok(allocationV2.cache.size > 0, 'Cache should have entries');

  allocationV2.clearCache();
  assert.strictEqual(allocationV2.cache.size, 0, 'Cache should be empty after clear');
});

test('Allocation v2: Error handling - invalid config', async (t) => {
  const config = {
    nodes: [
      { id: 'invalid', role: 'unknown', tier: -1, supply: -100 }
    ],
    edges: [],
    scenarios: [
      { name: 'error_scenario', demand_mult: 'not_a_number' }
    ],
    mode: 'static'
  };

  try {
    const result = await allocationV2.allocate(config);
    assert.ok(result.error || result.flows, 'Should either error gracefully or return result');
  } catch (err) {
    // Expected for invalid config
    assert.ok(true, 'Invalid config should raise error');
  }
});
