import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { checkCredentials, signToken, requireAuth } from './auth.js';
import {
  runQuery, getSchema, addHistory, listHistory, clearHistory, engines,
} from './db.js';
import { SAMPLE_STATEMENTS } from './sample.js';
import { exportZip, importFile } from './transfer.js';
import { verifyTurnstile, turnstileSkipped } from './turnstile.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '200kb' }));

const MAX_SQL = 20000;
const validEngine = (e) => e === 'postgres' || e === 'mysql';

// Behind Cloudflare, req.ip is Cloudflare's edge. CF-Connecting-IP carries the real visitor IP.
// It is only trustworthy when traffic really comes through Cloudflare (see README, security notes).
const clientIp = (req) => {
  const h = req.headers['cf-connecting-ip'];
  return (typeof h === 'string' && h.trim()) || req.ip;
};
const limiter = (opts) =>
  rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: clientIp,
    ...opts,
  });

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Global limit for every other /api route, applied before authentication.
app.use(
  '/api',
  limiter({
    windowMs: 60 * 1000,
    limit: 120,
    skip: (req) => req.path === '/health',
    message: { error: 'Too many requests. Slow down and try again in a minute.' },
  })
);

app.post(
  '/api/login',
  limiter({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  }),
  async (req, res) => {
    const { username, password, turnstileToken } = req.body || {};
    const human = await verifyTurnstile(turnstileToken, clientIp(req));
    if (!human.ok) return res.status(human.status).json({ error: human.error });
    if (!checkCredentials(username, password)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    res.json({ token: signToken(username) });
  }
);

app.use('/api', requireAuth);

app.get('/api/engines', (_req, res) => res.json(engines()));

app.get('/api/schema', async (req, res) => {
  const engine = String(req.query.engine);
  if (!validEngine(engine)) return res.status(400).json({ error: 'Invalid engine' });
  try {
    res.json({ tables: await getSchema(engine) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/query', async (req, res) => {
  const { engine, sql } = req.body || {};
  if (!validEngine(engine)) return res.status(400).json({ error: 'Invalid engine' });
  if (typeof sql !== 'string' || !sql.trim()) return res.status(400).json({ error: 'Query is empty' });
  if (sql.length > MAX_SQL) return res.status(400).json({ error: 'Query too long' });
  try {
    const result = await runQuery(engine, sql);
    await addHistory({ engine, query: sql, success: true, rowCount: result.rowCount, durationMs: result.durationMs })
      .catch((e) => console.error('history', e.message));
    res.json(result);
  } catch (e) {
    await addHistory({ engine, query: sql, success: false, error: e.message })
      .catch((err) => console.error('history', err.message));
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/sample', async (req, res) => {
  const { engine } = req.body || {};
  if (!validEngine(engine)) return res.status(400).json({ error: 'Invalid engine' });
  try {
    for (const stmt of SAMPLE_STATEMENTS) await runQuery(engine, stmt);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Save tables to disk (zip) and restore them later.
app.get('/api/export', async (req, res) => {
  const engine = String(req.query.engine);
  if (!validEngine(engine)) return res.status(400).json({ error: 'Invalid engine' });
  try {
    const table = req.query.table ? String(req.query.table) : null;
    const { filename, data } = await exportZip(engine, table);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    });
    res.send(Buffer.from(data));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

app.post('/api/import', express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
  const engine = String(req.query.engine);
  const name = String(req.query.name || '');
  if (!validEngine(engine)) return res.status(400).json({ error: 'Invalid engine' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'No file received' });
  try {
    const result = await importFile(engine, name, req.body);
    await addHistory({ engine, query: `-- Imported file: ${name}`, success: true })
      .catch((e) => console.error('history', e.message));
    res.json({ ok: true, ...result });
  } catch (e) {
    await addHistory({ engine, query: `-- Imported file: ${name}`, success: false, error: e.message })
      .catch((err) => console.error('history', err.message));
    res.status(e.status || 400).json({ error: e.message });
  }
});

// History lives only in MySQL. If MySQL is down or not configured it is simply empty.
app.get('/api/history', async (_req, res) => {
  try {
    res.json({ history: await listHistory(100) });
  } catch (e) {
    console.error('history:', e.message);
    res.json({ history: [], error: e.message });
  }
});

app.delete('/api/history', async (_req, res) => {
  try {
    await clearHistory();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Serve built frontend in production.
const dist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, _req, res, _next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'File too large (max 10 MB)' });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Listening on ${port}`);
  if (turnstileSkipped()) console.warn('Turnstile check is OFF (TURNSTILE_SECRET unset, not production)');
});
