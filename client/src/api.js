const KEY = 'sqlpractice_token';

export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t) => localStorage.setItem(KEY, t);
export const clearToken = () => localStorage.removeItem(KEY);

const authHeader = () => (getToken() ? { Authorization: `Bearer ${getToken()}` } : {});

async function failIfBad(res) {
  if (res.ok) return;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    clearToken();
    window.location.reload();
  }
  throw new Error(data.error || `Request failed (${res.status})`);
}

// Downloads a file from the API (used for zip exports).
export async function download(path, fallbackName) {
  const res = await fetch(`/api${path}`, { headers: authHeader() });
  await failIfBad(res);
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

// Uploads a file as raw bytes (used for imports).
export async function upload(path, file) {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', ...authHeader() },
    body: file,
  });
  await failIfBad(res);
  return res.json();
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') {
    clearToken();
    window.location.reload();
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const login = (username, password, turnstileToken) =>
  api('/login', { method: 'POST', body: { username, password, turnstileToken } });
