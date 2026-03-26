import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Client } = pg;

function getArg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

const limitRaw = getArg('--limit', '50');
const limit = Math.max(1, Math.min(500, Number(limitRaw)));
const msgIdHex = getArg('--msg-id', null);
const gatewayId = getArg('--gateway-id', null);

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://echo:echo@localhost:5432/echo';

const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
  const where = [];
  const args = [];

  if (typeof msgIdHex === 'string' && msgIdHex.length > 0) {
    args.push(msgIdHex);
    where.push(`msg_id_hex = $${args.length}`);
  }

  if (typeof gatewayId === 'string' && gatewayId.length > 0) {
    args.push(gatewayId);
    where.push(`gateway_id = $${args.length}`);
  }

  args.push(limit);

  const sql = `SELECT ts, level, event, req_id, msg_id_hex, http_method, http_path, http_status, duration_ms, gateway_id, rssi, details
    FROM event_logs
    ${where.length ? `WHERE ${where.join(' OR ')}` : ''}
    ORDER BY ts DESC
    LIMIT $${args.length}`;

  const result = await client.query(sql, args);
  for (const row of result.rows) {
    // Keep one line per event for easy evidence pasting.
    console.log(
      JSON.stringify({
        ts: row.ts,
        level: row.level,
        event: row.event,
        req_id: row.req_id,
        msg_id: row.msg_id_hex,
        method: row.http_method,
        path: row.http_path,
        status: row.http_status,
        duration_ms: row.duration_ms,
        gateway_id: row.gateway_id,
        rssi: row.rssi,
      })
    );
  }
} finally {
  await client.end();
}
