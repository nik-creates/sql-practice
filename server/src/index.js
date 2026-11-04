import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { checkCredentials, signToken, requireAuth } from './auth.js';
import {
  initDb, runQuery, getSchema, addHistory, listHistory, clearHistory, engines,
} from './db.js';
import { SAMPLE_STATEMENTS } from './sample.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '200kb' }));

const MAX_SQL = 20000;
const validEngine = (e) => e === 'postgres' || e === 'mysql';

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post(
  '/api/login',
  rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false }),
  (req, res) => {
    const { username, password } = req.body || {};
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

app.get('/api/history', async (_req, res) => {
  res.json({ history: await listHistory(100) });
});

app.delete('/api/history', async (_req, res) => {
  await clearHistory();
  res.json({ ok: true });
});

// Serve built frontend in production.
const dist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

const port = process.env.PORT || 3000;
initDb()
  .then(() => app.listen(port, () => console.log(`Listening on ${port}`)))
  .catch((e) => {
    console.error('Startup failed:', e.message);
    process.exit(1);
  });
