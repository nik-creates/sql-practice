import { useState } from 'react';
import { api, setToken } from './api.js';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { token } = await api('/login', { method: 'POST', body: { username, password } });
      setToken(token);
      onLogin();
    } catch (err) {
      setError(err.message);
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
        {error && <div className="err">{error}</div>}
        <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
