import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const secret = process.env.JWT_SECRET;
if (!secret) throw new Error('JWT_SECRET is required');

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function checkCredentials(username, password) {
  const user = process.env.APP_USER;
  const hash = process.env.APP_PASS_HASH;
  if (!user || !hash) return false; // fail closed when not configured
  const userOk = safeEqual(username ?? '', user);
  const passOk = bcrypt.compareSync(String(password ?? ''), hash);
  return userOk && passOk;
}

export const signToken = (username) => jwt.sign({ sub: username }, secret, { expiresIn: '7d' });

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, secret);
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}
