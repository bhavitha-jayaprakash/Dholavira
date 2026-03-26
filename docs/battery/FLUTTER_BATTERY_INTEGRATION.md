# Flutter/Mobile Battery Integration

## Overview

The backend now provides comprehensive battery management endpoints designed for Flutter/Android apps. The battery optimization system tracks device power state (CRITICAL, LOW, MEDIUM, GOOD) and provides adaptive configuration to minimize power consumption while maintaining communication reliability.

## Key Endpoints

### 1. Device Battery State (`GET /v1/device/battery/:device_id`)

**Purpose**: Flutter app queries cloud's view of its own battery state and gets recommendations.

**Request**:
```bash
GET /v1/device/battery/base64_encoded_pubkey
```

**Response** (200 OK):
```json
{
  "device_id": "base64_encoded_pubkey",
  "battery_pct": 42,
  "power_state": "MEDIUM",
  "suppression_recommended": false,
  "retention_sec": 259200,
  "last_seen_ts": "2026-03-26T20:28:17.000Z",
  "config": {
    "power_state": "MEDIUM",
    "rssi_strong_threshold_ble": -50,
    "rssi_strong_threshold_lora": -60,
    "lora_cad": {
      "sleep_ms": 2900,
      "sniff_ms": 100,
      "duty_cycle_pct": 3.3,
      "power_save_vs_always_on_pct": 96.7
    },
    "message_retention_sec": 259200,
    "suppress_rebroadcast_low_battery": false,
    "priority_threshold_forward": 1.5
  }
}
```

**Power State Meanings**:
- `CRITICAL` (<5%): Extreme power saving; suppress all non-emergency messages; 1h retention
- `LOW` (5-20%): Aggressive power saving; suppress low-priority rebroadcasts; 24h retention
- `MEDIUM` (20-60%): Balanced mode; selective forwarding; 3d retention
- `GOOD` (>60%): Normal operation; relay all priority messages; 7d retention

### 2. Optimization Config (`GET /v1/optimize/config`)

**Purpose**: Get power-saving configuration parameters for device to apply locally.

**Request**:
```bash
GET /v1/optimize/config?power_state=MEDIUM
```

**Response** (200 OK):
```json
{
  "power_state": "MEDIUM",
  "config": {
    "power_state": "MEDIUM",
    "rssi_strong_threshold_ble": -50,
    "rssi_strong_threshold_lora": -60,
    "lora_cad": {
      "sleep_ms": 2900,
      "sniff_ms": 100,
      "duty_cycle_pct": 3.3,
      "power_save_vs_always_on_pct": 96.7
    },
    "message_retention_sec": 259200,
    "suppress_rebroadcast_low_battery": false,
    "priority_threshold_forward": 1.5
  },
  "description": "Battery optimization parameters for local device filtering and relay."
}
```

**Recommended Usage in Flutter**:
```dart
// Get config from cloud
final response = await http.get('/v1/optimize/config?power_state=$powerState');
final config = json.decode(response.body)['config'];

// Apply to device
bleRadio.rssiThreshold = config['rssi_strong_threshold_ble'];
loraRadio.cadSleep = config['lora_cad']['sleep_ms'];
loraRadio.cadSniff = config['lora_cad']['sniff_ms'];
device.shouldSuppressRebroadcast = config['suppress_rebroadcast_low_battery'];
```

### 3. Battery Stats Recording (`POST /v1/stats/battery/record`)

**Purpose**: Device sends battery optimization stats to cloud for analytics.

**Request**:
```bash
POST /v1/stats/battery/record
Content-Type: application/json

{
  "device_id": "base64_encoded_pubkey",
  "battery_pct": 42,
  "messages_suppressed": 5,
  "messages_forwarded": 23,
  "power_saved_pct": 25.3
}
```

**Response** (200 OK):
```json
{
  "status": "recorded"
}
```

**Recommended Usage**:
- Send stats periodically (e.g., every 10 minutes or after 100 messages processed).
- Track locally: suppressed count, forwarded count, battery %.
- Helps cloud understand device behavior and optimize allocation.

### 4. Battery Stats History (`GET /v1/stats/battery`)

**Purpose**: Retrieve battery optimization history for a device (analytics dashboard).

**Request**:
```bash
GET /v1/stats/battery?device_id=base64_encoded_pubkey&hours=24
```

**Response** (200 OK):
```json
{
  "device_id": "base64_encoded_pubkey",
  "hours_back": 24,
  "sample_count": 12,
  "stats": [
    {
      "battery_pct": 42,
      "power_state": "MEDIUM",
      "messages_suppressed": 5,
      "messages_forwarded": 23,
      "estimated_power_saved_pct": 25.3,
      "ts": "2026-03-26T20:28:17.000Z"
    },
    ...
  ]
}
```

### 5. Network Battery Status (`GET /v1/admin/battery-status`)

**Purpose**: Ops dashboard to see network-wide battery health.

**Request**:
```bash
GET /v1/admin/battery-status
```

**Response** (200 OK):
```json
{
  "at": "2026-03-26T20:29:53.129Z",
  "status": {
    "total_devices": 42,
    "by_state": {
      "CRITICAL": 2,
      "LOW": 5,
      "MEDIUM": 18,
      "GOOD": 17
    },
    "at_risk": 7,
    "operational": 35
  }
}
```

## Flutter Implementation Guide

### 1. Track Device Battery State

On device startup and periodically (e.g., every 30 seconds):

```dart
Future<BatteryConfig> fetchBatteryConfig() async {
  // Get current device battery %
  final Battery battery = Battery();
  final batteryLevel = await battery.batteryLevel;
  
  // Query cloud for cloud's view of our state + recommendations
  final response = await http.get(
    Uri.parse('http://backend:3000/v1/device/battery/$pubkeyBase64')
  );
  
  if (response.statusCode == 200) {
    final data = json.decode(response.body);
    final config = BatteryConfig.fromJson(data['config']);
    return config;
  }
  
  // Fallback to local estimation
  return defaultConfigFor(batteryLevel);
}
```

### 2. Apply Power-Saving Configuration

```dart
void applyBatteryConfig(BatteryConfig config) {
  // Adjust BLE scanning
  bleManager.scanDuration = config.powerState == 'CRITICAL' ? 2000 : 5000;
  bleManager.rssiThreshold = config.rssiThreshold;
  
  // Adjust LoRa CAD (Channel Activity Detection)
  if (config.loraCad != null) {
    loraRadio.cadSleep = config.loraCad!.sleepMs;
    loraRadio.cadSniff = config.loraCad!.sniffMs;
  }
  
  // Suppress low-priority rebroadcasts if low battery
  device.shouldSuppressRebroadcast = config.suppressRebroadcastLowBattery;
  
  // Adjust local message retention
  messageStore.maxAgeSeconds = config.messageRetentionSec;
}
```

### 3. Send Battery Stats Periodically

```dart
Timer.periodic(Duration(minutes: 10), (_) async {
  final stats = BatteryStats(
    deviceId: pubkeyBase64,
    batteryPct: currentBatteryLevel,
    messagesSuppressed: suppressed.length,
    messagesForwarded: forwarded.length,
    powerSavedPct: calculatePowerSaved()
  );
  
  await http.post(
    Uri.parse('http://backend:3000/v1/stats/battery/record'),
    headers: {'Content-Type': 'application/json'},
    body: json.encode(stats.toJson())
  );
});
```

### 4. Handle Low Battery Scenarios

```dart
void onBatteryStateChanged(BatteryState newState) {
  if (newState.batteryLevel < 5) {
    // CRITICAL: Disable all optional features
    bleManager.disable();
    loraRadio.disable();
    notifyCloud('device_low_battery');
  } else if (newState.batteryLevel < 20) {
    // LOW: Minimal operations only
    applyBatteryConfig(BatteryConfig(powerState: 'LOW'));
  }
}
```

## Power Saving Effectiveness

With LoRa CAD (Channel Activity Detection) enabled:
- **Default (always-on)**: 100% power draw
- **CAD mode (2.9s sleep, 0.1s sniff)**: ~3.3% duty cycle → **96.7% power savings**

Message suppression by power state:
- **CRITICAL**: Suppress >80% of rebroadcasts
- **LOW**: Suppress >50% of non-critical messages
- **MEDIUM**: Suppress <20% (selective forwarding)
- **GOOD**: Relay all messages (no suppression)

## Integration Flow

```
Device ↓
  1. Measure battery %
  2. Send SOS with battery_pct field
           ↓
Backend (ECHO)
  3. Parse SOS, extract battery_pct
  4. Update device_battery_state table
  5. Calculate power_state (CRITICAL/LOW/MEDIUM/GOOD)
           ↓
Flutter App (periodic query)
  6. GET /v1/device/battery/:device_id
  7. Receive power_state + config
           ↓
Device
  8. Apply config (CAD sleep/sniff, RSSI thresholds, suppression)
  9. Filter/suppress messages based on power state
  10. Send stats: POST /v1/stats/battery/record
           ↓
Backend (analytics)
  11. Store in battery_optimization_stats table
  12. Dashboard shows device battery history + optimization effectiveness
```

## Database Schema

### device_battery_state
Tracks cloud's view of each device's battery state.
- **Columns**: device_id (PK), battery_pct, power_state, last_seen_ts, last_sos_msg_id, should_suppress_rebroadcast, recommended_message_retention_sec
- **Indexes**: device_id (PK), power_state, last_seen_ts DESC

### battery_optimization_stats
Time-series data for analytics.
- **Columns**: stat_id (PK), device_id, ts, battery_pct, power_state, messages_suppressed, messages_forwarded, lora_cad_cycles_completed, estimated_power_saved_pct, details (JSONB)
- **Indexes**: device_id, ts DESC

## Testing

Run battery endpoint tests:
```bash
cd backend
npm test -- test/battery-endpoints.test.mjs
```

Send test SOS with battery info:
```bash
cd tools/packetgen
node send_sos.mjs --battery 42
```

Query device battery state:
```bash
curl 'http://127.0.0.1:3000/v1/device/battery/base64_pubkey' | jq .
```

Check network battery status:
```bash
curl 'http://127.0.0.1:3000/v1/admin/battery-status' | jq .
```

## Best Practices

1. **Fetch config on startup and periodically** (every 5-10 minutes)
2. **Cache config locally** to handle backend unavailability
3. **Report stats regularly** (every 10 minutes or 100 messages)
4. **Graceful degradation**: If backend unreachable, use conservative (CRITICAL) config
5. **Monitor battery trend**: If dropping >5% per hour, reduce activity
6. **Test on actual hardware**: Battery profiles vary by device; emulators underestimate power draw
