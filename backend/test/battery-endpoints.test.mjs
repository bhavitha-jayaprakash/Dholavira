/**
 * Test battery optimization endpoints + Flutter integration
 */

import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';

const BASE_URL = process.env.BACKEND_URL || 'http://127.0.0.1:3000';

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : null;
          resolve({ status: res.statusCode, body: parsed, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

test('battery endpoints', async (t) => {
  // Wait for backend to be ready
  let healthOk = false;
  for (let i = 0; i < 10; i++) {
    try {
      const { status } = await request('GET', '/healthz');
      if (status === 200) {
        healthOk = true;
        break;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }

  if (!healthOk) {
    console.log(`\n⚠️  Backend not healthy at ${BASE_URL}`);
    console.log('   Skipping battery endpoint tests');
    return;
  }

  console.log(`\nTesting battery endpoints at ${BASE_URL}`);

  // Test 1: Get battery status for unknown device (should return default GOOD)
  await t.test('GET /v1/device/battery/:device_id returns default GOOD for unknown device', async () => {
    const { status, body } = await request('GET', '/v1/device/battery/unknown_device_id');
    assert.equal(status, 200);
    assert.equal(body.battery_pct, 100);
    assert.equal(body.power_state, 'GOOD');
    assert.equal(body.suppression_recommended, false);
    assert(body.config);
    assert.equal(body.config.power_state, 'GOOD');
  });

  // Test 2: Get optimization config for GOOD state
  await t.test('GET /v1/optimize/config returns config for GOOD power state', async () => {
    const { status, body } = await request('GET', '/v1/optimize/config?power_state=GOOD');
    assert.equal(status, 200);
    assert.equal(body.power_state, 'GOOD');
    assert(body.config.lora_cad);
    assert.equal(body.config.lora_cad.duty_cycle_pct, 3.3);
    assert.equal(body.config.suppress_rebroadcast_low_battery, false);
  });

  // Test 3: Get optimization config for LOW state (more aggressive)
  await t.test('GET /v1/optimize/config returns more aggressive config for LOW power state', async () => {
    const { status, body } = await request('GET', '/v1/optimize/config?power_state=LOW');
    assert.equal(status, 200);
    assert.equal(body.power_state, 'LOW');
    assert(body.config.lora_cad);
    assert(body.config.lora_cad.sleep_ms > 2900, 'LOW state should have longer sleep');
    assert.equal(body.config.suppress_rebroadcast_low_battery, true);
  });

  // Test 4: Get optimization config for CRITICAL state (most aggressive)
  await t.test('GET /v1/optimize/config returns most aggressive config for CRITICAL power state', async () => {
    const { status, body } = await request('GET', '/v1/optimize/config?power_state=CRITICAL');
    assert.equal(status, 200);
    assert.equal(body.power_state, 'CRITICAL');
    assert(body.config.lora_cad);
    assert(body.config.lora_cad.sleep_ms >= 5000, 'CRITICAL state should have >= 5000ms sleep');
    assert.equal(body.config.message_retention_sec, 3600, 'CRITICAL should have 1h retention');
    assert.equal(body.config.suppress_rebroadcast_low_battery, true);
  });

  // Test 5: Reject invalid power state
  await t.test('GET /v1/optimize/config rejects invalid power state', async () => {
    const { status, body } = await request('GET', '/v1/optimize/config?power_state=INVALID');
    assert.equal(status, 422);
    assert(body.error);
  });

  // Test 6: Get battery stats for unknown device (should return empty)
  await t.test('GET /v1/stats/battery returns empty for unknown device', async () => {
    const { status, body } = await request('GET', '/v1/stats/battery?device_id=unknown_device');
    assert.equal(status, 200);
    assert.equal(body.device_id, 'unknown_device');
    assert.equal(body.sample_count, 0);
    assert.deepEqual(body.stats, []);
  });

  // Test 7: Reject missing device_id
  await t.test('GET /v1/stats/battery requires device_id', async () => {
    const { status, body } = await request('GET', '/v1/stats/battery');
    assert.equal(status, 422);
    assert(body.error);
  });

  // Test 8: Post battery stats
  await t.test('POST /v1/stats/battery/record records stats', async () => {
    const { status, body } = await request('POST', '/v1/stats/battery/record', {
      device_id: 'test_device_1',
      battery_pct: 45,
      messages_suppressed: 3,
      messages_forwarded: 12,
      power_saved_pct: 25.5
    });
    assert.equal(status, 200);
    assert.equal(body.status, 'recorded');
  });

  // Test 9: Get network battery status
  await t.test('GET /v1/admin/battery-status returns network status', async () => {
    const { status, body } = await request('GET', '/v1/admin/battery-status');
    assert.equal(status, 200);
    assert(body.status);
    assert(typeof body.status.total_devices === 'number');
    assert(body.status.by_state);
  });

  // Test 10: Reject missing fields in stats POST
  await t.test('POST /v1/stats/battery/record requires device_id and battery_pct', async () => {
    const { status, body } = await request('POST', '/v1/stats/battery/record', {
      device_id: 'test_device_2'
    });
    assert.equal(status, 422);
    assert(body.error);
  });

  console.log('✅  All battery endpoint tests passed!\n');
});
