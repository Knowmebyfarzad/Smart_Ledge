'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { DatabaseSync } = require('node:sqlite');
const { emptyWorkspace, validateWorkspace } = require('./workspace-store.js');
const scrypt = promisify(crypto.scrypt);
const SESSION_MS = 12 * 60 * 60 * 1000;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
function fail(status, message, code) { const e = new Error(message); e.status = status; e.code = code; throw e; }
function validateIdentity(data) {
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  if (!name || name.length > 100) fail(400, 'Enter a name of 1–100 characters.');
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email address.');
  validatePassword(data.password); return { name, email };
}
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) fail(400, 'Use a password of 12–128 characters. Spaces and Persian characters are allowed.');
}
let hashing = 0;
async function derive(password, salt) {
  if (hashing >= 2) fail(429, 'The sign-in service is busy. Try again shortly.');
  hashing++;
  try { return await scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }); } finally { hashing--; }
}
async function passwordHash(password) { const salt = crypto.randomBytes(16).toString('hex'); return `scrypt:${salt}:${(await derive(password, salt)).toString('hex')}`; }
async function passwordMatches(password, stored) {
  const [, salt, expected] = (stored || 'scrypt:00000000000000000000000000000000:' + '0'.repeat(128)).split(':');
  return equal((await derive(password, salt)).toString('hex'), expected);
}
function createAuth({ port }) {
  const dataDir = path.resolve(process.env.LEDGER_DATA_DIR || path.join(__dirname, '.data'));
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(dataDir, 'ledger.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','member')), disabled INTEGER NOT NULL DEFAULT 0, must_change INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS workspaces (user_id TEXT PRIMARY KEY REFERENCES users(id), data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);`);
  const q = sql => db.prepare(sql);
  const setupPath = path.join(dataDir, 'setup-code.txt');
  const hasUsers = () => q('SELECT COUNT(*) AS n FROM users').get().n > 0;
  if (!hasUsers() && !fs.existsSync(setupPath)) fs.writeFileSync(setupPath, crypto.randomBytes(24).toString('hex') + '\n', { flag: 'wx', mode: 0o600 });
  const publicOrigin = process.env.PUBLIC_ORIGIN ? new URL(process.env.PUBLIC_ORIGIN).origin : '';
  if (publicOrigin && !publicOrigin.startsWith('https://')) throw new Error('PUBLIC_ORIGIN must use HTTPS. Leave it unset for local HTTP development.');
  const secure = Boolean(publicOrigin);
  const origins = new Set(publicOrigin ? [publicOrigin] : [`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
  const hosts = new Set([...origins].map(o => new URL(o).host));
  hosts.add(`127.0.0.1:${port}`); hosts.add(`localhost:${port}`);
  const cookieName = secure ? '__Host-ledger_session' : 'ledger_session';
  const cookie = (token, maxAge = SESSION_MS / 1000) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  function json(res, status, value, headers = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers }); res.end(JSON.stringify(value)); }
  function atomic(fn) { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } }
  function throttle(key, limit) {
    const now = Date.now(); q('DELETE FROM attempts WHERE expires_at < ?').run(now);
    const old = q('SELECT * FROM attempts WHERE key=?').get(key);
    if (old && old.count >= limit) fail(429, 'Too many attempts. Try again in 15 minutes.');
    q('INSERT INTO attempts(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key, now + 15 * 60 * 1000);
  }
  async function body(req, limit = 16384) {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) fail(415, 'Send JSON data.');
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > limit) fail(413, 'Request is too large. Use a smaller import.'); chunks.push(chunk); }
    try { const data = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); return data; } catch { fail(400, 'Invalid JSON request.'); }
  }
  function publicUser(u) { return { id: u.id, name: u.name, email: u.email, role: u.role, disabled: Boolean(u.disabled), mustChangePassword: Boolean(u.must_change), createdAt: u.created_at }; }
  function session(req) {
    const token = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    q('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    return q('SELECT sessions.csrf, sessions.token_hash, users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND users.disabled=0').get(hash(token)) || null;
  }
  function createSession(user, req) {
    const old = session(req); if (old) q('DELETE FROM sessions WHERE token_hash=?').run(old.token_hash);
    const token = crypto.randomBytes(32).toString('hex'), csrf = crypto.randomBytes(32).toString('hex');
    q('INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES (?,?,?,?)').run(hash(token), user.id, csrf, Date.now() + SESSION_MS);
    return { token, payload: { user: publicUser(user), csrfToken: csrf } };
  }
  function requireUser(req, allowPasswordChange = false) {
    const u = session(req); if (!u) fail(401, 'Your session has expired. Please sign in again.', 'SESSION_EXPIRED');
    if (req.headers['x-ledger-user'] !== u.id) fail(409, 'The signed-in account changed in another tab. Please sign in again.', 'ACCOUNT_CHANGED');
    if (!['GET', 'HEAD'].includes(req.method) && !equal(req.headers['x-csrf-token'], u.csrf)) fail(403, 'Your session changed. Please sign in again.', 'SESSION_CHANGED');
    if (u.must_change && !allowPasswordChange) fail(403, 'Change your temporary password first.', 'PASSWORD_CHANGE_REQUIRED');
    return u;
  }
  function addUser({ name, email, password, role, mustChange }) {
    const id = crypto.randomUUID();
    if (q('SELECT id FROM users WHERE email=?').get(email)) fail(409, 'An account already uses that email.');
    q('INSERT INTO users(id,email,name,password_hash,role,must_change,created_at) VALUES (?,?,?,?,?,?,?)').run(id, email, name, password, role, mustChange ? 1 : 0, Date.now());
    q('INSERT INTO workspaces(user_id,data,version) VALUES (?,?,0)').run(id, JSON.stringify(emptyWorkspace()));
    return q('SELECT * FROM users WHERE id=?').get(id);
  }
  async function handle(req, res, pathname) {
    try {
      if (!hosts.has(req.headers.host)) fail(403, 'This domain is not configured. Set PUBLIC_ORIGIN on the server.');
      if (!['GET', 'HEAD'].includes(req.method)) {
        if (!origins.has(req.headers.origin)) fail(403, 'Request origin is not allowed. Check PUBLIC_ORIGIN.');
        if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Cross-site requests are not allowed.');
      }
      if (pathname === '/api/session' && req.method === 'GET') {
        const u = session(req); return json(res, 200, { needsSetup: !hasUsers(), user: u ? publicUser(u) : null, csrfToken: u?.csrf || null });
      }
      if (pathname === '/api/setup' && req.method === 'POST') {
        if (hasUsers()) fail(409, 'Initial setup is already complete. Sign in instead.');
        throttle('setup:' + req.socket.remoteAddress, 10);
        const data = await body(req), expected = fs.readFileSync(setupPath, 'utf8').trim();
        if (!equal(data.setupCode, expected)) fail(403, 'The setup code is incorrect. Read .data/setup-code.txt on the server.');
        const identity = validateIdentity(data), password = await passwordHash(data.password);
        const user = atomic(() => { if (hasUsers()) fail(409, 'Setup is already complete.'); return addUser({ ...identity, password, role: 'admin', mustChange: false }); });
        fs.writeFileSync(setupPath, 'Setup completed. This code is no longer valid.\n', { mode: 0o600 });
        const s = createSession(user, req); return json(res, 201, s.payload, { 'Set-Cookie': cookie(s.token) });
      }
      if (pathname === '/api/login' && req.method === 'POST') {
        const data = await body(req), email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
        if (!email || email.length > 254 || typeof data.password !== 'string' || data.password.length > 128) fail(400, 'Enter your email and password.');
        throttle('connection:' + req.socket.remoteAddress, 200);
        const attemptKey = 'login:' + hash(email); throttle(attemptKey, 8);
        const user = q('SELECT * FROM users WHERE email=?').get(email);
        const matches = await passwordMatches(data.password, user?.password_hash);
        const latest = user && q('SELECT * FROM users WHERE id=?').get(user.id);
        if (!matches || !latest || latest.disabled || latest.password_hash !== user.password_hash) fail(401, 'Email or password is incorrect.');
        q('DELETE FROM attempts WHERE key=?').run(attemptKey);
        const s = createSession(latest, req); return json(res, 200, s.payload, { 'Set-Cookie': cookie(s.token) });
      }
      const user = requireUser(req, pathname === '/api/logout' || pathname === '/api/password');
      if (pathname === '/api/logout' && req.method === 'POST') {
        q('DELETE FROM sessions WHERE token_hash=?').run(user.token_hash); return json(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
      }
      if (pathname === '/api/password' && req.method === 'POST') {
        throttle('password:' + user.id, 8);
        const data = await body(req); validatePassword(data.password);
        if (typeof data.currentPassword !== 'string' || data.currentPassword.length > 128 || !await passwordMatches(data.currentPassword, user.password_hash)) fail(400, 'Current password is incorrect.');
        if (data.password === data.currentPassword) fail(400, 'Choose a different password.');
        const password = await passwordHash(data.password); requireUser(req, true);
        const changed = q('UPDATE users SET password_hash=?,must_change=0 WHERE id=? AND password_hash=?').run(password, user.id, user.password_hash);
        if (!changed.changes) fail(409, 'The account changed. Sign in again.');
        q('DELETE FROM sessions WHERE user_id=?').run(user.id);
        const updated = q('SELECT * FROM users WHERE id=?').get(user.id), s = createSession(updated, req);
        return json(res, 200, s.payload, { 'Set-Cookie': cookie(s.token) });
      }
      if (pathname === '/api/workspace' && req.method === 'GET') {
        const row = q('SELECT data,version FROM workspaces WHERE user_id=?').get(user.id);
        return json(res, 200, { state: JSON.parse(row.data), version: row.version });
      }
      if (pathname === '/api/workspace' && req.method === 'PUT') {
        const data = await body(req, 15 * 1024 * 1024); requireUser(req);
        if (!Number.isSafeInteger(data.version) || data.version < 0) fail(400, 'A valid workspace version is required.');
        const workspace = validateWorkspace(data.state);
        const change = q('UPDATE workspaces SET data=?,version=version+1 WHERE user_id=? AND version=?').run(JSON.stringify(workspace), user.id, data.version);
        if (!change.changes) fail(409, 'Your records changed in another tab or device. Reload the latest records before trying again.', 'VERSION_CONFLICT');
        return json(res, 200, { state: workspace, version: data.version + 1 });
      }
      if (pathname === '/api/users' || pathname.startsWith('/api/users/')) {
        if (user.role !== 'admin') fail(403, 'Only administrators can manage users.');
        if (pathname === '/api/users' && req.method === 'GET') return json(res, 200, { users: q('SELECT * FROM users ORDER BY created_at').all().map(publicUser) });
        if (pathname === '/api/users' && req.method === 'POST') {
          throttle('create-user:' + user.id, 30);
          const data = await body(req), identity = validateIdentity(data);
          if (!['admin', 'member'].includes(data.role)) fail(400, 'Choose administrator or member.');
          const password = await passwordHash(data.password); requireUser(req);
          const added = atomic(() => addUser({ ...identity, password, role: data.role, mustChange: true }));
          return json(res, 201, { user: publicUser(added) });
        }
        const match = pathname.match(/^\/api\/users\/([a-f0-9-]+)(?:\/(reset-password))?$/);
        if (match && req.method === 'POST') {
          const data = await body(req); requireUser(req);
          const target = q('SELECT * FROM users WHERE id=?').get(match[1]);
          if (!target) fail(404, 'User not found.');
          if (target.id === user.id) fail(400, 'Use Change password for your own account. You cannot disable yourself.');
          if (match[2]) {
            throttle('reset:' + user.id, 30); validatePassword(data.password);
            const password = await passwordHash(data.password); requireUser(req);
            q('UPDATE users SET password_hash=?,must_change=1 WHERE id=?').run(password, target.id);
          } else {
            if (typeof data.disabled !== 'boolean') fail(400, 'Choose enabled or disabled.');
            q('UPDATE users SET disabled=? WHERE id=?').run(data.disabled ? 1 : 0, target.id);
          }
          q('DELETE FROM sessions WHERE user_id=?').run(target.id); return json(res, 200, { ok: true });
        }
      }
      fail(404, 'Endpoint not found.');
    } catch (e) {
      if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : 'The server could not complete this request.', code: e.code || null }, e.status === 429 ? { 'Retry-After': '900' } : {});
      if (!e.status) console.error('API error:', e.message);
    }
  }
  return { handle, dataDir, needsSetup: !hasUsers(), secure, close: () => db.close() };
}
module.exports = { createAuth };
