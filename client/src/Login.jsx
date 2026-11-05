import { useEffect, useRef, useState } from 'react';
import { login, setToken } from './api.js';

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let scriptPromise;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve(window.turnstile);
    s.onerror = () => {
      scriptPromise = null;
      s.remove();
      reject(new Error('Could not load the human check. Reload the page.'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState('');
  const box = useRef(null);
  const widget = useRef(null);

  // Explicit render of the Turnstile widget. Without a site key (local dev) it is skipped.
  useEffect(() => {
    if (!SITE_KEY) return undefined;
    let cancelled = false;
    loadTurnstile()
      .then((ts) => {
        if (cancelled || !box.current) return;
        widget.current = ts.render(box.current, {
          sitekey: SITE_KEY,
          theme: 'auto',
          callback: (t) => setCaptcha(t),
          'expired-callback': () => setCaptcha(''),
          'error-callback': () => {
            setCaptcha('');
            setError('Human check failed to load. Reload the page.');
          },
        });
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
      if (widget.current !== null && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, []);

  async function submit(e) {
    e.preventDefault();
    if (SITE_KEY && !captcha) return;
    setBusy(true);
    setError('');
    try {
      const { token } = await login(username, password, captcha);
      setToken(token);
      onLogin();
    } catch (err) {
      setError(err.message);
      // A Turnstile token works once, so get a fresh one after any failed attempt.
      setCaptcha('');
      if (widget.current !== null && window.turnstile) window.turnstile.reset(widget.current);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login" onSubmit={submit}>
        <h1>SQL Practice</h1>
        <input placeholder="Username" value={username} autoFocus autoComplete="username"
          onChange={(e) => setUsername(e.target.value)} />
        <input placeholder="Password" type="password" value={password} autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)} />
        {SITE_KEY && <div className="ts" ref={box} />}
        {error && <div className="err">{error}</div>}
        <button className="primary" disabled={busy || (Boolean(SITE_KEY) && !captcha)}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
