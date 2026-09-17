const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const elements = new Map();
const listeners = {};
let serverState, serverVersion = 0, failSave = false;
const user = { id: 'test-user', name: 'Test User', email: 'test@example.test', role: 'member' };
function element(id) {
  if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', value: '', hidden: false, classList: { add() {}, remove() {}, toggle() {} }, addEventListener(type, fn) { listeners[id + ':' + type] = fn; }, showModal() {}, close() {}, reset() {}, querySelector: element });
  return elements.get(id);
}
const context = vm.createContext({ console, Date, Intl, JSON, Math, Number, String, Object, Array, structuredClone, crypto: require('node:crypto').webcrypto, document: { body: element('body'), querySelectorAll: () => [], querySelector: element, getElementById: element, addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); } }, window: { addEventListener() {} }, location: { hash: '' }, setTimeout: () => 1, clearTimeout() {}, confirm: () => true, FormData: class { constructor(target) { return Object.entries(target.values); } }, LedgerAuth: { user, epoch: 1, async request(url, options = {}) {
  assert.equal(url, '/api/workspace');
  if (options.method === 'PUT') {
    if (failSave) throw new Error('Test network failure');
    const data = JSON.parse(options.body); assert.equal(data.version, serverVersion);
    serverState = data.state; serverVersion++;
  }
  return { state: structuredClone(serverState), version: serverVersion };
} } });
vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('workspace-client.js', 'utf8'), context);
const run = script => vm.runInContext(script, context);
async function main() {
assert.equal(run('state.transactions.length'), 0);
assert.equal(element('page').innerHTML, '', 'records do not render before sign-in');
serverState = structuredClone(run('seed()'));
await run('bootWorkspace(LedgerAuth.user)');
assert.equal(run('total(current(), "income")'), 12450);
assert.equal(run('total(current(), "expense")'), 3199);
for (const name of ['dashboard', 'transactions', 'invoices', 'budgets', 'reports', 'settings']) {
  run(`go('${name}')`);
  assert.ok(element('page').innerHTML.length > 300, name + ' renders');
}
run('query="figma";typeFilter="expense"');
assert.equal(run('filteredTransactions().length'), 1);
await listeners['entry-form:submit']({ preventDefault() {}, target: { values: { name: 'Test expense', company: 'Test Co', amount: '25.50', date: run('localDate()'), category: 'Software', type: 'expense' } } });
assert.equal(run('total(current(), "expense")'), 3224.5);
assert.equal(serverVersion, 1);
assert.equal(serverState.transactions.at(-1).name, 'Test expense');
const before = run('state.transactions.length');
const pay = { dataset: { pay: 'INV-001' } };
await listeners.click[0]({ target: { closest: () => pay } });
await listeners.click[0]({ target: { closest: () => pay } });
assert.equal(run('state.transactions.length'), before + 1, 'paying twice does not duplicate income');
assert.equal(run('state.invoices[0].status'), 'paid');
assert.equal(run('total(current(), "income")'), 16700);
run('formMode="budget"');
await listeners['entry-form:submit']({ preventDefault() {}, target: { values: { name: 'Software', limit: '750' } } });
assert.equal(run('state.budgets.find(b=>b.name==="Software").limit'), 750);
assert.ok(run('esc("<script>")').includes('&lt;'));
const beforeFailure = run('state.budgets.find(b=>b.name==="Software").limit');
failSave = true;
await listeners['entry-form:submit']({ preventDefault() {}, target: { values: { name: 'Software', limit: '900' } } });
assert.equal(run('state.budgets.find(b=>b.name==="Software").limit'), beforeFailure);
assert.equal(element('save-alert').hidden, false);
failSave = false; await run('bootWorkspace(LedgerAuth.user)');
assert.equal(run('saveFailure'), '');
run('clearWorkspace()');
assert.equal(run('state.transactions.length'), 0);
assert.equal(element('page').innerHTML, '');
console.log('Passed: signed-in rendering, totals, search, server saves, invoice deduplication, budgets, failure rollback, reload, and sign-out data clearing.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
