let workspaceVersion = 0;
let saving = false;
let saveFailure = '';
const blankWorkspace = () => ({ transactions: [], invoices: [], budgets: [], openingBalance: 0, currency: 'USD' });
async function bootWorkspace(user) {
  const epoch = LedgerAuth.epoch;
  const data = await LedgerAuth.request('/api/workspace');
  if (epoch !== LedgerAuth.epoch) return;
  account = user; state = data.state; workspaceVersion = data.version;
  query = ''; typeFilter = 'all'; saveFailure = '';
  const initials = user.name.trim().split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase();
  document.querySelectorAll('[data-account-initials]').forEach(el => el.textContent = initials);
  document.querySelectorAll('[data-account-name]').forEach(el => el.textContent = user.name);
  document.querySelectorAll('[data-account-role]').forEach(el => el.textContent = user.role === 'admin' ? 'Administrator' : 'Member');
  page = ['dashboard', 'transactions', 'invoices', 'budgets', 'reports', 'settings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'dashboard';
  render();
  document.querySelector('.saved').innerHTML = '<i></i> Saved to your account';
}
function clearWorkspace() {
  account = null; state = blankWorkspace(); workspaceVersion = 0;
  saveFailure = ''; query = ''; typeFilter = 'all';
  document.getElementById('page').innerHTML = '';
  document.querySelectorAll('[data-account-name],[data-account-initials],[data-account-role]').forEach(el => el.textContent = '');
  document.getElementById('entry-form').reset();
  document.getElementById('account-form').reset();
  document.getElementById('form-fields').innerHTML = '';
  document.getElementById('account-fields').innerHTML = '';
  if (typeof importSession !== 'undefined') { importSession = null; importReadVersion++; importContent.innerHTML = ''; }
}
async function commitState(candidate) {
  if (!account) throw new Error('Sign in before saving.');
  if (saving) throw new Error('A save is already in progress. Please wait.');
  if (saveFailure) throw new Error('Reload your latest records before making another change.');
  const epoch = LedgerAuth.epoch;
  saving = true; document.body.classList.add('saving');
  document.querySelector('.saved').textContent = 'Saving…';
  try {
    const result = await LedgerAuth.request('/api/workspace', { method: 'PUT', body: JSON.stringify({ version: workspaceVersion, state: candidate }) });
    if (epoch !== LedgerAuth.epoch) throw new Error('The account changed during the save. Sign in again to view your records.');
    state = result.state; workspaceVersion = result.version;
    document.querySelector('.saved').innerHTML = '<i></i> Saved to your account';
  } catch (error) {
    if (epoch === LedgerAuth.epoch) {
      document.querySelector('.saved').textContent = 'Save not confirmed';
      if (error.status !== 400 && error.status !== 413) {
        saveFailure = error.message;
        const alert = document.getElementById('save-alert');
        if (alert) { alert.hidden = false; alert.querySelector('span').textContent = saveFailure; }
      }
    }
    throw error;
  } finally { saving = false; document.body.classList.remove('saving'); }
}
function workspaceSettings() {
  return heading('Workspace settings', 'Your private books, account, and access.') + `<div class="settings-stack"><section class="card account-settings"><h2>${esc(account.name)}’s account</h2><p>${esc(account.email)} · ${account.role === 'admin' ? 'Administrator' : 'Member'}<br>Your transactions, invoices, and budgets belong to your account. Other users have separate books.</p><button class="button" data-action="change-password">Change password</button><button class="button" data-action="reload-workspace">Reload latest records</button></section>
    ${account.role === 'admin' ? '<section class="card account-settings"><div class="account-section-head"><h2>Users and access</h2><button class="button primary" data-action="create-user">+ Create user</button></div><p>Administrators can create users, reset passwords, and disable access. Financial records stay private to each account.</p><div id="account-users"></div></section>' : ''}
    <section class="card account-settings"><h2>Your accounting records</h2><p>Records are saved on your accounting server. Sign in from another device to access the same books. Currency: ${esc(state.currency || 'USD')}.</p><button class="button" data-action="backup">${icon('download')} Download JSON backup</button><button class="button" data-action="restore-backup">Restore JSON backup</button><input type="file" id="restore-backup-file" accept=".json,application/json" hidden><button class="button" data-action="clear">Clear my accounting records</button>${account.role === 'admin' ? '<button class="button" data-action="migrate-local">Transfer old browser records</button><p>Transfer is optional and available only to the administrator, into empty books. The old browser copy is removed only after the server confirms it was saved.</p>' : ''}</section></div>`;
}
async function restoreWorkspace(candidate, source) {
  if (state.transactions.length || state.invoices.length || state.budgets.length || state.openingBalance) throw new Error('Restore into empty books only. Export a backup and clear your records first.');
  if (!candidate || !Array.isArray(candidate.transactions) || !Array.isArray(candidate.invoices) || !Array.isArray(candidate.budgets)) throw new Error('This is not a Ledger workspace backup.');
  if (!confirm(`Transfer ${candidate.transactions.length} transactions and ${candidate.invoices.length} invoices from ${source} into ${account.email}?`)) return false;
  await commitState(candidate); render(); return true;
}
document.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b || !account || saving) return;
  try {
    if (b.dataset.action === 'reload-workspace') { await bootWorkspace(account); toast('Latest records loaded.'); }
    if (b.dataset.action === 'restore-backup') document.getElementById('restore-backup-file').click();
    if (b.dataset.action === 'migrate-local' && account.role === 'admin') {
      const text = localStorage.getItem('ledger-v1');
      if (!text) { toast('No old records were found in this browser. You can restore a JSON backup instead.'); return; }
      if (await restoreWorkspace(JSON.parse(text), 'this browser')) { localStorage.removeItem('ledger-v1'); toast('Browser records transferred to your account.'); }
    }
  } catch (error) { toast(error.message); }
});
document.addEventListener('change', async e => {
  if (e.target.id !== 'restore-backup-file') return;
  const file = e.target.files[0]; if (!file) return;
  try {
    if (file.size > 14 * 1024 * 1024) throw new Error('Backup is too large. Maximum size is 14 MB.');
    const epoch = LedgerAuth.epoch;
    const backup = JSON.parse(await file.text());
    if (epoch !== LedgerAuth.epoch || !account) return;
    if (await restoreWorkspace(backup, 'the selected backup')) toast('Backup restored to your account.');
  } catch (error) { toast(error.message); }
  finally { e.target.value = ''; }
});
