import pg from 'pg';
import mysql from 'mysql2/promise';

const { Pool } = pg;
const TIMEOUT_MS = 10000;
export const MAX_ROWS = 1000;

function sslFor(url, flag) {
  if (flag === 'false') return false;
  try {
    const host = new URL(url).hostname;
    if (host === 'localhost' || host === '127.0.0.1') return false;
  } catch {
    /* ignore */
  }
  return { rejectUnauthorized: false };
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

// App DB: holds query history (schema "app").
export const appPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslFor(process.env.DATABASE_URL, process.env.PG_SSL),
  max: 5,
});

// PostgreSQL practice pool: locked to schema "practice", with a statement timeout.
const practiceUrl = process.env.PRACTICE_PG_URL || process.env.DATABASE_URL;
const practicePg = new Pool({
  connectionString: practiceUrl,
  ssl: sslFor(practiceUrl, process.env.PG_SSL),
  max: 5,
  options: `-c search_path=practice -c statement_timeout=${TIMEOUT_MS}`,
});

// MySQL practice pool (optional).
const mysqlPool = process.env.MYSQL_URL
  ? mysql.createPool({
      uri: process.env.MYSQL_URL,
      connectionLimit: 5,
      connectTimeout: 10000,
      ssl: process.env.MYSQL_SSL === 'false' ? undefined : { rejectUnauthorized: false },
    })
  : null;

export const engines = () => ({ postgres: true, mysql: Boolean(mysqlPool) });

export async function initDb() {
  await appPool.query('CREATE SCHEMA IF NOT EXISTS app');
  await appPool.query(`
    CREATE TABLE IF NOT EXISTS app.query_history (
      id SERIAL PRIMARY KEY,
      engine TEXT NOT NULL,
      query TEXT NOT NULL,
      success BOOLEAN NOT NULL,
      row_count INTEGER,
      duration_ms INTEGER,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  const admin = new Pool({
    connectionString: practiceUrl,
    ssl: sslFor(practiceUrl, process.env.PG_SSL),
    max: 1,
  });
  try {
    await admin.query('CREATE SCHEMA IF NOT EXISTS practice');
  } finally {
    await admin.end();
  }
}

function norm(v) {
  if (v === null || v === undefined) return null;
  if (Buffer.isBuffer(v)) return '\\x' + v.toString('hex');
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

function shape(columns, rows, rowCount, command) {
  const truncated = rows.length > MAX_ROWS;
  return {
    columns,
    rows: (truncated ? rows.slice(0, MAX_ROWS) : rows).map((r) => r.map(norm)),
    rowCount,
    command,
    truncated,
  };
}

export async function runQuery(engine, sql) {
  const started = Date.now();
  let out;
  if (engine === 'postgres') {
    const r = await practicePg.query({ text: sql, rowMode: 'array' });
    const res = Array.isArray(r) ? r[r.length - 1] : r;
    const columns = (res.fields || []).map((f) => f.name);
    out = shape(columns, res.rows || [], res.rowCount ?? (res.rows || []).length, res.command);
  } else if (engine === 'mysql') {
    if (!mysqlPool) throw new Error('MySQL is not configured on this server');
    const [rows, fields] = await mysqlPool.query({ sql, rowsAsArray: true, timeout: TIMEOUT_MS });
    if (Array.isArray(fields)) {
      out = shape(fields.map((f) => f.name), rows, rows.length, 'SELECT');
    } else {
      out = shape([], [], rows.affectedRows ?? 0, 'OK');
    }
  } else {
    throw new Error('Unknown engine');
  }
  out.durationMs = Date.now() - started;
  return out;
}

export async function getSchema(engine) {
  let rows;
  if (engine === 'postgres') {
    ({ rows } = await practicePg.query(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'practice' ORDER BY table_name, ordinal_position`
    ));
  } else if (engine === 'mysql') {
    if (!mysqlPool) throw new Error('MySQL is not configured on this server');
    [rows] = await mysqlPool.query(
      `SELECT table_name AS table_name, column_name AS column_name, data_type AS data_type
       FROM information_schema.columns WHERE table_schema = DATABASE()
       ORDER BY table_name, ordinal_position`
    );
  } else {
    throw new Error('Unknown engine');
  }
  const tables = {};
  for (const r of rows) {
    (tables[r.table_name] ||= []).push({ name: r.column_name, type: r.data_type });
  }
  return Object.entries(tables).map(([name, columns]) => ({ name, columns }));
}

export async function addHistory(h) {
  await appPool.query(
    `INSERT INTO app.query_history (engine, query, success, row_count, duration_ms, error)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [h.engine, h.query, h.success, h.rowCount ?? null, h.durationMs ?? null, h.error ?? null]
  );
}

export async function listHistory(limit = 100) {
  const { rows } = await appPool.query(
    `SELECT id, engine, query, success, row_count AS "rowCount", duration_ms AS "durationMs",
            error, created_at AS "createdAt"
     FROM app.query_history ORDER BY id DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function clearHistory() {
  await appPool.query('TRUNCATE app.query_history');
}
