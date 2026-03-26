import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const schemaPath = path.resolve(__dirname, '..', 'db', 'schema.sql');
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://echo:echo@localhost:5432/echo';

const sql = await fs.readFile(schemaPath, 'utf8');

const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('COMMIT');
  console.log('db:migrate OK');
} catch (err) {
  await client.query('ROLLBACK');
  console.error('db:migrate FAILED');
  console.error(err);
  process.exitCode = 1;
} finally {
  await client.end();
}
