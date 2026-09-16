const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const elements = new Map();
const listeners = {};
const storage = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', value: '', classList: { add() {}, remove() {}, toggle() {} }, addEventListener(type, fn) { listeners[id + ':' + type] = fn; }, showModal() {}, close() {} });
  return elements.get(id);
}
const context = vm.createContext({ console, Date, Intl, JSON, Math, Number, String, Object, Array, crypto: require('node:crypto').webcrypto, localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) }, document: { querySelectorAll: () => [], querySelector: element, getElementById: element, addEventListener: (type, fn) => listeners[type] = fn }, window: { addEventListener() {} }, location: { hash: '' }, setTimeout: () => 1, clearTimeout() {}, confirm: () => true, FormData: class { constructor(target) { return Object.entries(target.values); } } });
vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
const run = script => vm.runInContext(script, context);
assert.equal(run('total(current(), "income")'), 12450);
assert.equal(run('total(current(), "expense")'), 3199);
for (const name of ['dashboard', 'transactions', 'invoices', 'budgets', 'reports', 'settings']) {
  run(`go('${name}')`);
  assert.ok(element('page').innerHTML.length > 300, name + ' renders');
}
run('query="figma";typeFilter="expense"');
assert.equal(run('filteredTransactions().length'), 1);
listeners['entry-form:submit']({ preventDefault() {}, target: { values: { name: 'Test expense', company: 'Test Co', amount: '25.50', date: run('localDate()'), category: 'Software', type: 'expense' } } });
assert.equal(run('total(current(), "expense")'), 3224.5);
assert.ok(storage.has('ledger-v1'));
const before = run('state.transactions.length');
const pay = { dataset: { pay: 'INV-001' } };
listeners.click({ target: { closest: () => pay } });
listeners.click({ target: { closest: () => pay } });
assert.equal(run('state.transactions.length'), before + 1, 'paying twice does not duplicate income');
assert.equal(run('state.invoices[0].status'), 'paid');
assert.equal(run('total(current(), "income")'), 16700);
run('formMode="budget"');
listeners['entry-form:submit']({ preventDefault() {}, target: { values: { name: 'Software', limit: '750' } } });
assert.equal(run('state.budgets.find(b=>b.name==="Software").limit'), 750);
assert.ok(run('esc("<script>")').includes('&lt;'));
console.log('Passed: page rendering, totals, search, transaction creation, persistence, invoice payment deduplication, budget editing, and HTML escaping.');
