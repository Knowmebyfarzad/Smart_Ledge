/* Authentication state is kept in memory; session credentials are HTTP-only cookies. */
window.LedgerAuth = (() => {
  let current = null, mode = 'login', busy = false, epoch = 0;
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ledger-session') : null;
  const gate = document.getElementById('auth-gate');
  const form = document.getElementById('auth-form');
  const errorBox = document.getElementById('auth-error');
  const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const input = (label, name, type, autocomplete, extra = '') => `<label class="field">${label}<input name="${name}" type="${type}" autocomplete="${autocomplete}" required ${extra}></label>`;
  function showGate(next = 'login', message = '') {
    mode = next;
    document.getElementById('app-shell').hidden = true;
    gate.hidden = false;
    const setup = next === 'setup', change = next === 'password';
    document.getElementById('auth-title').textContent = setup ? 'Create your administrator' : change ? 'Make this account yours' : 'Welcome back.';
    document.getElementById('auth-subtitle').textContent = setup ? 'Set up the owner account. Only someone with the server’s setup code can complete this step.' : change ? 'Replace your temporary password before opening your private workspace.' : 'Sign in to your private accounting workspace.';
    document.getElementById('auth-fields').innerHTML = (setup ? input('One-time setup code', 'setupCode', 'password', 'off') + '<p class="auth-hint">On the server, open <code>.data/setup-code.txt</code>. The code works only for initial setup.</p>' + input('Your name', 'name', 'text', 'name', 'maxlength="100"') : '') +
      (change ? input('Current / temporary password', 'currentPassword', 'password', 'current-password', 'maxlength="128"') : input('Email address', 'email', 'email', 'username', 'maxlength="254"')) +
      input(change ? 'New password' : 'Password', 'password', 'password', setup || change ? 'new-password' : 'current-password', `${setup || change ? 'minlength="12"' : ''} maxlength="128"`) +
      (setup || change ? input('Confirm password', 'confirmPassword', 'password', 'new-password', 'minlength="12" maxlength="128"') + '<p class="auth-hint">Use 12–128 characters. A long, unique passphrase works well.</p>' : '');
    document.getElementById('auth-submit').textContent = setup ? 'Create administrator →' : change ? 'Save password →' : 'Sign in →';
    document.getElementById('auth-help').textContent = setup ? 'New users can be added in Settings after setup.' : change ? 'Your other sessions will be signed out.' : 'Need an account or password reset? Contact your administrator.';
    document.getElementById('auth-signout').hidden = !change;
    errorBox.textContent = message;
  }
  function lock(message = '') {
    epoch++; current = null;
    if (typeof clearWorkspace === 'function') clearWorkspace();
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    showGate('login', message);
  }
  async function request(url, options = {}) {
    const session = current;
    const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(session ? { 'X-Ledger-User': session.user.id, 'X-CSRF-Token': session.csrfToken } : {}), ...options.headers };
    let response;
    try { response = await fetch(url, { ...options, headers, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(30000) }); }
    catch { throw new Error('The server could not be reached. Check your connection, then reload records before retrying a save.'); }
    const data = await response.json().catch(() => ({ error: 'Unexpected server response.' }));
    if (!response.ok) {
      if (session && session === current && ['SESSION_EXPIRED', 'ACCOUNT_CHANGED', 'SESSION_CHANGED'].includes(data.code)) lock(data.error);
      const error = new Error(data.error || 'Request failed.'); error.code = data.code; error.status = response.status; throw error;
    }
    return data;
  }
  async function accept(session, announce = false) {
    current = session; epoch++;
    const acceptedEpoch = epoch;
    document.getElementById('app-shell').hidden = true;
    clearWorkspace();
    if (announce) channel?.postMessage('changed');
    if (session.user.mustChangePassword) { showGate('password'); return; }
    await bootWorkspace(session.user);
    if (acceptedEpoch !== epoch) return;
    gate.hidden = true; document.getElementById('app-shell').hidden = false;
    form.reset(); errorBox.textContent = '';
  }
  async function bootstrap() {
    if (busy || (typeof saving !== 'undefined' && saving)) return;
    busy = true;
    document.getElementById('auth-submit').disabled = true;
    try {
      const session = await request('/api/session');
      if (session.user) await accept(session);
      else { current = null; epoch++; clearWorkspace(); showGate(session.needsSetup ? 'setup' : 'login'); }
    } catch (e) { showGate('login', e.message); }
    finally { busy = false; document.getElementById('auth-submit').disabled = false; }
  }
  async function logout() {
    if (busy || (typeof saving !== 'undefined' && saving)) return;
    busy = true;
    try { if (current) await request('/api/logout', { method: 'POST', body: '{}' }); lock(); channel?.postMessage('changed'); }
    catch (e) { if (gate.hidden) toast(e.message); else errorBox.textContent = e.message; }
    finally { busy = false; }
  }
  form.addEventListener('submit', async e => {
    e.preventDefault(); if (busy) return;
    const data = Object.fromEntries(new FormData(form));
    if (mode !== 'login' && data.password !== data.confirmPassword) { errorBox.textContent = 'Passwords do not match.'; return; }
    busy = true; document.getElementById('auth-submit').disabled = true; errorBox.textContent = '';
    try {
      const response = await request(mode === 'setup' ? '/api/setup' : mode === 'password' ? '/api/password' : '/api/login', { method: 'POST', body: JSON.stringify(data) });
      await accept(response, true);
    } catch (error) { errorBox.textContent = error.message; }
    finally { busy = false; document.getElementById('auth-submit').disabled = false; }
  });
  document.getElementById('auth-signout').addEventListener('click', logout);
  document.getElementById('signout').addEventListener('click', logout);
  document.getElementById('auth-retry').addEventListener('click', bootstrap);
  channel?.addEventListener('message', () => { if (current) lock('The account session changed in another tab. Sign in to continue.'); });
  async function checkSession() {
    if (!current || document.hidden || busy) return;
    const id = current.user.id;
    try { const data = await request('/api/session'); if (current?.user.id === id && (data.user?.id !== id || data.csrfToken !== current.csrfToken)) lock('Your session changed. Please sign in again.'); } catch { /* A temporary disconnect does not discard a form. */ }
  }
  document.addEventListener('visibilitychange', checkSession);
  setInterval(checkSession, 60000);
  document.addEventListener('DOMContentLoaded', bootstrap);
  return { request, logout, bootstrap, lock, accept, get user() { return current?.user || null; }, get epoch() { return epoch; }, escape };
})();

let accountActionBusy = false;
async function loadUsers() {
  const host = document.getElementById('account-users');
  if (!host || LedgerAuth.user?.role !== 'admin') return;
  host.textContent = 'Loading users…';
  try {
    const { users } = await LedgerAuth.request('/api/users');
    if (!host.isConnected) return;
    host.innerHTML = `<div class="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody>${users.map(u => `<tr><td><strong>${esc(u.name)}</strong><small class="transaction-time">${esc(u.email)}</small></td><td>${esc(u.role)}</td><td><span class="status ${u.disabled ? 'pending' : ''}">${u.disabled ? 'Disabled' : u.mustChangePassword ? 'Password change required' : 'Active'}</span></td><td>${u.id === LedgerAuth.user.id ? 'You' : `<button class="button" data-account-toggle="${esc(u.id)}" data-disabled="${!u.disabled}">${u.disabled ? 'Enable' : 'Disable'}</button> <button class="text-link" data-account-reset="${esc(u.id)}">Reset password</button>`}</td></tr>`).join('')}</tbody></table></div>`;
  } catch (e) { host.textContent = e.message; }
}
function openAccountForm(mode, id = '') {
  const dialog = document.getElementById('account-dialog');
  dialog.dataset.mode = mode; dialog.dataset.userId = id;
  document.getElementById('account-form').reset();
  document.getElementById('account-error').textContent = '';
  document.getElementById('account-title').textContent = mode === 'create' ? 'Create a user' : mode === 'reset' ? 'Reset user password' : 'Change your password';
  const passwordField = (label, name, auto) => `<label class="field">${label}<input type="password" name="${name}" autocomplete="${auto}" minlength="12" maxlength="128" required></label>`;
  document.getElementById('account-fields').innerHTML = (mode === 'create' ? '<label class="field">Name<input name="name" autocomplete="off" maxlength="100" required></label><label class="field">Email<input name="email" type="email" autocomplete="off" maxlength="254" required></label><label class="field">Role<select name="role"><option value="member">Member — own private books</option><option value="admin">Administrator — can also manage users</option></select></label>' : '') +
    (mode === 'password' ? passwordField('Current password', 'currentPassword', 'current-password') : '') +
    passwordField(mode === 'password' ? 'New password' : 'Temporary password', 'password', 'new-password') + passwordField('Confirm password', 'confirmPassword', 'new-password') +
    `<p class="auth-hint">${mode === 'password' ? 'Your other sessions will be signed out.' : 'Share the temporary password privately. The user must change it at first sign-in. No email is sent.'}</p>`;
  dialog.showModal();
}
document.getElementById('account-form').addEventListener('submit', async e => {
  e.preventDefault(); if (accountActionBusy) return;
  const form = e.target, data = Object.fromEntries(new FormData(form)), dialog = document.getElementById('account-dialog');
  const errorBox = document.getElementById('account-error'); errorBox.textContent = '';
  if (data.password !== data.confirmPassword) { errorBox.textContent = 'Passwords do not match.'; return; }
  accountActionBusy = true; document.getElementById('account-submit').disabled = true;
  try {
    const mode = dialog.dataset.mode;
    const url = mode === 'create' ? '/api/users' : mode === 'password' ? '/api/password' : `/api/users/${dialog.dataset.userId}/reset-password`;
    const response = await LedgerAuth.request(url, { method: 'POST', body: JSON.stringify(data) });
    if (mode === 'password') await LedgerAuth.accept(response, true);
    dialog.close(); form.reset(); if (mode !== 'password') await loadUsers();
    toast(mode === 'create' ? 'User created. Share the temporary password privately.' : 'Password updated.');
  } catch (e) { errorBox.textContent = e.message; }
  finally { accountActionBusy = false; document.getElementById('account-submit').disabled = false; }
});
document.getElementById('close-account').addEventListener('click', () => { if (!accountActionBusy) document.getElementById('account-dialog').close(); });
document.getElementById('account-dialog').addEventListener('cancel', e => { if (accountActionBusy) e.preventDefault(); });
document.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b || !LedgerAuth.user || accountActionBusy || saving) return;
  if (b.dataset.action === 'create-user') openAccountForm('create');
  if (b.dataset.action === 'change-password') openAccountForm('password');
  if (b.dataset.accountReset) openAccountForm('reset', b.dataset.accountReset);
  if (b.dataset.accountToggle && confirm(`${b.dataset.disabled === 'true' ? 'Disable this user and end their active sessions' : 'Enable this user'}?`)) {
    accountActionBusy = true;
    try { await LedgerAuth.request(`/api/users/${b.dataset.accountToggle}`, { method: 'POST', body: JSON.stringify({ disabled: b.dataset.disabled === 'true' }) }); await loadUsers(); }
    catch (e) { toast(e.message); } finally { accountActionBusy = false; }
  }
});
