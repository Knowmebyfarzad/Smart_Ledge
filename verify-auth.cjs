const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { DatabaseSync } = require('node:sqlite');
const { emptyWorkspace } = require('./workspace-store.js');
const running = new Set();
async function start(dataDir, publicOrigin = '') {
  const reservation = net.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['server.js'], { cwd: __dirname, env: { ...process.env, PORT: String(port), LEDGER_DATA_DIR: dataDir, PUBLIC_ORIGIN: publicOrigin }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  running.add(child);
  let output = ''; child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (output.includes('Ledger is ready')) return { child, port, origin: publicOrigin || `http://127.0.0.1:${port}`, url: `http://127.0.0.1:${port}` };
    if (child.exitCode !== null) throw new Error(output);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Server did not start: ' + output);
}
async function stop(server) {
  const exited = once(server.child, 'exit'); server.child.kill(); await exited; running.delete(server.child);
}
function client(server) {
  return { cookie: '', user: null, csrf: '', async request(route, method = 'GET', data, overrides = {}) {
    const headers = { Origin: server.origin, ...(this.cookie ? { Cookie: this.cookie } : {}), ...(this.user ? { 'X-Ledger-User': this.user.id, 'X-CSRF-Token': this.csrf } : {}), ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...overrides };
    const response = await fetch(server.url + route, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) });
    const result = await response.json().catch(() => null);
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    if (response.ok && result?.user && result.csrfToken) { this.user = result.user; this.csrf = result.csrfToken; }
    return { status: response.status, data: result, headers: response.headers };
  } };
}
async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-auth-test-'));
  let server = await start(dataDir);
  const admin = client(server), member = client(server), outsider = client(server);
  assert.equal((await outsider.request('/api/session')).data.needsSetup, true);
  assert.equal((await outsider.request('/api/workspace')).status, 401);
  assert.equal((await outsider.request('/api/users')).status, 401);
  for (const route of ['/.data/setup-code.txt', '/.data/ledger.sqlite', '/auth-server.js', '/.env']) assert.equal((await fetch(server.url + route)).status, 404);
  const setupCode = fs.readFileSync(path.join(dataDir, 'setup-code.txt'), 'utf8').trim();
  const owner = { setupCode, name: 'Test owner', email: 'Owner@example.test', password: 'Owner-test-password-2026' };
  assert.equal((await admin.request('/api/setup', 'POST', { ...owner, setupCode: 'wrong' })).status, 403);
  assert.equal((await admin.request('/api/setup', 'POST', { ...owner, password: 'short' })).status, 400);
  const setup = await admin.request('/api/setup', 'POST', owner);
  assert.equal(setup.status, 201); assert.equal(admin.user.role, 'admin');
  assert.match(setup.headers.get('set-cookie'), /HttpOnly/); assert.match(setup.headers.get('set-cookie'), /SameSite=Strict/);
  assert.equal((await outsider.request('/api/setup', 'POST', owner)).status, 409);
  assert.equal((await admin.request('/api/workspace')).data.state.transactions.length, 0);
  const profile = { name: 'Second user', email: 'member@example.test', password: 'Temporary-password-2026', role: 'member' };
  assert.equal((await admin.request('/api/users', 'POST', profile, { Origin: 'https://attacker.invalid' })).status, 403);
  assert.equal((await admin.request('/api/users', 'POST', profile, { 'X-CSRF-Token': 'wrong' })).status, 403);
  assert.equal((await admin.request('/api/users', 'POST', { ...profile, role: 'superadmin' })).status, 400);
  const created = await admin.request('/api/users', 'POST', profile); assert.equal(created.status, 201);
  assert.equal(created.data.user.mustChangePassword, true); assert.equal(created.data.user.password_hash, undefined);
  assert.equal((await admin.request('/api/users', 'POST', profile)).status, 409);
  assert.equal((await member.request('/api/login', 'POST', { email: profile.email, password: 'wrong' })).status, 401);
  const nonexistent = await outsider.request('/api/login', 'POST', { email: 'missing@example.test', password: 'wrong' });
  assert.equal(nonexistent.status, 401); assert.equal(nonexistent.data.error, 'Email or password is incorrect.');
  assert.equal((await member.request('/api/login', 'POST', profile)).status, 200);
  assert.equal((await member.request('/api/workspace')).data.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await member.request('/api/password', 'POST', { currentPassword: profile.password, password: 'Member-private-password-2026' })).status, 200);
  assert.equal(member.user.mustChangePassword, false);
  assert.equal((await member.request('/api/users')).status, 403);
  assert.equal((await member.request('/api/users', 'POST', { ...profile, email: 'elevated@example.test', role: 'admin' })).status, 403);
  const record = { id: 'private-admin-record', name: 'پرداخت فاکتور', company: 'علی رضایی', amount: 125000, date: '2026-09-16', time: '14:35:20', referenceCode: '000123456789', bank: 'بانک ملت', type: 'expense', category: 'Other', currency: 'IRR' };
  const books = { ...emptyWorkspace(), currency: 'IRR', transactions: [record] };
  const saved = await admin.request('/api/workspace', 'PUT', { version: 0, state: books });
  assert.equal(saved.status, 200); assert.equal(saved.data.version, 1);
  assert.equal((await member.request('/api/workspace')).data.state.transactions.length, 0);
  assert.equal((await member.request('/api/workspace?userId=' + admin.user.id)).data.state.transactions.length, 0);
  assert.equal((await member.request('/api/workspace', 'GET', undefined, { 'X-Ledger-User': admin.user.id })).data.code, 'ACCOUNT_CHANGED');
  assert.equal((await admin.request('/api/workspace', 'PUT', { version: 0, state: books })).data.code, 'VERSION_CONFLICT');
  for (const invalid of [{ amount: 12.345 }, { date: '2026-02-30' }, { type: 'anything' }, { currency: 'USD' }, { referenceCode: 123 }]) {
    assert.equal((await admin.request('/api/workspace', 'PUT', { version: 1, state: { ...books, transactions: [{ ...record, ...invalid }] } })).status, 400);
  }
  assert.equal((await admin.request('/api/workspace')).data.version, 1);
  const concurrent = await Promise.all([admin.request('/api/workspace', 'PUT', { version: 1, state: books }), admin.request('/api/workspace', 'PUT', { version: 1, state: books })]);
  assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 409]);
  const adminId = admin.user.id, memberId = member.user.id;
  assert.equal((await admin.request('/api/users/' + adminId, 'POST', { disabled: true })).status, 400);
  assert.equal((await admin.request('/api/users/' + memberId, 'POST', { disabled: true })).status, 200);
  assert.equal((await member.request('/api/workspace')).status, 401);
  assert.equal((await member.request('/api/login', 'POST', { email: profile.email, password: 'Member-private-password-2026' })).status, 401);
  assert.equal((await admin.request('/api/users/' + memberId, 'POST', { disabled: false })).status, 200);
  assert.equal((await admin.request('/api/users/' + memberId + '/reset-password', 'POST', { password: 'Reset-temporary-password-2026' })).status, 200);
  assert.equal((await member.request('/api/login', 'POST', { email: profile.email, password: 'Member-private-password-2026' })).status, 401);
  assert.equal((await member.request('/api/login', 'POST', { email: profile.email, password: 'Reset-temporary-password-2026' })).status, 200);
  assert.equal(member.user.mustChangePassword, true);
  assert.equal((await member.request('/api/password', 'POST', { currentPassword: 'Reset-temporary-password-2026', password: 'New-member-password-2026' })).status, 200);
  const otherDevice = client(server);
  assert.equal((await otherDevice.request('/api/login', 'POST', { email: profile.email, password: 'New-member-password-2026' })).status, 200);
  assert.equal((await member.request('/api/password', 'POST', { currentPassword: 'New-member-password-2026', password: 'Final-member-password-2026' })).status, 200);
  assert.equal((await otherDevice.request('/api/workspace')).status, 401);
  const cookieBeforeLogout = member.cookie;
  assert.equal((await member.request('/api/logout', 'POST', {})).status, 200);
  member.cookie = cookieBeforeLogout;
  assert.equal((await member.request('/api/workspace')).status, 401);
  for (let attempt = 0; attempt < 8; attempt++) assert.equal((await outsider.request('/api/login', 'POST', { email: 'limited@example.test', password: 'wrong' })).status, 401);
  assert.equal((await outsider.request('/api/login', 'POST', { email: 'limited@example.test', password: 'wrong' })).status, 429);
  const adminSession = { cookie: admin.cookie, user: admin.user, csrf: admin.csrf };
  await stop(server);
  server = await start(dataDir);
  const afterRestart = client(server); Object.assign(afterRestart, adminSession);
  const restored = await afterRestart.request('/api/workspace');
  assert.equal(restored.status, 200); assert.equal(restored.data.state.transactions[0].referenceCode, '000123456789');
  const inspection = new DatabaseSync(path.join(dataDir, 'ledger.sqlite'), { readOnly: true });
  const ownerRow = inspection.prepare('SELECT password_hash FROM users WHERE id=?').get(adminId);
  assert.match(ownerRow.password_hash, /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/);
  assert.ok(!ownerRow.password_hash.includes(owner.password));
  const storedSession = inspection.prepare('SELECT token_hash FROM sessions WHERE user_id=?').get(adminId);
  assert.notEqual(storedSession.token_hash, adminSession.cookie.split('=')[1]); inspection.close();
  await stop(server);
  const secureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-https-test-'));
  const secureServer = await start(secureDir, 'https://accounts.example.test');
  const secureClient = client(secureServer);
  const secureCode = fs.readFileSync(path.join(secureDir, 'setup-code.txt'), 'utf8').trim();
  const secureSetup = await secureClient.request('/api/setup', 'POST', { ...owner, setupCode: secureCode });
  assert.equal(secureSetup.status, 201);
  assert.match(secureSetup.headers.get('set-cookie'), /^__Host-ledger_session=/);
  assert.match(secureSetup.headers.get('set-cookie'), /; Secure/);
  assert.match(secureSetup.headers.get('strict-transport-security'), /max-age=/);
  assert.equal((await secureClient.request('/api/logout', 'POST', {}, { Origin: 'http://localhost:' + secureServer.port })).status, 403);
  await stop(secureServer);
  console.log('Passed: setup, login, private workspaces, CSRF/origin checks, roles, temporary passwords, resets, disable/re-enable, logout, session revocation, validation, concurrent saves, restart persistence, rate limits, password hashing, and HTTPS cookies.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { for (const child of running) child.kill(); });
