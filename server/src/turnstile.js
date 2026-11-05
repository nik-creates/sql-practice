// Cloudflare Turnstile verification for the login form.
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Returns { ok: true } or { ok: false, status, error }.
 * - TURNSTILE_SECRET unset and NODE_ENV=production: fail closed (login unavailable).
 * - TURNSTILE_SECRET unset and NODE_ENV not production: skipped, for local development.
 */
export async function verifyTurnstile(token, remoteIp) {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('TURNSTILE_SECRET is not set; refusing logins');
      return { ok: false, status: 503, error: 'Login is unavailable: human check is not configured' };
    }
    return { ok: true, skipped: true };
  }
  if (typeof token !== 'string' || !token || token.length > 2048) {
    return { ok: false, status: 400, error: 'Complete the human check first' };
  }
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);
    const res = await fetch(VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    if (data.success === true) return { ok: true };
    console.warn('turnstile rejected:', (data['error-codes'] || []).join(',') || 'no error codes');
    return { ok: false, status: 400, error: 'Human check failed. Try again.' };
  } catch (e) {
    console.error('turnstile verify:', e.message);
    return { ok: false, status: 503, error: 'Could not verify the human check. Try again.' };
  }
}

export const turnstileSkipped = () => !process.env.TURNSTILE_SECRET && process.env.NODE_ENV !== 'production';
