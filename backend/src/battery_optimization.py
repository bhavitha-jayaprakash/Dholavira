"""
Battery optimization layer for disaster DTN.

Bridges communication (BLE/LoRa CAD) and resource allocation:
- On-device: decide which messages relay based on priority + battery state.
- Edge (ESP32): duty-cycle LoRa CAD, suppress rebroadcast of strong signals (RSSI).
- Cloud: allocate resources knowing power constraints affect node availability.

Strategy:
1. Battery-aware message filtering: high-priority SOS forwarded; low-priority cached.
2. LoRa CAD duty cycling: sleep 2.9s, sniff 0.1s (saves 97% vs always-listening).
3. RSSI suppression: don't rebroadcast if signal strong (redundant + wastes power).
4. Cloud adjusts tier/priority: nodes with poor power budget get lower route weight.
"""

from enum import Enum
from dataclasses import dataclass


class PowerState(Enum):
    """Device power budget."""
    CRITICAL = 0  # <5% battery
    LOW = 1       # 5-20% battery
    MEDIUM = 2    # 20-60% battery
    GOOD = 3      # >60% battery


class BroadcastSuppressionPolicy(Enum):
    """When to suppress rebroadcast to save power."""
    ALWAYS = "always"           # Suppress all rebroadcasts
    RSSI_ONLY = "rssi_only"     # Suppress if signal strong
    PRIORITY_AWARE = "priority_aware"  # Suppress low-priority if weak power


@dataclass
class BatteryOptimizationConfig:
    """Battery optimization tuning."""
    rssi_strong_threshold_ble: float = -50  # dBm; strong enough to skip rebroadcast
    rssi_strong_threshold_lora: float = -60  # dBm
    
    cad_sleep_ms: int = 2900  # LoRa CAD sleep duration
    cad_sniff_ms: int = 100   # LoRa CAD active sniff duration
    
    message_retention_critical: int = 3600   # 1h retention at critical battery
    message_retention_low: int = 86400       # 24h retention at low battery
    message_retention_good: int = 604800     # 7d retention at good battery
    
    rebroadcast_jitter_ms: tuple = (0, 500)  # (min, max) jitter on rebroadcast delay
    priority_threshold_forward: float = 1.5  # Forward if priority >= threshold
    
    suppression_policy: BroadcastSuppressionPolicy = BroadcastSuppressionPolicy.RSSI_ONLY


class BatteryOptimizer:
    """On-device (phone/ESP32) battery-aware message handling."""
    
    def __init__(self, device_id, config=None):
        self.device_id = device_id
        self.config = config or BatteryOptimizationConfig()
        self.power_state = PowerState.GOOD
        self.battery_percent = 100.0
        self.message_cache = {}  # msg_id -> {"payload", "ttl_hops", "priority", ...}
    
    def set_battery(self, percent):
        """Update battery level and compute power state."""
        self.battery_percent = percent
        if percent < 5:
            self.power_state = PowerState.CRITICAL
        elif percent < 20:
            self.power_state = PowerState.LOW
        elif percent < 60:
            self.power_state = PowerState.MEDIUM
        else:
            self.power_state = PowerState.GOOD
    
    def should_forward_message(self, msg_id, priority, rssi_dbm, force_forward=False):
        """
        Decide whether to forward/rebroadcast a message given battery state.
        
        Returns: (should_forward: bool, reason: str)
        """
        if force_forward:
            return True, "forced"
        
        # Check priority threshold
        if priority < self.config.priority_threshold_forward:
            return False, f"low_priority ({priority} < {self.config.priority_threshold_forward})"
        
        # Check power state
        if self.power_state == PowerState.CRITICAL:
            return False, "critical_battery"
        
        # Check RSSI suppression
        if self.config.suppression_policy == BroadcastSuppressionPolicy.RSSI_ONLY:
            threshold = self.config.rssi_strong_threshold_ble  # or lora based on link type
            if rssi_dbm >= threshold:
                return False, f"strong_signal ({rssi_dbm} dBm >= {threshold})"
        
        elif self.config.suppression_policy == BroadcastSuppressionPolicy.PRIORITY_AWARE:
            # At low/medium power, only forward high-priority messages with weak signal
            if self.power_state in (PowerState.LOW, PowerState.MEDIUM):
                threshold = self.config.rssi_strong_threshold_ble
                if rssi_dbm >= threshold and priority < 2.5:
                    return False, "priority_power_tradeoff"
        
        return True, "ok"
    
    def retention_time_ms(self):
        """How long to cache a message before expiry."""
        if self.power_state == PowerState.CRITICAL:
            return self.config.message_retention_critical * 1000
        elif self.power_state == PowerState.LOW:
            return self.config.message_retention_low * 1000
        else:
            return self.config.message_retention_good * 1000
    
    def lora_cad_duty_cycle(self):
        """LoRa CAD listening strategy (sleep/wake pattern)."""
        sleep_pct = self.config.cad_sleep_ms / (self.config.cad_sleep_ms + self.config.cad_sniff_ms) * 100
        return {
            "sleep_ms": self.config.cad_sleep_ms,
            "sniff_ms": self.config.cad_sniff_ms,
            "duty_cycle_pct": 100 - sleep_pct,
            "power_save_vs_always_on": f"{sleep_pct:.1f}%"
        }


class CloudBatteryAwareTriage:
    """
    Cloud-side (resource allocator) adjusts priorities/weights based on node battery state.
    
    Nodes with poor power budget are:
    - Marked as "unstable" (may drop out).
    - Given lower route weight (less critical traffic through them).
    - Prioritized for energy-efficient routes (shorter hops, aggregation).
    """
    
    def __init__(self):
        self.node_battery_state = {}  # node_id -> {"battery_pct", "last_seen_ts", "power_state"}
    
    def update_node_state(self, node_id, battery_pct, timestamp):
        """Update cloud's view of node battery."""
        if battery_pct < 5:
            power_state = PowerState.CRITICAL
        elif battery_pct < 20:
            power_state = PowerState.LOW
        elif battery_pct < 60:
            power_state = PowerState.MEDIUM
        else:
            power_state = PowerState.GOOD
        
        self.node_battery_state[node_id] = {
            "battery_pct": battery_pct,
            "power_state": power_state.name,
            "last_seen_ts": timestamp
        }
    
    def priority_weight_for_node(self, node_id, base_weight=1.0):
        """
        Adjust allocation weight based on battery state.
        
        - GOOD: base_weight
        - MEDIUM: 0.8x
        - LOW: 0.5x
        - CRITICAL: 0.2x (avoid routing through)
        """
        state = self.node_battery_state.get(node_id, {}).get("power_state", "GOOD")
        adjustments = {
            "GOOD": 1.0,
            "MEDIUM": 0.8,
            "LOW": 0.5,
            "CRITICAL": 0.2
        }
        return base_weight * adjustments.get(state, 1.0)
    
    def route_energy_cost(self, edge_id, node_battery_map, base_cost=1.0):
        """
        Adjust edge cost: prefer routes avoiding low-battery nodes.
        
        - Both endpoints GOOD: base_cost
        - One endpoint MEDIUM: 1.2x cost (detour disincentive)
        - One endpoint LOW: 1.5x cost
        - One endpoint CRITICAL: 2.0x cost (avoid)
        """
        cost = base_cost
        # This would be implemented with the edge's source/target nodes
        # and their battery states from node_battery_map.
        return cost


class BatteryOptimizationReport:
    """Operator-facing summary of power/battery state across disaster zone."""
    
    def __init__(self):
        self.nodes_by_power_state = {
            "GOOD": [],
            "MEDIUM": [],
            "LOW": [],
            "CRITICAL": []
        }
        self.cad_energy_savings_pct = 97
        self.rebroadcast_suppression_count = 0
    
    def add_node(self, node_id, power_state_name, battery_pct):
        if power_state_name in self.nodes_by_power_state:
            self.nodes_by_power_state[power_state_name].append({
                "node_id": node_id,
                "battery_pct": battery_pct
            })
    
    def summary(self):
        """Return human-readable summary."""
        return {
            "nodes_operational": len(self.nodes_by_power_state["GOOD"]) + len(self.nodes_by_power_state["MEDIUM"]),
            "nodes_at_risk": len(self.nodes_by_power_state["LOW"]) + len(self.nodes_by_power_state["CRITICAL"]),
            "cad_energy_savings_pct": self.cad_energy_savings_pct,
            "rebroadcast_suppressions": self.rebroadcast_suppression_count,
            "by_state": self.nodes_by_power_state
        }


if __name__ == "__main__":
    # Example: on-device battery optimization
    optimizer = BatteryOptimizer(device_id="phone_001")
    
    print("=== Battery optimization example ===")
    print(f"Initial battery: {optimizer.battery_percent}%")
    print(f"Power state: {optimizer.power_state.name}")
    print(f"LoRa CAD duty cycle: {optimizer.lora_cad_duty_cycle()}")
    
    # Test message forwarding decisions
    test_cases = [
        ("msg_1", 2.5, -45),  # high priority, strong signal
        ("msg_2", 1.8, -70),  # low priority, weak signal
        ("msg_3", 3.0, -65),  # critical, medium signal
    ]
    
    for msg_id, priority, rssi in test_cases:
        should_fwd, reason = optimizer.should_forward_message(msg_id, priority, rssi)
        print(f"{msg_id}: priority={priority}, rssi={rssi} dBm -> forward={should_fwd} ({reason})")
    
    # Simulate battery drain
    print("\n=== After battery drain ===")
    optimizer.set_battery(18.0)
    print(f"Battery: {optimizer.battery_percent}%")
    print(f"Power state: {optimizer.power_state.name}")
    should_fwd, reason = optimizer.should_forward_message("msg_4", priority=2.0, rssi_dbm=-50)
    print(f"msg_4: forward={should_fwd} ({reason})")
    
    # Cloud-side battery-aware triage
    print("\n=== Cloud-side battery-aware triage ===")
    cloud_triage = CloudBatteryAwareTriage()
    cloud_triage.update_node_state("node_A", battery_pct=85, timestamp=0)
    cloud_triage.update_node_state("node_B", battery_pct=15, timestamp=0)
    cloud_triage.update_node_state("node_C", battery_pct=3, timestamp=0)
    
    print(f"node_A priority weight: {cloud_triage.priority_weight_for_node('node_A', base_weight=1.0)}")
    print(f"node_B priority weight: {cloud_triage.priority_weight_for_node('node_B', base_weight=1.0)}")
    print(f"node_C priority weight: {cloud_triage.priority_weight_for_node('node_C', base_weight=1.0)}")
