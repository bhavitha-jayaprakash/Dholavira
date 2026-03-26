import pg from 'pg';

const { Pool } = pg;

export function createDbPool() {
  const connectionString =
    process.env.DATABASE_URL ?? 'postgres://echo:echo@localhost:5432/echo';
  return new Pool({ connectionString });
}
