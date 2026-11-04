import { useEffect } from 'react';
import { UI_FONTS, CODE_FONTS } from './settings.js';

function Row({ label, children }) {
  return (
    <label className="srow">
      <span>{label}</span>
      <div>{children}</div>
    </label>
  );
}

export default function Settings({ settings, update, reset, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const s = settings;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Settings">
        <div className="legend">
          Settings
          <button className="x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="mbody">
          <h4>Appearance</h4>
          <Row label="Theme">
            <select value={s.theme} onChange={(e) => update({ theme: e.target.value })}>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="auto">Match system</option>
            </select>
          </Row>
          <Row label="Interface font">
            <select value={s.uiFont} onChange={(e) => update({ uiFont: e.target.value })}>
              {Object.entries(UI_FONTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Row>
          <Row label={`Interface size (${s.uiSize}px)`}>
            <input type="range" min="11" max="18" value={s.uiSize}
              onChange={(e) => update({ uiSize: Number(e.target.value) })} />
          </Row>
          <Row label="Table density">
            <select value={s.density} onChange={(e) => update({ density: e.target.value })}>
              <option value="compact">Compact</option>
              <option value="normal">Normal</option>
              <option value="comfortable">Comfortable</option>
            </select>
          </Row>
          <Row label="Striped table rows">
            <input type="checkbox" checked={s.zebra} onChange={(e) => update({ zebra: e.target.checked })} />
          </Row>

          <h4>Editor and results</h4>
          <Row label="Code font">
            <select value={s.codeFont} onChange={(e) => update({ codeFont: e.target.value })}>
              {Object.entries(CODE_FONTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Row>
          <Row label={`Code size (${s.codeSize}px)`}>
            <input type="range" min="11" max="22" value={s.codeSize}
              onChange={(e) => update({ codeSize: Number(e.target.value) })} />
          </Row>
          <Row label={`Editor height (${s.editorHeight}px)`}>
            <input type="range" min="100" max="500" step="20" value={s.editorHeight}
              onChange={(e) => update({ editorHeight: Number(e.target.value) })} />
          </Row>
          <Row label="Line numbers">
            <input type="checkbox" checked={s.lineNumbers} onChange={(e) => update({ lineNumbers: e.target.checked })} />
          </Row>
          <Row label="Wrap long lines">
            <input type="checkbox" checked={s.wrap} onChange={(e) => update({ wrap: e.target.checked })} />
          </Row>

          <div className="preview mono">SELECT name, salary FROM employees WHERE salary &gt; 90000;</div>
        </div>
        <div className="foot">
          <button onClick={reset}>Reset to defaults</button>
          <button className="go" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
