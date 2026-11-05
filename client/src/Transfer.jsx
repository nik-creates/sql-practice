import { useRef, useState } from 'react';
import { download, upload } from './api.js';

export function ExportPane({ engine, label, tables, initialTable, onNotice, onError }) {
  const [scope, setScope] = useState(initialTable ? 'table' : 'all');
  const [table, setTable] = useState(initialTable || tables[0]?.name || '');
  const [busy, setBusy] = useState(false);

  async function go(e) {
    e.preventDefault();
    setBusy(true);
    onError('');
    onNotice('');
    try {
      const q = `/export?engine=${engine}${scope === 'table' ? `&table=${encodeURIComponent(table)}` : ''}`;
      const name = await download(q, 'export.zip');
      onNotice(`Saved ${name} to your downloads.`);
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const empty = tables.length === 0;
  return (
    <form className="fieldset" onSubmit={go}>
      <div className="legend">Export from {label}</div>
      <div className="fbody">
        <label className="radio">
          <input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} />
          Whole database ({tables.length} table{tables.length === 1 ? '' : 's'})
        </label>
        <label className="radio">
          <input type="radio" checked={scope === 'table'} onChange={() => setScope('table')} disabled={empty} />
          One table
          <select value={table} onChange={(e) => { setTable(e.target.value); setScope('table'); }} disabled={empty}>
            {tables.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
          </select>
        </label>
        <p className="muted">
          Downloads a .zip with <b>dump.sql</b> (structure and data, restores exactly) and a
          <b> csv/</b> folder with one CSV per table (opens in Excel).
        </p>
      </div>
      <div className="foot">
        <button className="go" disabled={busy || empty}>{busy ? '…' : 'Go'}</button>
      </div>
    </form>
  );
}

export function ImportPane({ engine, label, onDone, onNotice, onError }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);

  async function go(e) {
    e.preventDefault();
    if (!file) return onError('Choose a file first.');
    if (!window.confirm(`Tables with the same names in ${label} will be replaced. Continue?`)) return;
    setBusy(true);
    onError('');
    onNotice('');
    try {
      await upload(`/import?engine=${engine}&name=${encodeURIComponent(file.name)}`, file);
      onNotice(`Imported ${file.name}.`);
      setFile(null);
      if (input.current) input.current.value = '';
      onDone();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="fieldset" onSubmit={go}>
      <div className="legend">Import into {label}</div>
      <div className="fbody">
        <input ref={input} type="file" accept=".zip,.sql,.csv" onChange={(e) => setFile(e.target.files[0] || null)} />
        <p className="muted">
          Accepts a .zip made by Export, a .sql dump, or a .csv (the file name becomes the table name,
          column types are guessed, empty cells become NULL). Max 10 MB.
        </p>
        <p className="muted">
          A dump from PostgreSQL only imports into PostgreSQL, and the same for MySQL.
          Tables with the same names are replaced. A failed PostgreSQL import changes nothing.
        </p>
      </div>
      <div className="foot">
        <button className="go" disabled={busy || !file}>{busy ? '…' : 'Go'}</button>
      </div>
    </form>
  );
}
