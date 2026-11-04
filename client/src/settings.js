import { useCallback, useEffect, useState } from 'react';

export const UI_FONTS = {
  verdana: { label: 'Verdana (phpMyAdmin)', stack: "Verdana, Geneva, Arial, sans-serif" },
  system: { label: 'System UI', stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  inter: { label: 'Inter', stack: "'Inter', system-ui, sans-serif" },
  plex: { label: 'IBM Plex Sans', stack: "'IBM Plex Sans', system-ui, sans-serif" },
  georgia: { label: 'Georgia (serif)', stack: "Georgia, 'Times New Roman', serif" },
};

export const CODE_FONTS = {
  consolas: { label: 'Consolas / Monospace', stack: "Consolas, 'Courier New', monospace" },
  jetbrains: { label: 'JetBrains Mono', stack: "'JetBrains Mono', Consolas, monospace" },
  fira: { label: 'Fira Code', stack: "'Fira Code', Consolas, monospace" },
  source: { label: 'Source Code Pro', stack: "'Source Code Pro', Consolas, monospace" },
};

export const DEFAULTS = {
  theme: 'light', // light | dark | auto
  uiFont: 'verdana',
  uiSize: 13,
  codeFont: 'consolas',
  codeSize: 13,
  editorHeight: 200,
  lineNumbers: true,
  wrap: false,
  zebra: true,
  density: 'normal', // compact | normal | comfortable
};

const KEY = 'sqlpractice_settings';

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

function systemDark() {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState(load);
  const [sysDark, setSysDark] = useState(systemDark);

  useEffect(() => {
    let mq;
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return undefined;
    }
    const on = (e) => setSysDark(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const resolved = settings.theme === 'auto' ? (sysDark ? 'dark' : 'light') : settings.theme;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolved;
    root.dataset.zebra = settings.zebra ? 'on' : 'off';
    root.dataset.density = settings.density;
    root.style.setProperty('--ui-font', (UI_FONTS[settings.uiFont] || UI_FONTS.verdana).stack);
    root.style.setProperty('--ui-size', `${settings.uiSize}px`);
    root.style.setProperty('--code-font', (CODE_FONTS[settings.codeFont] || CODE_FONTS.consolas).stack);
    root.style.setProperty('--code-size', `${settings.codeSize}px`);
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }, [settings, resolved]);

  const update = useCallback((patch) => setSettings((s) => ({ ...s, ...patch })), []);
  const reset = useCallback(() => setSettings({ ...DEFAULTS }), []);

  return { settings, update, reset, resolved };
}
