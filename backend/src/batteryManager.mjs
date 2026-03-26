/**
 * Battery optimization manager (Node.js backend).
 * 
 * Tracks device battery state, decides suppression/forwarding,
 * and provides config recommendations for Flutter apps.
 */

const POWER_STATES = {
  CRITICAL: "CRITICAL",  // <5%
  LOW: "LOW",            // 5-20%
  MEDIUM: "MEDIUM",      // 20-60%
  GOOD: "GOOD"           // >60%
};

function powerStateFromBattery(batteryPct) {
  if (batteryPct < 5) return POWER_STATES.CRITICAL;
  if (batteryPct < 20) return POWER_STATES.LOW;
  if (batteryPct < 60) return POWER_STATES.MEDIUM;
  return POWER_STATES.GOOD;
}

/**
 * BatteryOptimizationManager
 * 
 * Cloud-side tracking of device battery states and optimization decisions.
 * Provides recommendations for Flutter apps based on cloud's view of network.
 */
export class BatteryOptimizationManager {
  constructor(pool) {
    this.pool = pool;
    this.rssiStrongThresholdBle = -50;   // dBm
    this.rssiStrongThresholdLora = -60;  // dBm
    this.cadSleepMs = 2900;
    this.cadSniffMs = 100;
  }

  async updateDeviceBatteryState(deviceId, batteryPct, msgIdHex) {
    const powerState = powerStateFromBattery(batteryPct);
    const shouldSuppress = batteryPct < 20;  // Suppress rebroadcast if low battery

    try {
      await this.pool.query(
        `INSERT INTO device_battery_state (device_id, battery_pct, power_state, last_sos_msg_id, should_suppress_rebroadcast)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (device_id) DO UPDATE SET
           battery_pct = EXCLUDED.battery_pct,
           power_state = EXCLUDED.power_state,
           last_seen_ts = now(),
           last_sos_msg_id = EXCLUDED.last_sos_msg_id,
           should_suppress_rebroadcast = EXCLUDED.should_suppress_rebroadcast`,
        [deviceId, batteryPct, powerState, msgIdHex, shouldSuppress]
      );
    } catch (err) {
      console.error(`Failed to update device battery state: ${err}`);
    }
  }

  async getDeviceBatteryState(deviceId) {
    try {
      const result = await this.pool.query(
        `SELECT device_id, battery_pct, power_state, last_seen_ts, should_suppress_rebroadcast, recommended_message_retention_sec
         FROM device_battery_state
         WHERE device_id = $1`,
        [deviceId]
      );
      return result.rows[0] || null;
    } catch (err) {
      console.error(`Failed to get device battery state: ${err}`);
      return null;
    }
  }

  /**
   * Get optimization config for a Flutter app to use.
   * 
   * Returns: CAD cycles, RSSI thresholds, message retention, etc.
   */
  getOptimizationConfig(powerState = POWER_STATES.GOOD) {
    // Adjust config based on device power state
    let cadSleep = this.cadSleepMs;
    let cadSniff = this.cadSniffMs;
    let messageRetentionSec = 604800;  // 7 days

    if (powerState === POWER_STATES.CRITICAL) {
      cadSleep = 5000;  // More aggressive sleep
      messageRetentionSec = 3600;  // 1 hour
    } else if (powerState === POWER_STATES.LOW) {
      cadSleep = 3500;  // More sleep
      messageRetentionSec = 86400;  // 24 hours
    } else if (powerState === POWER_STATES.MEDIUM) {
      cadSleep = 2900;
      messageRetentionSec = 259200;  // 3 days
    }

    return {
      power_state: powerState,
      rssi_strong_threshold_ble: this.rssiStrongThresholdBle,
      rssi_strong_threshold_lora: this.rssiStrongThresholdLora,
      lora_cad: {
        sleep_ms: cadSleep,
        sniff_ms: cadSniff,
        duty_cycle_pct: Math.round((cadSniff / (cadSleep + cadSniff)) * 100 * 10) / 10,
        power_save_vs_always_on_pct: Math.round(((cadSleep) / (cadSleep + cadSniff)) * 100 * 10) / 10
      },
      message_retention_sec: messageRetentionSec,
      suppress_rebroadcast_low_battery: powerState === POWER_STATES.CRITICAL || powerState === POWER_STATES.LOW,
      priority_threshold_forward: powerState === POWER_STATES.CRITICAL ? 3.0 : 1.5
    };
  }

  /**
   * Record battery optimization stats (for analytics dashboard).
   */
  async recordBatteryStats(deviceId, batteryPct, messagesSuppressed, messagesForwarded, powerSavedPct) {
    const powerState = powerStateFromBattery(batteryPct);

    try {
      await this.pool.query(
        `INSERT INTO battery_optimization_stats (device_id, battery_pct, power_state, messages_suppressed, messages_forwarded, estimated_power_saved_pct)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [deviceId, batteryPct, powerState, messagesSuppressed, messagesForwarded, powerSavedPct]
      );
    } catch (err) {
      console.error(`Failed to record battery stats: ${err}`);
    }
  }

  /**
   * Get battery optimization stats for a device (last N hours).
   */
  async getDeviceStats(deviceId, hoursBack = 24) {
    try {
      const result = await this.pool.query(
        `SELECT battery_pct, power_state, messages_suppressed, messages_forwarded, estimated_power_saved_pct, ts
         FROM battery_optimization_stats
         WHERE device_id = $1 AND ts >= now() - interval '${hoursBack} hours'
         ORDER BY ts DESC
         LIMIT 100`,
        [deviceId]
      );
      return result.rows;
    } catch (err) {
      console.error(`Failed to get device stats: ${err}`);
      return [];
    }
  }

  /**
   * Get network-wide battery status (for cloud dashboard).
   */
  async getNetworkBatteryStatus() {
    try {
      const result = await this.pool.query(
        `SELECT power_state, COUNT(*) as count
         FROM device_battery_state
         GROUP BY power_state
         ORDER BY power_state`
      );
      
      const summary = {
        total_devices: 0,
        by_state: { CRITICAL: 0, LOW: 0, MEDIUM: 0, GOOD: 0 },
        at_risk: 0,
        operational: 0
      };

      for (const row of result.rows) {
        const count = Number(row.count);
        summary.by_state[row.power_state] = count;
        summary.total_devices += count;
      }

      summary.at_risk = summary.by_state.CRITICAL + summary.by_state.LOW;
      summary.operational = summary.by_state.MEDIUM + summary.by_state.GOOD;

      return summary;
    } catch (err) {
      console.error(`Failed to get network battery status: ${err}`);
      return null;
    }
  }
}

export { powerStateFromBattery, POWER_STATES };
