// Optional browser integration checks using an installed Chrome, with no packages.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const browser = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-browser-'));
const server = spawn(process.execPath, ['server.js'], { cwd: __dirname, env: { ...process.env, PORT: '3107' }, stdio: 'ignore', windowsHide: true });
const chrome = spawn(browser, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-port=9339', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
let socket;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, message) {
  for (let i = 0; i < 80; i++) { try { const result = await fn(); if (result) return result; } catch {} await delay(100); }
  throw new Error(message);
}
async function main() {
  await until(async () => (await fetch('http://127.0.0.1:3107')).ok, 'Test server did not start');
  const target = await until(async () => (await (await fetch('http://127.0.0.1:9339/json')).json()).find(t => t.type === 'page'), 'Chrome debugging endpoint did not start');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0; const pending = new Map(); const exceptions = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    if (message.id && pending.has(message.id)) { const callback = pending.get(message.id); pending.delete(message.id); message.error ? callback.reject(new Error(message.error.message)) : callback.resolve(message.result); }
  };
  function call(method, params = {}) {
    return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  }
  async function evaluate(expression) {
    const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  }
  await call('Runtime.enable'); await call('Page.enable');
  await call('Page.navigate', { url: 'http://127.0.0.1:3107' });
  await until(() => evaluate('typeof openImport === "function"'), 'App scripts did not load');
  await evaluate('go("transactions"); document.querySelector("[data-action=import]").click()');
  assert.equal(await evaluate('document.getElementById("import-dialog").open'), true);
  async function upload(filename) {
    const { root } = await call('DOM.getDocument');
    const { nodeId } = await call('DOM.querySelector', { nodeId: root.nodeId, selector: '#csv-file' });
    await call('DOM.setFileInputFiles', { nodeId, files: [path.join(__dirname, 'examples', filename)] });
    await until(() => evaluate('!!importSession'), 'File was not parsed');
  }
  await upload('transactions.csv');
  await evaluate('document.getElementById("csv-review").click()');
  assert.equal(await evaluate('importSession.result.ready.length'), 2);
  assert.equal(await evaluate('document.getElementById("csv-confirm").disabled'), false);
  assert.equal(await evaluate('document.getElementById("csv-preview").textContent.includes("0000123456789")'), true);
  const before = await evaluate('state.transactions.length');
  // Simulate quota failure: no in-memory or persisted partial transaction set.
  await evaluate('window.originalSetItem=Storage.prototype.setItem; Storage.prototype.setItem=function(){throw new Error("quota")}; document.getElementById("csv-confirm").click()');
  assert.equal(await evaluate('state.transactions.length'), before);
  assert.equal(await evaluate('document.getElementById("csv-message").textContent.includes("No transactions were added")'), true);
  await evaluate('Storage.prototype.setItem=window.originalSetItem; document.getElementById("csv-confirm").click()');
  assert.equal(await evaluate('state.transactions.length'), before + 2);
  assert.equal(await evaluate('document.getElementById("import-dialog").open'), false);
  assert.equal(await evaluate('document.getElementById("page").textContent.includes("0000123456789")'), true);
  assert.equal(await evaluate('JSON.parse(localStorage.getItem("ledger-v1")).transactions.slice(-2)[0].time'), '14:35:20');
  await call('Page.reload');
  await until(() => evaluate('typeof openImport === "function" && state.transactions.length === ' + (before + 2)), 'Saved import did not survive reload');
  await evaluate('openImport()'); await upload('transactions.csv');
  await evaluate('reviewImport()');
  assert.equal(await evaluate('importSession.result.duplicates'), 2);
  assert.equal(await evaluate('document.getElementById("csv-confirm").disabled'), true);
  await evaluate('document.getElementById("csv-currency").value="IRR"; reviewImport()');
  assert.equal(await evaluate('importSession.result.errors.some(e=>e.includes("workspace uses USD"))'), true);
  // Empty test workspace, then import a Persian bank record in rials.
  await evaluate('importDialog.close(); state={transactions:[],invoices:[],budgets:[],openingBalance:0};openImport()');
  await upload('transactions-persian.csv');
  await evaluate('document.getElementById("csv-currency").value="IRR";document.getElementById("csv-calendar").value="jalali";reviewImport()');
  assert.equal(await evaluate('importSession.result.ready.length'), 1);
  await evaluate('confirmImport()');
  assert.equal(await evaluate('state.transactions[0].date'), '2026-09-16');
  assert.equal(await evaluate('state.transactions[0].referenceCode'), '۰۰۰۱۲۳۴۵۶۷۸۹');
  assert.equal(await evaluate('state.currency'), 'IRR');
  await evaluate('query="بانک ملت";render()');
  assert.equal(await evaluate('filteredTransactions().length'), 1);
  assert.equal(await evaluate('document.getElementById("page").textContent.includes("علی رضایی")'), true);
  // Preview rendering must treat CSV values as plain text.
  await evaluate('openImport()'); await upload('transactions.csv');
  await evaluate('state={transactions:[],invoices:[],budgets:[],openingBalance:0};document.getElementById("csv-currency").value="USD";importSession.parsed.rows[0].cells[1]="<img src=x onerror=alert(1)>";reviewImport()');
  assert.equal(await evaluate('document.querySelectorAll("#csv-preview img").length'), 0);
  // Invalid rows block the entire file, even with other valid rows.
  await evaluate('importSession.parsed.rows[0].cells[2]="2026-02-30";reviewImport()');
  assert.equal(await evaluate('importSession.result.invalid'), 1);
  assert.equal(await evaluate('document.getElementById("csv-confirm").disabled'), true);
  await evaluate('confirmImport()');
  assert.equal(await evaluate('state.transactions.length'), 0);
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.ok(await evaluate('document.getElementById("import-dialog").getBoundingClientRect().width <= 390'));
  const screenshot = await call('Page.captureScreenshot', { format: 'png' });
  const screenshotPath = path.join(os.tmpdir(), 'ledger-import-mobile.png');
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log('Passed browser checks: upload, mapping, preview, atomic save, quota failure, reload, duplicate prevention, currency conflicts, Persian/Jalali import, search, escaped text, invalid-row blocking, mobile dialog.');
  console.log('Screenshot: ' + screenshotPath);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { if (socket) socket.close(); chrome.kill(); server.kill(); });
