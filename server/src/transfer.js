// Export / import of practice objects: tables (with data), views and triggers.
// Export: a .zip holding dump.sql (restores exactly) and csv/<table>.csv.
// Import: .zip (uses its dump.sql, or its CSV files), a .sql dump, or a single .csv.
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import mysql from 'mysql2/promise';
import { adapters, HISTORY_TABLE } from './db.js';

const ROW_CAP = 100000; // rows per table
const MAX_UNZIPPED = 50 * 1024 * 1024;
const IMPORT_TIMEOUT_MS = 60000;

class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const qiPg = (s) => `"${String(s).replace(/"/g, '""')}"`;
const qiMy = (s) => `\`${String(s).replace(/`/g, '``')}\``;
const pgLit = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const myLit = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'object' && !Buffer.isBuffer(v)) v = JSON.stringify(v);
  return mysql.escape(v);
};
const safeName = (s) => String(s).replace(/[^\w.-]+/g, '_').slice(0, 80) || 'table';

function adapter(engine) {
  const a = adapters[engine];
  if (!a) throw new UserError(`${engine === 'mysql' ? 'MySQL' : 'PostgreSQL'} is not configured on this server`);
  return a;
}

/* ---------------------------- CSV helpers ---------------------------- */

const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function toCsv(cols, rows) {
  const lines = [cols.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))];
  return '﻿' + lines.join('\r\n') + '\r\n'; // BOM so Excel reads UTF-8
}

function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function inferType(values) {
  const vs = values.filter((v) => v !== undefined && v !== '');
  if (!vs.length) return { kind: 'text', len: 0 };
  const len = Math.max(...vs.map((v) => v.length));
  if (vs.every((v) => /^-?\d+$/.test(v) && !/^-?0\d/.test(v) && Math.abs(Number(v)) < 9e18)) {
    return { kind: vs.every((v) => Math.abs(Number(v)) <= 2147483647) ? 'int' : 'bigint', len };
  }
  if (vs.every((v) => /^-?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(v) && !/^-?0\d/.test(v))) {
    return { kind: 'float', len };
  }
  if (vs.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))) return { kind: 'date', len };
  return { kind: 'text', len };
}

function sqlType(engine, { kind, len }) {
  if (engine === 'mysql') {
    if (kind === 'int') return 'INT';
    if (kind === 'bigint') return 'BIGINT';
    if (kind === 'float') return 'DOUBLE';
    if (kind === 'date') return 'DATE';
    return len <= 255 ? 'VARCHAR(255)' : len <= 60000 ? 'TEXT' : 'MEDIUMTEXT';
  }
  if (kind === 'int') return 'INTEGER';
  if (kind === 'bigint') return 'BIGINT';
  if (kind === 'float') return 'DOUBLE PRECISION';
  if (kind === 'date') return 'DATE';
  return 'TEXT';
}

function insertStatements(tableSql, colsSql, rows, lit, size = 500) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    out.push(
      `INSERT INTO ${tableSql} (${colsSql}) VALUES\n` +
        chunk.map((r) => `(${r.map(lit).join(', ')})`).join(',\n') + ';'
    );
  }
  return out;
}

/* ------------------------- Shared export helpers ------------------------- */

// Orders views so each one comes after the views it uses. edges: [view, dependency] pairs.
export function sortByDependency(names, edges) {
  const known = new Set(names);
  const deps = new Map(names.map((n) => [n, []]));
  for (const [v, d] of edges) if (known.has(v) && known.has(d) && v !== d) deps.get(v).push(d);
  const order = [];
  const seen = new Set();
  const visit = (n, stack) => {
    if (seen.has(n) || stack.has(n)) return;
    stack.add(n);
    for (const d of deps.get(n)) visit(d, stack);
    stack.delete(n);
    seen.add(n);
    order.push(n);
  };
  for (const n of names) visit(n, new Set());
  return order;
}

// MySQL dumps: drop the DEFINER clause (the importing user may lack privileges for it)
// and the current database prefix (so a dump restores into a database with another name).
export function cleanMysqlStatement(sql, db) {
  let out = String(sql).replace(/\sDEFINER\s*=\s*(`[^`]*`@`[^`]*`|CURRENT_USER(\(\))?)/i, '');
  if (db) out = out.split(`${qiMy(db)}.`).join('');
  return out;
}

/* ----------------------------- Export ------------------------------- */

async function listObjects(engine) {
  const a = adapter(engine);
  let rows;
  if (engine === 'postgres') {
    await a.ensureSchema();
    ({ rows } = await a.pool.query(
      `SELECT table_name AS name, table_type AS type FROM information_schema.tables
       WHERE table_schema = 'practice' ORDER BY table_name`
    ));
  } else {
    [rows] = await a.pool.query(
      `SELECT table_name AS name, table_type AS type FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name <> ? ORDER BY table_name`,
      [HISTORY_TABLE]
    );
  }
  return {
    tables: rows.filter((r) => r.type === 'BASE TABLE').map((r) => r.name),
    views: rows.filter((r) => r.type === 'VIEW').map((r) => r.name),
  };
}

async function pgColumns(pool, reg) {
  return (
    await pool.query(
      `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
              a.attnotnull AS notnull, a.attidentity AS identity, a.attgenerated AS generated,
              pg_get_expr(d.adbin, d.adrelid) AS def
       FROM pg_attribute a
       LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = to_regclass($1) AND a.attnum > 0 AND NOT a.attisdropped
       ORDER BY a.attnum`,
      [reg]
    )
  ).rows;
}

async function pgRows(pool, reg, cols, label) {
  if (!cols.length) return [];
  const sel = cols.map((c) => `${qiPg(c.name)}::text AS ${qiPg(c.name)}`).join(', ');
  const r = await pool.query({ text: `SELECT ${sel} FROM ${reg} LIMIT ${ROW_CAP + 1}`, rowMode: 'array' });
  if (r.rows.length > ROW_CAP) throw new UserError(`${label} has more than ${ROW_CAP} rows. Export is limited to ${ROW_CAP} rows per table.`);
  return r.rows;
}

async function pgTable(pool, name) {
  const reg = `practice.${qiPg(name)}`;
  const cols = await pgColumns(pool, reg);

  const seqCols = [];
  const defs = cols.map((c) => {
    let type = c.type;
    let extra = '';
    if (c.generated === 's') extra = ` GENERATED ALWAYS AS (${c.def}) STORED`;
    else if (c.identity) { extra = ' GENERATED BY DEFAULT AS IDENTITY'; seqCols.push(c.name); }
    else if (c.def && /^nextval\(/i.test(c.def) && ['integer', 'bigint', 'smallint'].includes(type)) {
      type = { integer: 'serial', bigint: 'bigserial', smallint: 'smallserial' }[type];
      seqCols.push(c.name);
    } else if (c.def) extra = ` DEFAULT ${c.def}`;
    if (c.notnull) extra += ' NOT NULL';
    return `  ${qiPg(c.name)} ${type}${extra}`;
  });

  const cons = (
    await pool.query(
      `SELECT conname, contype, pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = to_regclass($1) AND contype IN ('p','u','c','f') ORDER BY contype, conname`,
      [reg]
    )
  ).rows;
  const inline = cons.filter((c) => c.contype !== 'f').map((c) => `  CONSTRAINT ${qiPg(c.conname)} ${c.def}`);
  const fks = cons
    .filter((c) => c.contype === 'f')
    .map((c) => `ALTER TABLE ${qiPg(name)} ADD CONSTRAINT ${qiPg(c.conname)} ${c.def};`);

  const indexes = (
    await pool.query(
      `SELECT pg_get_indexdef(i.indexrelid) AS def FROM pg_index i
       WHERE i.indrelid = to_regclass($1)
         AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid)`,
      [reg]
    )
  ).rows.map((r) => `${r.def};`);

  // User triggers (internal foreign-key triggers are excluded) and the functions they call.
  const trg = (
    await pool.query(
      `SELECT t.tgname AS name, pg_get_triggerdef(t.oid) AS def, p.oid::text AS fnoid, n.nspname AS fnschema,
              CASE WHEN n.nspname = 'practice' THEN pg_get_functiondef(p.oid) END AS fndef
       FROM pg_trigger t
       JOIN pg_proc p ON p.oid = t.tgfoid
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE t.tgrelid = to_regclass($1) AND NOT t.tgisinternal ORDER BY t.tgname`,
      [reg]
    )
  ).rows;

  const dataCols = cols.filter((c) => c.generated !== 's');
  const rows = await pgRows(pool, reg, dataCols, `Table ${name}`);

  const post = seqCols.map(
    (c) =>
      `SELECT setval(pg_get_serial_sequence('${reg.replace(/'/g, "''")}', '${c.replace(/'/g, "''")}'), ` +
      `COALESCE((SELECT MAX(${qiPg(c)}) FROM ${qiPg(name)}), 0) + 1, false);`
  );

  return {
    name,
    cols: dataCols.map((c) => c.name),
    csvRows: rows,
    drop: (cascade) => `DROP TABLE IF EXISTS ${qiPg(name)}${cascade ? ' CASCADE' : ''};`,
    create: `CREATE TABLE ${qiPg(name)} (\n${[...defs, ...inline].join(',\n')}\n);`,
    inserts: dataCols.length
      ? insertStatements(qiPg(name), dataCols.map((c) => qiPg(c.name)).join(', '), rows, pgLit)
      : [],
    post: [...post, ...indexes],
    fks,
    functions: trg.filter((t) => t.fndef).map((t) => ({ key: t.fnoid, sql: `${t.fndef.trim()};` })),
    triggers: trg.map((t) => `${t.def};`),
  };
}

async function pgViews(pool, wanted) {
  const rows = (
    await pool.query(
      `SELECT c.relname AS name, pg_get_viewdef(c.oid, true) AS def
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'practice' AND c.relkind = 'v' ORDER BY c.relname`
    )
  ).rows;
  const deps = (
    await pool.query(
      `SELECT DISTINCT dv.relname AS view, src.relname AS dep
       FROM pg_depend d
       JOIN pg_rewrite r ON r.oid = d.objid
       JOIN pg_class dv ON dv.oid = r.ev_class
       JOIN pg_class src ON src.oid = d.refobjid
       JOIN pg_namespace n ON n.oid = dv.relnamespace
       WHERE d.classid = 'pg_rewrite'::regclass AND d.refclassid = 'pg_class'::regclass
         AND dv.oid <> src.oid AND n.nspname = 'practice'`
    )
  ).rows;
  const byName = new Map(rows.map((r) => [r.name, r]));
  const order = sortByDependency(rows.map((r) => r.name), deps.map((d) => [d.view, d.dep]));
  return order
    .filter((n) => !wanted || wanted.includes(n))
    .map((n) => ({
      name: n,
      drop: (cascade) => `DROP VIEW IF EXISTS ${qiPg(n)}${cascade ? ' CASCADE' : ''};`,
      create: `CREATE VIEW ${qiPg(n)} AS\n${byName.get(n).def.trim().replace(/;$/, '')};`,
    }));
}

async function pgViewRows(pool, name) {
  const reg = `practice.${qiPg(name)}`;
  const cols = await pgColumns(pool, reg);
  return { name, cols: cols.map((c) => c.name), csvRows: await pgRows(pool, reg, cols, `View ${name}`) };
}

async function myTable(pool, name, db) {
  const [created] = await pool.query(`SHOW CREATE TABLE ${qiMy(name)}`);
  const create = created[0]['Create Table'];
  const [rows, fields] = await pool.query({
    sql: `SELECT * FROM ${qiMy(name)} LIMIT ${ROW_CAP + 1}`,
    rowsAsArray: true,
  });
  if (rows.length > ROW_CAP) throw new UserError(`Table ${name} has more than ${ROW_CAP} rows. Export is limited to ${ROW_CAP} rows per table.`);
  const cols = fields.map((f) => f.name);
  const csvVal = (v) => {
    if (Buffer.isBuffer(v)) return v.toString('hex');
    if (v !== null && typeof v === 'object') return JSON.stringify(v);
    return v;
  };

  const [trs] = await pool.query(
    `SELECT trigger_name AS name FROM information_schema.triggers
     WHERE trigger_schema = DATABASE() AND event_object_table = ? ORDER BY action_order, trigger_name`,
    [name]
  );
  const triggers = [];
  for (const t of trs) {
    const [r] = await pool.query(`SHOW CREATE TRIGGER ${qiMy(t.name)}`);
    triggers.push(`${cleanMysqlStatement(r[0]['SQL Original Statement'], db)};`);
  }

  return {
    name,
    cols,
    csvRows: rows.map((r) => r.map(csvVal)),
    drop: () => `DROP TABLE IF EXISTS ${qiMy(name)};`,
    create: `${create};`,
    inserts: insertStatements(qiMy(name), cols.map(qiMy).join(', '), rows, myLit),
    post: [],
    fks: [],
    functions: [],
    triggers,
  };
}

async function myViews(pool, wanted, db) {
  const [rows] = await pool.query(
    `SELECT table_name AS name FROM information_schema.views WHERE table_schema = DATABASE() ORDER BY table_name`
  );
  let edges = [];
  try {
    const [e] = await pool.query(
      `SELECT view_name AS v, table_name AS d FROM information_schema.view_table_usage
       WHERE view_schema = DATABASE() AND table_schema = DATABASE()`
    );
    edges = e.map((r) => [r.v, r.d]);
  } catch {
    /* older servers: fall back to alphabetical order */
  }
  const order = sortByDependency(rows.map((r) => r.name), edges).filter((n) => !wanted || wanted.includes(n));
  const out = [];
  for (const n of order) {
    const [r] = await pool.query(`SHOW CREATE VIEW ${qiMy(n)}`);
    out.push({
      name: n,
      drop: () => `DROP VIEW IF EXISTS ${qiMy(n)};`,
      create: `${cleanMysqlStatement(r[0]['Create View'], db)};`,
    });
  }
  return out;
}

async function myViewRows(pool, name) {
  const [rows, fields] = await pool.query({
    sql: `SELECT * FROM ${qiMy(name)} LIMIT ${ROW_CAP + 1}`,
    rowsAsArray: true,
  });
  if (rows.length > ROW_CAP) throw new UserError(`View ${name} has more than ${ROW_CAP} rows. Export is limited to ${ROW_CAP} rows per table.`);
  return {
    name,
    cols: fields.map((f) => f.name),
    csvRows: rows.map((r) => r.map((v) => (Buffer.isBuffer(v) ? v.toString('hex') : v !== null && typeof v === 'object' ? JSON.stringify(v) : v))),
  };
}

function buildDump(engine, parts, views, whole) {
  const functions = new Map();
  for (const p of parts) for (const f of p.functions) functions.set(f.key, f.sql);
  const triggerCount = parts.reduce((n, p) => n + p.triggers.length, 0);

  const lines = [
    '-- SQL Practice dump',
    `-- engine: ${engine}`,
    `-- created: ${new Date().toISOString()}`,
    `-- tables: ${parts.map((p) => p.name).join(', ') || '(none)'}`,
    `-- views: ${views.map((v) => v.name).join(', ') || '(none)'}`,
    `-- triggers: ${triggerCount}`,
    '-- Restoring replaces tables and views with the same names.',
    '',
  ];
  if (engine === 'mysql') lines.push('SET NAMES utf8mb4;', 'SET FOREIGN_KEY_CHECKS=0;', '');
  for (const v of [...views].reverse()) lines.push(v.drop(whole));
  for (const p of parts) lines.push(p.drop(whole), p.create, '');
  for (const p of parts) if (p.inserts.length) lines.push(`-- data: ${p.name}`, ...p.inserts, '');
  for (const p of parts) lines.push(...p.post);
  for (const p of parts) lines.push(...p.fks);
  if (views.length) lines.push('', '-- views');
  for (const v of views) lines.push(v.create);
  // Functions and triggers go last so triggers do not fire while data is restored.
  if (functions.size) lines.push('', '-- trigger functions', ...functions.values());
  if (triggerCount) lines.push('', '-- triggers');
  for (const p of parts) lines.push(...p.triggers);
  if (engine === 'mysql') lines.push('', 'SET FOREIGN_KEY_CHECKS=1;');
  return lines.join('\n') + '\n';
}

export async function exportZip(engine, name) {
  const a = adapter(engine);
  const { tables, views } = await listObjects(engine);
  let db = null;
  if (engine === 'mysql') db = (await a.pool.query('SELECT DATABASE() AS db'))[0][0].db;

  let tableNames = tables;
  let viewNames = views;
  let singleView = null;
  if (name) {
    if (tables.includes(name)) { tableNames = [name]; viewNames = []; }
    else if (views.includes(name)) { tableNames = []; viewNames = [name]; singleView = name; }
    else throw new UserError(`"${name}" not found`, 404);
  }
  if (!tableNames.length && !viewNames.length) throw new UserError('There is nothing to export');

  const parts = [];
  for (const t of tableNames) parts.push(engine === 'postgres' ? await pgTable(a.pool, t) : await myTable(a.pool, t, db));
  const viewDefs = viewNames.length
    ? engine === 'postgres' ? await pgViews(a.pool, viewNames) : await myViews(a.pool, viewNames, db)
    : [];

  const csvParts = [...parts];
  if (singleView) csvParts.push(engine === 'postgres' ? await pgViewRows(a.pool, singleView) : await myViewRows(a.pool, singleView));

  const files = { 'dump.sql': strToU8(buildDump(engine, parts, viewDefs, !name)) };
  const used = new Set();
  for (const p of csvParts) {
    let base = safeName(p.name);
    while (used.has(base.toLowerCase())) base += '_';
    used.add(base.toLowerCase());
    files[`csv/${base}.csv`] = strToU8(toCsv(p.cols, p.csvRows));
  }
  const date = new Date().toISOString().slice(0, 10);
  return {
    filename: name ? `${safeName(name)}-${engine}.zip` : `practice-${engine}-${date}.zip`,
    data: zipSync(files, { level: 6 }),
  };
}

/* ----------------------------- Import ------------------------------- */

function csvToScript(engine, fileName, text) {
  const rows = parseCsv(text);
  if (!rows.length) throw new UserError(`${fileName}: CSV is empty`);
  const header = rows[0].map((h) => h.trim());
  if (header.some((h) => !h)) throw new UserError(`${fileName}: header has an empty column name`);
  const lower = header.map((h) => h.toLowerCase());
  if (new Set(lower).size !== lower.length) throw new UserError(`${fileName}: header has duplicate column names`);
  const data = rows.slice(1);
  if (data.length > ROW_CAP) throw new UserError(`${fileName}: more than ${ROW_CAP} rows`);

  let table = fileName.split('/').pop().replace(/\.csv$/i, '').replace(/[^A-Za-z0-9_]/g, '_') || 'imported';
  if (/^\d/.test(table)) table = `t_${table}`;
  if (table.toLowerCase() === HISTORY_TABLE) throw new UserError(`${fileName}: table name is reserved`);

  const qi = engine === 'mysql' ? qiMy : qiPg;
  const lit = engine === 'mysql' ? myLit : pgLit;
  const types = header.map((_, i) => sqlType(engine, inferType(data.map((r) => r[i]))));
  const norm = data.map((r) => header.map((_, i) => (r[i] === undefined || r[i] === '' ? null : r[i])));

  return [
    engine === 'mysql' ? 'SET NAMES utf8mb4;' : '',
    `DROP TABLE IF EXISTS ${qi(table)};`,
    `CREATE TABLE ${qi(table)} (${header.map((h, i) => `${qi(h)} ${types[i]}`).join(', ')});`,
    ...insertStatements(qi(table), header.map(qi).join(', '), norm, lit),
  ].join('\n');
}

async function runScript(engine, sql) {
  const head = sql.slice(0, 500);
  const declared = /^--\s*engine:\s*(\w+)/im.exec(head)?.[1];
  if (declared && declared !== engine) {
    throw new UserError(`This dump is for ${declared}, but ${engine} is selected. Switch the server and try again.`);
  }
  const a = adapter(engine);
  if (engine === 'postgres') {
    await a.ensureSchema();
    const client = await a.pool.connect();
    try {
      await client.query(`SET statement_timeout = ${IMPORT_TIMEOUT_MS}`);
      await client.query(sql); // one multi-statement query = one transaction, so it is all-or-nothing
    } finally {
      await client.query('RESET statement_timeout').catch(() => {});
      client.release();
    }
  } else {
    const conn = await a.connectMulti();
    try {
      await conn.query({ sql, timeout: IMPORT_TIMEOUT_MS });
    } finally {
      await conn.end().catch(() => {});
    }
  }
}

export async function importFile(engine, fileName, buf) {
  const ext = (fileName.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1];
  const scripts = [];

  if (ext === 'zip') {
    let total = 0;
    let files;
    try {
      files = unzipSync(new Uint8Array(buf), {
        filter: (f) => {
          if (!/\.(sql|csv)$/i.test(f.name) || f.name.includes('__MACOSX')) return false;
          total += f.originalSize;
          if (total > MAX_UNZIPPED) throw new UserError('Zip is too large when unpacked (max 50 MB)');
          return true;
        },
      });
    } catch (e) {
      if (e instanceof UserError) throw e;
      throw new UserError('Not a valid zip file');
    }
    const names = Object.keys(files).sort();
    const sqlNames = names.filter((n) => /\.sql$/i.test(n));
    if (sqlNames.length) for (const n of sqlNames) scripts.push(strFromU8(files[n]));
    else for (const n of names) scripts.push(csvToScript(engine, n, strFromU8(files[n])));
    if (!scripts.length) throw new UserError('The zip has no .sql or .csv files');
  } else if (ext === 'sql') {
    scripts.push(buf.toString('utf8'));
  } else if (ext === 'csv') {
    scripts.push(csvToScript(engine, fileName, buf.toString('utf8')));
  } else {
    throw new UserError('Unsupported file type. Use .zip, .sql or .csv');
  }

  for (const s of scripts) await runScript(engine, s);
  return { files: scripts.length };
}
