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
      const q = `/export?engine=${engine}${scope === 'table' ? \`&table=\${encodeURIComponent(table)}\` : ''}`;
      const name = await download(q, 'export.zip');
      onNotice(`Saved ${name} to your downloads.`);
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const empty = tables.length === 0;
  const nViews = tables.filter((t) => t.kind === 'view').length;
  const nTables = tables.length - nViews;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return (
    <form className="fieldset" onSubmit={go}>
      <div className="legend">
        <span>📤 Export from {label}</span>
      </div>
      <div className="fbody">
        <label className="radio">
          <input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} />
          <span>Whole database <b>({plural(nTables, 'table')}, {plural(nViews, 'view')})</b> includes triggers.</span>
        </label>
        <label className="radio">
          <input type="radio" checked={scope === 'table'} onChange={() => setScope('table')} disabled={empty} />
          <span>One table or view:</span>
          <select value={table} onChange={(e) => { setTable(e.target.value); setScope('table'); }} disabled={empty}>
            {tables.map((t) => <option key={t.name} value={t.name}>{t.name}{t.kind === 'view' ? ' (view)' : ''}</option>)}
          </select>
        </label>
        <p className="muted" style={{ marginTop: '8px', padding: '12px', backgroundColor: 'var(--soft)', borderRadius: '6px' }}>
          💡 <strong>What you get:</strong> Downloads a <code>.zip</code> containing <b>dump.sql</b> (structure, data, views and triggers) 
          and a <b>csv/</b> folder with one CSV per table (opens easily in Excel).
        </p>
      </div>
      <div className="foot">
        <button className="go" disabled={busy || empty}>{busy ? 'Exporting...' : 'Export to .zip'}</button>
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
      <div className="legend">
        <span>📥 Import into {label}</span>
      </div>
      <div className="fbody">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', border: '2px dashed var(--border)', borderRadius: '6px', backgroundColor: 'var(--bg)' }}>
          <span style={{ fontSize: '24px' }}>📁</span>
          <div style={{ flex: 1 }}>
            <input ref={input} type="file" accept=".zip,.sql,.csv" onChange={(e) => setFile(e.target.files[0] || null)} />
            <div style={{ marginTop: '4px', fontSize: '0.85em', color: 'var(--muted)' }}>
              Supports .zip, .sql, or .csv (Max 10 MB)
            </div>
          </div>
        </div>
        
        <p className="muted" style={{ lineHeight: '1.6' }}>
          <strong>How it works:</strong> <br/>
          • <b>.zip</b> files created by the Export tool restore perfectly.<br/>
          • <b>.csv</b> files will auto-generate a table based on the filename and guess column types.<br/>
          • Dumps from PostgreSQL only import into PostgreSQL (same for MySQL).
        </p>
      </div>
      <div className="foot">
        <button className="go" disabled={busy || !file}>{busy ? 'Importing...' : 'Start Import'}</button>
      </div>
    </form>
  );
}