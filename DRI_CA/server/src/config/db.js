// ============================================================
// Database Connection Pool
// ============================================================
// Creates a PostgreSQL connection pool using node-postgres (pg).
// PostGIS is available as an extension within the connected DB.
// ============================================================

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Connection pool settings tuned for development
  max: 10,               // Maximum number of connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Log pool errors (don't crash the server)
pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

/**
 * Verify the database connection and PostGIS availability.
 * Called once on server startup.
 */
export async function verifyConnection() {
  try {
    const client = await pool.connect();

    // Check basic connectivity
    const result = await client.query('SELECT NOW() AS server_time');
    console.log(`[DB] Connected — server time: ${result.rows[0].server_time}`);

    // Check PostGIS extension
    const postgis = await client.query(
      "SELECT extname, extversion FROM pg_extension WHERE extname = 'postgis'"
    );

    if (postgis.rows.length > 0) {
      console.log(`[DB] PostGIS v${postgis.rows[0].extversion} is active`);
    } else {
      console.warn('[DB] ⚠ PostGIS extension not found — spatial queries will fail!');
    }

    client.release();
  } catch (err) {
    console.error('[DB] Connection failed:', err.message);
    console.error('[DB] Check your DATABASE_URL in .env');
    // Don't exit — let the server start so health endpoints still work
  }
}

export default pool;
