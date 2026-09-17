// Optional browser integration checks using an installed Chrome, with no packages.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const browser = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-browser-'));
const testData = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-browser-data-'));
const server = spawn(process.execPath, ['server.js'], { cwd: __dirname, env: { ...process.env, PORT: '3107', LEDGER_DATA_DIR: testData, PUBLIC_ORIGIN: '' }, stdio: 'ignore', windowsHide: true });
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
  await until(() => evaluate('!!document.querySelector("#auth-fields [name=setupCode]")'), 'Setup form did not load');
  assert.equal(await evaluate('document.getElementById("app-shell").hidden'), true);
  assert.equal(await evaluate('state.transactions.length'), 0);
  const setupCode = fs.readFileSync(path.join(testData, 'setup-code.txt'), 'utf8').trim();
  async function submit(formId, values) {
    await evaluate(`(() => { const form=document.getElementById(${JSON.stringify(formId)}); const values=${JSON.stringify(values)}; for(const [name,value] of Object.entries(values)) form.elements.namedItem(name).value=value; form.requestSubmit(); })()`);
  }
  await submit('auth-form', { setupCode, name: 'Owner Test', email: 'owner@example.test', password: 'Owner-browser-test-2026', confirmPassword: 'Owner-browser-test-2026' });
  await until(() => evaluate('!!account && !document.getElementById("app-shell").hidden'), 'Administrator setup failed');
  assert.equal(await evaluate('account.role'), 'admin');
  assert.equal(await evaluate('document.cookie.includes("ledger_session")'), false);
  await evaluate('go("settings");document.querySelector("[data-action=create-user]").click()');
  await submit('account-form', { name: 'Member Test', email: 'member@example.test', role: 'member', password: 'Member-temporary-2026', confirmPassword: 'Member-temporary-2026' });
  await until(() => evaluate('!document.getElementById("account-dialog").open && document.getElementById("account-users").textContent.includes("member@example.test")'), 'User creation failed');
  const ownerId = await evaluate('account.id');
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
  await evaluate('window.originalFetch=window.fetch; window.fetch=function(url,options){if(url==="/api/workspace"&&options?.method==="PUT") return Promise.reject(new Error("offline"));return window.originalFetch(url,options)};confirmImport()');
  assert.equal(await evaluate('state.transactions.length'), before);
  assert.equal(await evaluate('document.getElementById("csv-message").textContent.includes("Import could not be confirmed")'), true);
  await evaluate('window.fetch=window.originalFetch;importDialog.close();bootWorkspace(account)');
  await evaluate('openImport()'); await upload('transactions.csv');
  await evaluate('reviewImport();confirmImport()');
  assert.equal(await evaluate('state.transactions.length'), before + 2);
  assert.equal(await evaluate('document.getElementById("import-dialog").open'), false);
  assert.equal(await evaluate('document.getElementById("page").textContent.includes("0000123456789")'), true);
  assert.equal(await evaluate('LedgerAuth.request("/api/workspace").then(result=>result.state.transactions.slice(-2)[0].time)'), '14:35:20');
  assert.equal(await evaluate('localStorage.getItem("ledger-v1")'), null);
  await call('Page.reload');
  await until(() => evaluate('typeof openImport === "function" && state.transactions.length === ' + (before + 2)), 'Saved import did not survive reload');
  await evaluate('openImport()'); await upload('transactions.csv');
  await evaluate('reviewImport()');
  assert.equal(await evaluate('importSession.result.duplicates'), 2);
  assert.equal(await evaluate('document.getElementById("csv-confirm").disabled'), true);
  await evaluate('document.getElementById("csv-currency").value="IRR"; reviewImport()');
  assert.equal(await evaluate('importSession.result.errors.some(e=>e.includes("workspace uses USD"))'), true);
  await evaluate('importDialog.close();LedgerAuth.logout()');
  assert.equal(await evaluate('document.getElementById("app-shell").hidden'), true);
  assert.equal(await evaluate('document.getElementById("page").innerHTML'), '');
  await submit('auth-form', { email: 'member@example.test', password: 'Member-temporary-2026' });
  await until(() => evaluate('!!document.querySelector("#auth-fields [name=currentPassword]")'), 'Temporary password change not required');
  assert.equal(await evaluate('document.getElementById("app-shell").hidden'), true);
  await submit('auth-form', { currentPassword: 'Member-temporary-2026', password: 'Member-personal-2026', confirmPassword: 'Member-personal-2026' });
  await until(() => evaluate('account?.email === "member@example.test" && !document.getElementById("app-shell").hidden'), 'Member sign-in failed');
  assert.equal(await evaluate('state.transactions.length'), 0);
  assert.notEqual(await evaluate('account.id'), ownerId);
  await evaluate('go("settings")');
  assert.equal(await evaluate('!!document.querySelector("[data-action=create-user]")'), false);
  await evaluate('openImport()');
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
  await call('Page.reload');
  await until(() => evaluate('account?.email === "member@example.test" && state.transactions.length === 1'), 'Member data did not survive reload');
  await evaluate('LedgerAuth.logout()');
  await submit('auth-form', { email: 'owner@example.test', password: 'Owner-browser-test-2026' });
  await until(() => evaluate('account?.email === "owner@example.test"'), 'Owner sign-in failed');
  assert.equal(await evaluate('state.transactions.length'), 2);
  assert.equal(await evaluate('state.currency'), 'USD');
  await evaluate('LedgerAuth.logout()');
  await submit('auth-form', { email: 'member@example.test', password: 'Member-personal-2026' });
  await until(() => evaluate('account?.email === "member@example.test"'), 'Member second sign-in failed');
  await evaluate('commitState(blankWorkspace())');
  await evaluate('openImport()'); await upload('transactions.csv');
  await evaluate('document.getElementById("csv-currency").value="USD";importSession.parsed.rows[0].cells[1]="<img src=x onerror=alert(1)>";reviewImport()');
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
  await evaluate('importDialog.close();LedgerAuth.logout()');
  const loginScreenshot = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(os.tmpdir(), 'ledger-login-mobile.png'), Buffer.from(loginScreenshot.data, 'base64'));
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const desktopScreenshot = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(os.tmpdir(), 'ledger-login-desktop.png'), Buffer.from(desktopScreenshot.data, 'base64'));
  console.log('Passed browser checks: administrator setup, user creation, login/logout, temporary password change, separate user records, private CSV saves, failure rollback, reload persistence, duplicate prevention, Persian/Jalali import, search, escaped text, validation, and mobile dialogs.');
  console.log('Screenshot: ' + screenshotPath);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { if (socket) socket.close(); chrome.kill(); server.kill(); });
