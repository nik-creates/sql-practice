import { useCallback, useEffect, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { sql as sqlLang, PostgreSQL, MySQL } from '@codemirror/lang-sql';
import { keymap } from '@codemirror/view';
import { githubLight } from '@uiw/codemirror-theme-github';
import Login from './Login.jsx';
import { api, getToken, clearToken } from './api.js';

const LABEL = { postgres: 'PostgreSQL', mysql: 'MySQL' };
const DB_NAME = { postgres: 'practice', mysql: 'practice' };
const quote = (engine, id) => (engine === 'mysql' ? `\`${id}\`` : `"${id}"`);

export default function App() {
  const [authed, setAuthed] = useState(Boolean(getToken()));
  if (!authed) return <Login onLogin={() => setAuthed(true)} />;
  return <Workspace onLogout={() => { clearToken(); setAuthed(false); }} />;
}

function Workspace({ onLogout }) {
  const [engine, setEngine] = useState(localStorage.getItem('engine') || 'postgres');
  const [available, setAvailable] = useState({ postgres: true, mysql: false });
  const [tab, setTab] = useState('sql');
  const [table, setTable] = useState(null);
  const [tables, setTables] = useState([]);
  const [query, setQuery] = useState(localStorage.getItem('query') || 'SELECT 1 AS hello;');
  const [result, setResult] = useState(null);
  const [executed, setExecuted] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState([]);

  const loadSchema = useCallback(async (eng) => {
    try { setTables((await api(`/schema?engine=${eng}`)).tables); } catch { setTables([]); }
  }, []);
  const loadHistory = useCallback(async () => {
    try { setHistory((await api('/history')).history); } catch { /* ignore */ }
  }, []);

  useEffect(() => { api('/engines').then(setAvailable).catch(() => {}); loadHistory(); }, [loadHistory]);
  useEffect(() => { localStorage.setItem('engine', engine); loadSchema(engine); }, [engine, loadSchema]);
  useEffect(() => { localStorage.setItem('query', query); }, [query]);

  const exec = useCallback(async (sql) => {
    if (running || !sql.trim()) return;
    setRunning(true);
    setError('');
    setNotice('');
    setExecuted(sql);
    try {
      setResult(await api('/query', { method: 'POST', body: { engine, sql } }));
    } catch (e) {
      setResult(null);
      setError(e.message);
    } finally {
      setRunning(false);
      loadHistory();
      loadSchema(engine);
    }
  }, [engine, running, loadHistory, loadSchema]);

  const runRef = useRef(null);
  runRef.current = () => exec(query);
  const keys = useRef(keymap.of([{ key: 'Mod-Enter', run: () => { runRef.current(); return true; } }]));

  function switchEngine(e) {
    setEngine(e);
    setTable(null);
    setResult(null);
    setError('');
    setNotice('');
    setTab('sql');
  }

  function browse(name) {
    setTable(name);
    setTab('browse');
    exec(`SELECT * FROM ${quote(engine, name)} LIMIT 25`);
  }

  function structure(name) {
    setTable(name);
    setTab('structure');
    setResult(null);
    setError('');
    setNotice('');
  }

  async function drop(name) {
    if (!window.confirm(`Really drop table ${name}?`)) return;
    setTab('structure');
    setTable(null);
    await exec(`DROP TABLE ${quote(engine, name)}`);
  }

  async function loadSample() {
    setError('');
    try {
      await api('/sample', { method: 'POST', body: { engine } });
      setNotice('Sample tables "employees" and "departments" created.');
      setResult(null);
      setTab('structure');
      setTable(null);
      loadSchema(engine);
    } catch (e) {
      setError(e.message);
    }
  }

  async function clearHistory() {
    await api('/history', { method: 'DELETE' });
    setHistory([]);
  }

  const cur = tables.find((t) => t.name === table);
  const dialect = engine === 'mysql' ? MySQL : PostgreSQL;

  return (
    <div className="pma">
      <aside className="nav">
        <div className="logo">SQL<span>Practice</span></div>
        <div className="nav-top">
          <button className="icon" title="Home" onClick={() => { setTable(null); setTab('structure'); }}>⌂</button>
          <button className="icon" title="Reload" onClick={() => loadSchema(engine)}>⟳</button>
          <button className="icon" title="Log out" onClick={onLogout}>⎋</button>
        </div>
        <div className="nav-server">
          <label>Server</label>
          <select value={engine} onChange={(e) => switchEngine(e.target.value)}>
            {Object.keys(LABEL).map((k) => (
              <option key={k} value={k} disabled={!available[k]}>
                {LABEL[k]}{available[k] ? '' : ' (not configured)'}
              </option>
            ))}
          </select>
        </div>
        <ul className="tree">
          <li className="db" onClick={() => { setTable(null); setTab('structure'); }}>🗄 {DB_NAME[engine]}</li>
          {tables.map((t) => (
            <li key={t.name} className={`tbl ${table === t.name ? 'sel' : ''}`} onClick={() => browse(t.name)}>
              ▦ {t.name}
            </li>
          ))}
          {tables.length === 0 && <li className="empty">(no tables)</li>}
        </ul>
      </aside>

      <section className="content">
        <div className="crumbs">
          <span>🖥 Server: {LABEL[engine]}</span>
          <span className="sep">»</span>
          <span>🗄 Database: {DB_NAME[engine]}</span>
          {table && (<><span className="sep">»</span><span>▦ Table: {table}</span></>)}
        </div>

        <ul className="tabs">
          {table && <li className={tab === 'browse' ? 'on' : ''} onClick={() => browse(table)}>Browse</li>}
          <li className={tab === 'structure' ? 'on' : ''} onClick={() => (table ? structure(table) : (setTab('structure'), setResult(null)))}>Structure</li>
          <li className={tab === 'sql' ? 'on' : ''} onClick={() => setTab('sql')}>SQL</li>
          <li className={tab === 'history' ? 'on' : ''} onClick={() => { setTab('history'); loadHistory(); }}>History</li>
        </ul>

        <div className="pane">
          {notice && <div className="msg ok">✔ {notice}</div>}
          {error && <div className="msg bad">✖ {error}</div>}

          {tab === 'sql' && (
            <form className="fieldset" onSubmit={(e) => { e.preventDefault(); exec(query); }}>
              <div className="legend">Run SQL query/queries on database {DB_NAME[engine]}:</div>
              <CodeMirror value={query} height="200px" theme={githubLight}
                extensions={[sqlLang({ dialect }), keys.current]} onChange={setQuery}
                basicSetup={{ lineNumbers: true, foldGutter: false }} />
              <div className="foot">
                <span className="hint">Ctrl/Cmd+Enter to run</span>
                <button type="button" onClick={() => setQuery('')}>Clear</button>
                <button className="go" disabled={running}>{running ? '…' : 'Go'}</button>
              </div>
            </form>
          )}

          {tab === 'structure' && !table && (
            <>
              <div className="actions">
                <button onClick={loadSample}>Load sample data</button>
              </div>
              <table className="grid">
                <thead><tr><th>Table</th><th>Columns</th><th colSpan="3">Action</th></tr></thead>
                <tbody>
                  {tables.map((t) => (
                    <tr key={t.name}>
                      <td><b>{t.name}</b></td>
                      <td>{t.columns.length}</td>
                      <td><a onClick={() => browse(t.name)}>Browse</a></td>
                      <td><a onClick={() => structure(t.name)}>Structure</a></td>
                      <td><a className="danger" onClick={() => drop(t.name)}>Drop</a></td>
                    </tr>
                  ))}
                  {tables.length === 0 && <tr><td colSpan="5" className="null">No tables found in database. Use the SQL tab to create one.</td></tr>}
                </tbody>
              </table>
            </>
          )}

          {tab === 'structure' && cur && (
            <table className="grid">
              <thead><tr><th>#</th><th>Name</th><th>Type</th></tr></thead>
              <tbody>
                {cur.columns.map((c, i) => (
                  <tr key={c.name}><td>{i + 1}</td><td><b>{c.name}</b></td><td>{c.type}</td></tr>
                ))}
              </tbody>
            </table>
          )}

          {(tab === 'sql' || tab === 'browse') && (error || result) && executed && (
            <>
              {result && <ResultInfo result={result} />}
              <pre className="sqlbox">{executed}</pre>
              {result && <ResultTable result={result} />}
            </>
          )}

          {tab === 'history' && (
            <>
              <div className="actions">
                <button onClick={clearHistory} disabled={!history.length}>Clear history</button>
              </div>
              <table className="grid">
                <thead><tr><th>Time</th><th>Server</th><th>Status</th><th>SQL</th></tr></thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td className="nowrap">{new Date(h.createdAt).toLocaleString()}</td>
                      <td>{LABEL[h.engine]}</td>
                      <td className={h.success ? 'okc' : 'badc'}>{h.success ? 'OK' : 'Error'}</td>
                      <td>
                        <a className="mono" title="Load into SQL tab"
                          onClick={() => { switchEngine(h.engine); setQuery(h.query); setTab('sql'); }}>
                          {h.query.length > 160 ? h.query.slice(0, 160) + '…' : h.query}
                        </a>
                      </td>
                    </tr>
                  ))}
                  {history.length === 0 && <tr><td colSpan="4" className="null">No queries yet.</td></tr>}
                </tbody>
              </table>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function ResultInfo({ result }) {
  const secs = (result.durationMs / 1000).toFixed(4);
  const isSelect = result.columns.length > 0;
  let text;
  if (isSelect) {
    text = result.rowCount === 0
      ? `Empty result set (zero rows). (Query took ${secs} seconds.)`
      : `Showing rows 0 - ${result.rows.length - 1} (${result.rowCount} total, Query took ${secs} seconds.)${result.truncated ? ' Display limited to 1000 rows.' : ''}`;
  } else {
    text = `Your SQL query has been executed successfully. ${result.rowCount} row(s) affected. (Query took ${secs} seconds.)`;
  }
  return <div className="msg ok">✔ {text}</div>;
}

function ResultTable({ result }) {
  if (result.columns.length === 0) return null;
  return (
    <div className="scroll">
      <table className="grid">
        <thead><tr>{result.columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
        <tbody>
          {result.rows.map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => <td key={j} className={v === null ? 'null' : ''}>{v === null ? 'NULL' : String(v)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
