const LOG_LEVELS = new Map([
  ['debug', 10],
  ['info', 20],
  ['warn', 30],
  ['error', 40],
]);

function nowIso() {
  return new Date().toISOString();
}

function normalizeLevel(level) {
  const l = String(level ?? 'info').toLowerCase();
  return LOG_LEVELS.has(l) ? l : 'info';
}

export function createLogger({ pool }) {
  const stdoutLevel = normalizeLevel(process.env.LOG_LEVEL ?? 'info');
  const stdoutThreshold = LOG_LEVELS.get(stdoutLevel) ?? 20;

  const dbLevel = normalizeLevel(process.env.LOG_DB_LEVEL ?? 'info');
  const dbThreshold = LOG_LEVELS.get(dbLevel) ?? 20;

  // Default on for local/dev, can be disabled via LOG_TO_DB=0.
  const logToDb = (process.env.LOG_TO_DB ?? '1') !== '0';

  function shouldStdout(level) {
    const severity = LOG_LEVELS.get(level) ?? 20;
    return severity >= stdoutThreshold;
  }

  function shouldDb(level) {
    const severity = LOG_LEVELS.get(level) ?? 20;
    return severity >= dbThreshold;
  }

  async function writeDb(level, event, fields) {
    if (!logToDb || !pool) return;
    if (!shouldDb(level)) return;

    const details = { ...fields };

    const reqId = typeof details.req_id === 'string' ? details.req_id : null;
    const msgIdHex = typeof details.msg_id === 'string' ? details.msg_id : null;

    const httpMethod = typeof details.method === 'string' ? details.method : null;
    const httpPath = typeof details.path === 'string' ? details.path : null;
    const httpStatus = Number.isFinite(details.status) ? details.status : null;
    const durationMs = Number.isFinite(details.duration_ms) ? details.duration_ms : null;

    const gatewayId = typeof details.gateway_id === 'string' ? details.gateway_id : null;
    const rssi = Number.isFinite(details.rssi) ? details.rssi : null;

    try {
      await pool.query(
        `INSERT INTO event_logs (
          level, event,
          req_id, msg_id_hex,
          http_method, http_path, http_status, duration_ms,
          gateway_id, rssi,
          details
        ) VALUES (
          $1,$2,
          $3,$4,
          $5,$6,$7,$8,
          $9,$10,
          $11::jsonb
        )`,
        [
          level,
          event,
          reqId,
          msgIdHex,
          httpMethod,
          httpPath,
          httpStatus,
          durationMs,
          gatewayId,
          rssi,
          JSON.stringify(details),
        ]
      );
    } catch (err) {
      // Fall back silently; stdout log is still emitted.
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          ts: nowIso(),
          level: 'error',
          event: 'event_log_db_write_failed',
          error: String(err),
        })
      );
    }
  }

  async function log(level, fields) {
    const lvl = normalizeLevel(level);
    const event = typeof fields?.event === 'string' ? fields.event : 'log';

    const line = {
      ts: nowIso(),
      level: lvl,
      ...fields,
    };

    if (shouldStdout(lvl)) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(line));
    }

    // Intentionally awaited to make proof/evidence deterministic.
    await writeDb(lvl, event, fields ?? {});
  }

  return {
    debug: (fields) => log('debug', fields),
    info: (fields) => log('info', fields),
    warn: (fields) => log('warn', fields),
    error: (fields) => log('error', fields),
  };
}
