/**
 * Allocation Wrapper - Bridge between Node.js backend and Python allocation v2
 * 
 * Provides:
 * - Subprocess communication with disaster_alloc_v2.py
 * - Flow conversion between formats
 * - Error handling and validation
 * - Caching for repeated scenarios
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * DisasterAllocatorV2 - Interface to Python allocation engine
 */
export class DisasterAllocatorV2 {
  constructor() {
    this.pythonPath = path.join(__dirname, '..', '..', 'backend', 'src', 'disaster_alloc_runner.py');
    this.cache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Run allocation for given scenarios
   * @param {Object} config - { nodes, edges, scenarios, mode, rolling_steps, hitl_overrides }
   * @returns {Promise<Object>} - { flows, active_nodes, critical_routes, unmet_demand, explanations, robust_margin }
   */
  async allocate(config) {
    const cacheKey = this._getCacheKey(config);
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      console.debug(`[allocation.v2] Cache hit: ${cacheKey}`);
      return cached.result;
    }

    try {
      const result = await this._runPython(config);
      
      // Store in cache
      this.cache.set(cacheKey, {
        result,
        timestamp: Date.now()
      });

      console.log(`[allocation.v2] Complete - flows: ${result.flows.length}, active_nodes: ${result.active_nodes.length}, mode: ${config.mode}`);

      return result;
    } catch (error) {
      console.error(`[allocation.v2] Error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Compare v1 vs v2 allocations for the same scenario
   * @param {Object} v1Result - Result from original allocator
   * @param {Object} v2Result - Result from v2 allocator
   * @returns {Object} - Comparison metrics
   */
  compareResults(v1Result, v2Result) {
    const v1Flows = (v1Result.flows || []).length;
    const v2Flows = (v2Result.flows || []).length;
    
    const v1Unmet = Object.values(v1Result.unmet_demand || {})
      .reduce((sum, val) => sum + val, 0);
    const v2Unmet = Object.values(v2Result.unmet_demand || {})
      .reduce((sum, val) => sum + val, 0);

    const v1ActiveNodes = (v1Result.active_nodes || []).length;
    const v2ActiveNodes = (v2Result.active_nodes || []).length;

    return {
      flows: {
        v1: v1Flows,
        v2: v2Flows,
        delta: v2Flows - v1Flows,
        improvement: ((v2Flows - v1Flows) / v1Flows * 100).toFixed(2) + '%'
      },
      unmet_demand: {
        v1: v1Unmet,
        v2: v2Unmet,
        delta: v2Unmet - v1Unmet,
        improvement: ((v1Unmet - v2Unmet) / v1Unmet * 100).toFixed(2) + '%' // less is better
      },
      active_nodes: {
        v1: v1ActiveNodes,
        v2: v2ActiveNodes,
        delta: v2ActiveNodes - v1ActiveNodes
      },
      recommendation: v2Unmet < v1Unmet ? 'v2_preferred' : 'v1_preferred',
      summary: {
        v1: { flows: v1Flows, unmet: v1Unmet.toFixed(2), active: v1ActiveNodes },
        v2: { flows: v2Flows, unmet: v2Unmet.toFixed(2), active: v2ActiveNodes }
      }
    };
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    console.log('[allocation.v2] Cache cleared');
  }

  /**
   * Internal: Run Python subprocess
   */
  _runPython(config) {
    return new Promise((resolve, reject) => {
      const process = spawn('python3', [this.pythonPath], {
        cwd: path.join(__dirname, '..'),
        timeout: 30000
      });

      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Python process exited with code ${code}: ${stderr}`));
          return;
        }

        try {
          const result = JSON.parse(stdout);
          resolve(result);
        } catch (error) {
          reject(new Error(`Failed to parse Python output: ${error.message}`));
        }
      });

      process.on('error', (error) => {
        reject(error);
      });

      // Send config as JSON to Python via stdin
      process.stdin.write(JSON.stringify(config));
      process.stdin.end();
    });
  }

  /**
   * Generate cache key from config
   */
  _getCacheKey(config) {
    const key = JSON.stringify({
      nodes: config.nodes?.map(n => ({ id: n.id, supply: n.supply, demand: n.demand, priority: n.priority })),
      edges: config.edges?.map(e => ({ id: e.id, capacity: e.base_capacity })),
      scenarios: config.scenarios?.map(s => ({ name: s.name, demand_mult: s.demand_mult })),
      mode: config.mode,
      rolling_steps: config.rolling_steps
    });
    return crypto.createHash('sha256').update(key).digest('hex');
  }
}

export default new DisasterAllocatorV2();
