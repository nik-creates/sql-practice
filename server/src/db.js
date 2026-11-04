import pg from 'pg';
import mysql from 'mysql2/promise';

const { Pool } = pg;
const TIMEOUT_MS = 10000;
export const MAX_ROWS = 1000;
const HISTORY_TABLE = '_sp_history';

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

function groupColumns(rows) {
  const tables = {};
  for (const r of rows) {
    (tables[r.table_name] ||= []).push({ name: r.column_name, type: r.data_type });
  }
  return Object.entries(tables).map(([name, columns]) => ({ name, columns }));
}

/* ------------------------------------------------------------------ *
 * Engine adapters. Each is independent: configured only when its own
 * env vars are present, and a failure in one never affects another.
 * An adapter exposes: query(sql) -> shaped result, schema() -> tables.
 * To add another engine, write an adapter and register it below.
 * ------------------------------------------------------------------ */

function makePostgres() {
  const url = process.env.PRACTICE_PG_URL || process.env.DATABASE_URL;
  if (!url) return null;
  const ssl = sslFor(url, process.env.PG_SSL);
  const pool = new Pool({
    connectionString: url,
    ssl,
    max: 5,
    options: `-c search_path=practice -c statement_timeout=${TIMEOUT_MS}`,
  });
  pool.on('error', (e) => console.error('postgres pool:', e.message));

  let ready = null;
  const ensureSchema = () =>
    (ready ||= (async () => {
      const admin = new Pool({ connectionString: url, ssl, max: 1 });
      admin.on('error', () => {});
      try {
        await admin.query('CREATE SCHEMA IF NOT EXISTS practice');
      } finally {
        await admin.end().catch(() => {});
      }
    })().catch((e) => {
      ready = null;
      throw e;
    }));

  return {
    async query(sql) {
      await ensureSchema();
      const r = await pool.query({ text: sql, rowMode: 'array' });
      const res = Array.isArray(r) ? r[r.length - 1] : r;
      const columns = (res.fields || []).map((f) => f.name);
      return shape(columns, res.rows || [], res.rowCount ?? (res.rows || []).length, res.command);
    },
    async schema() {
      await ensureSchema();
      const { rows } = await pool.query(
        `SELECT table_name, column_name, data_type FROM information_schema.columns
         WHERE table_schema = 'practice' ORDER BY table_name, ordinal_position`
      );
      return groupColumns(rows);
    },
  };
}

function makeMysql() {
  const base = process.env.MYSQL_URL
    ? { uri: process.env.MYSQL_URL }
    : process.env.MYSQL_HOST
      ? {
          host: process.env.MYSQL_HOST,
          port: Number(process.env.MYSQL_PORT || 3306),
          user: process.env.MYSQL_USER,
          password: process.env.MYSQL_PASSWORD,
          database: process.env.MYSQL_DATABASE,
        }
      : null;
  if (!base) return null;
  const pool = mysql.createPool({
    ...base,
    connectionLimit: 5,
    connectTimeout: 10000,
    timezone: 'Z',
    ssl: process.env.MYSQL_SSL === 'false' ? undefined : { rejectUnauthorized: false },
  });

  return {
    pool,
    async query(sql) {
      const [rows, fields] = await pool.query({ sql, rowsAsArray: true, timeout: TIMEOUT_MS });
      if (Array.isArray(fields)) {
        return shape(fields.map((f) => f.name), rows, rows.length, 'SELECT');
      }
      return shape([], [], rows.affectedRows ?? 0, 'OK');
    },
    async schema() {
      const [rows] = await pool.query(
        `SELECT table_name AS table_name, column_name AS column_name, data_type AS data_type
         FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name <> ?
         ORDER BY table_name, ordinal_position`,
        [HISTORY_TABLE]
      );
      return groupColumns(rows);
    },
  };
}

const adapters = { postgres: makePostgres(), mysql: makeMysql() };

export const engines = () =>
  Object.fromEntries(Object.entries(adapters).map(([k, v]) => [k, Boolean(v)]));

function adapter(engine) {
  const a = adapters[engine];
  if (!a) throw new Error(`${engine === 'mysql' ? 'MySQL' : 'PostgreSQL'} is not configured on this server`);
  return a;
}

export async function runQuery(engine, sql) {
  const started = Date.now();
  const out = await adapter(engine).query(sql);
  out.durationMs = Date.now() - started;
  return out;
}

export const getSchema = (engine) => adapter(engine).schema();

/* ------------------------------------------------------------------ *
 * Query history: stored only in MySQL, in its own table (_sp_history),
 * so it never depends on PostgreSQL.
 * ------------------------------------------------------------------ */

let historyReady = null;
function ensureHistory(pool) {
  return (historyReady ||= pool
    .query(
      `CREATE TABLE IF NOT EXISTS ${HISTORY_TABLE} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        engine VARCHAR(20) NOT NULL,
        query MEDIUMTEXT NOT NULL,
        success TINYINT(1) NOT NULL,
        row_count INT NULL,
        duration_ms INT NULL,
        error TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    )
    .catch((e) => {
      historyReady = null;
      throw e;
    }));
}

async function withHistory(fn) {
  const a = adapters.mysql;
  if (!a) return null;
  try {
    await ensureHistory(a.pool);
    return await fn(a.pool);
  } catch (e) {
    historyReady = null; // table may have been dropped; recreate on next call
    throw e;
  }
}

export async function addHistory(h) {
  await withHistory((pool) =>
    pool.query(
      `INSERT INTO ${HISTORY_TABLE} (engine, query, success, row_count, duration_ms, error)
       VALUES (?,?,?,?,?,?)`,
      [h.engine, h.query, h.success ? 1 : 0, h.rowCount ?? null, h.durationMs ?? null,
        h.error ? String(h.error).slice(0, 2000) : null]
    )
  );
}

export async function listHistory(limit = 100) {
  const res = await withHistory(async (pool) => {
    const [rows] = await pool.query(
      `SELECT id, engine, query, success, row_count AS rowCount, duration_ms AS durationMs,
              error, created_at AS createdAt
       FROM ${HISTORY_TABLE} ORDER BY id DESC LIMIT ?`,
      [limit]
    );
    return rows.map((r) => ({ ...r, success: Boolean(r.success) }));
  });
  return res || [];
}

export async function clearHistory() {
  await withHistory((pool) => pool.query(`TRUNCATE TABLE ${HISTORY_TABLE}`));
}
