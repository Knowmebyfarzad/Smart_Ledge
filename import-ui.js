/* Import stays in memory until the preview is explicitly confirmed. */
let importSession = null;
let importReadVersion = 0;
const importDialog = document.getElementById('import-dialog');
const importContent = document.getElementById('import-content');
function importSelect(id, label, values, selected) {
  return `<label class="field">${label}<select id="${id}">${values.map(([value, text]) => `<option value="${value}" ${String(value) === String(selected) ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
}
function openImport() {
  importReadVersion++;
  importSession = null;
  importContent.innerHTML = `<div class="import-intro"><span class="import-symbol">↥</span><h3>Bring your transactions into Ledger</h3><p>Choose a CSV, match its columns, then review every detail before saving. Your file stays on this device.</p></div>
    <div class="import-upload"><label class="field">Transaction file (.csv or .tsv, up to 5 MB)<input id="csv-file" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values"></label>
    ${importSelect('csv-encoding', 'File encoding', [['utf-8', 'UTF-8 (recommended)'], ['windows-1256', 'Arabic / Persian (Windows-1256)'], ['utf-16le', 'UTF-16 little endian'], ['utf-16be', 'UTF-16 big endian']], 'utf-8')}</div>
    <p class="import-help">Include price, recipient, date, time, description/reason, tracking or backup code, and originating bank. Missing time or code will be flagged for review.</p>
    <div class="import-template"><button class="button" id="csv-template">Download example CSV</button><span>English and Persian headers are recognized. Other headers can be mapped manually.</span></div>
    <div id="csv-message" role="status"></div><div id="csv-setup"></div><div id="csv-preview"></div>`;
  importDialog.showModal();
}
function importMessage(message) { document.getElementById('csv-message').textContent = message; }
async function readImportFile() {
  const version = ++importReadVersion;
  importSession = null;
  document.getElementById('csv-setup').innerHTML = '';
  document.getElementById('csv-preview').innerHTML = '';
  const file = document.getElementById('csv-file').files[0];
  if (!file) { importMessage(''); return; }
  if (file.size > 5 * 1024 * 1024) { importMessage('File is too large. Split it into files smaller than 5 MB.'); return; }
  importMessage('Reading file…');
  try {
    const encoding = document.getElementById('csv-encoding').value;
    const bytes = await file.arrayBuffer();
    if (version !== importReadVersion || !importDialog.open) return;
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    if (text.includes('\uFFFD') || text.includes('\0')) throw new Error('Unreadable characters found. Choose the correct file encoding.');
    const parsed = LedgerCSV.detectCSV(text);
    importSession = { text, parsed, fileName: file.name, result: null };
    importMessage(`${file.name} · ${parsed.rows.length} transaction rows`);
    renderImportSetup();
  } catch (e) { if (version === importReadVersion) importMessage(`Could not read the file: ${e.message}`); }
}
function renderImportSetup() {
  const { parsed } = importSession;
  const map = LedgerCSV.autoMap(parsed.headers);
  document.getElementById('csv-preview').innerHTML = '';
  document.getElementById('csv-setup').innerHTML = `<div class="import-section-title"><span>1</span><h3>Choose how to read the file</h3></div>
    <div class="import-options">
    ${importSelect('csv-delimiter', 'Column separator', [[',', 'Comma (,)'], [';', 'Semicolon (;)'], ['tab', 'Tab']], parsed.delimiter === '\t' ? 'tab' : parsed.delimiter)}
    ${importSelect('csv-calendar', 'Source calendar', [['gregorian', 'Gregorian'], ['jalali', 'Jalali / Persian (شمسی)']], 'gregorian')}
    ${importSelect('csv-date-order', 'Date order', [['ymd', 'Year / month / day'], ['dmy', 'Day / month / year'], ['mdy', 'Month / day / year']], 'ymd')}
    ${importSelect('csv-number-format', 'Number format', [['dot', '1,234.56 or ۱٬۲۳۴٫۵۶'], ['comma', '1.234,56']], 'dot')}
    ${importSelect('csv-direction', 'When no type is supplied', [['', 'Choose income / expense rule…'], ['expense', 'All payments are expenses'], ['income', 'All payments are income'], ['signed', 'Positive = income; negative = expense']], '')}
    ${importSelect('csv-currency', 'Currency / unit (no conversion)', [['USD', 'US dollars (USD)'], ['IRR', 'Iranian rials (IRR)'], ['IRT', 'Iranian tomans (IRT)']], state.currency || 'USD')}
    <label class="field">Default originating bank (if missing)<input id="csv-bank" placeholder="For example: Bank Mellat" maxlength="150"></label></div>
    <p class="import-help">Dates are stored as Gregorian dates; original values are retained. Times stay as written, without timezone conversion. Rials and tomans are separate units. Existing books must use the same currency.</p>
    <div class="import-section-title"><span>2</span><h3>Match your columns</h3></div>
    <div class="import-mapping">${LedgerCSV.fields.map(f => importSelect(`map-${f.key}`, `${f.label}${f.required ? ' *' : ''}`, [[-1, 'Not mapped'], ...parsed.headers.map((h, i) => [i, `${i + 1}. ${h || '(unnamed column)'}`])], map[f.key])).join('')}</div>
    <div class="import-source"><strong>First source row</strong><div class="table-wrap"><table><thead><tr>${parsed.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody><tr>${parsed.rows[0].cells.map(c => `<td dir="auto">${esc(c)}</td>`).join('')}</tr></tbody></table></div></div>
    <button class="button primary" id="csv-review">Review transactions →</button>`;
}
function getImportOptions() {
  return { calendar: document.getElementById('csv-calendar').value, dateOrder: document.getElementById('csv-date-order').value, numberFormat: document.getElementById('csv-number-format').value, direction: document.getElementById('csv-direction').value, bank: document.getElementById('csv-bank').value, currency: document.getElementById('csv-currency').value, fileName: importSession.fileName };
}
function reviewImport() {
  if (!importSession) return;
  const mapping = Object.fromEntries(LedgerCSV.fields.map(f => [f.key, Number(document.getElementById(`map-${f.key}`).value)]));
  const options = getImportOptions();
  const result = LedgerCSV.validate(importSession.parsed, mapping, options, state.transactions);
  const hasBooks = state.transactions.length || state.invoices.length || state.openingBalance;
  if (hasBooks && options.currency !== (state.currency || 'USD')) result.errors.push(`This workspace uses ${state.currency || 'USD'}. Choose that currency, or back up and clear the books in Settings before importing ${options.currency}. Amounts will not be converted.`);
  importSession.result = result;
  importSession.options = options;
  const warnings = result.rows.filter(r => r.warnings.length).length;
  const canImport = result.ready.length > 0 && !result.invalid && !result.errors.length;
  document.getElementById('csv-preview').innerHTML = `<div class="import-section-title"><span>3</span><h3>Review before importing</h3></div>
    <div class="import-summary"><span><strong>${result.ready.length}</strong> ready</span><span><strong>${result.duplicates}</strong> exact duplicates skipped</span><span class="${result.invalid ? 'error-text' : ''}"><strong>${result.invalid}</strong> invalid</span><span><strong>${warnings}</strong> with notes</span></div>
    ${result.errors.map(e => `<p class="import-error">${esc(e)}</p>`).join('')}
    ${result.invalid ? '<p class="import-error">Nothing will be imported until every invalid row is corrected. Update the mapping or settings, or fix the source file and upload it again.</p>' : ''}
    ${result.rows.length ? `<div class="table-wrap import-preview-table"><table><thead><tr><th>CSV line / status</th><th>Price / type</th><th>Recipient</th><th>Date / time</th><th>Description / reason</th><th>Tracking / backup code</th><th>Originating bank</th><th>Validation</th></tr></thead><tbody>${result.rows.slice(0,100).map(r => { const t = r.transaction; return `<tr><td>${r.line}<br><span class="status ${r.status === 'invalid' ? 'pending' : ''}">${r.status}</span></td><td>${t ? `${esc(t.amount)} ${esc(options.currency)}<br>${esc(t.type)}` : '—'}</td><td dir="auto">${esc(t?.company || '—')}</td><td>${esc(t?.date || '—')}<br>${esc(t?.time || '—')}</td><td dir="auto">${esc(t?.name || '—')}</td><td class="reference-code" dir="auto">${esc(t?.referenceCode || '—')}</td><td dir="auto">${esc(t?.bank || '—')}</td><td class="validation-notes">${[...r.issues, ...r.warnings].map(esc).join('<br>') || 'Ready'}</td></tr>`; }).join('')}</tbody></table></div>` : ''}
    ${result.rows.length > 100 ? '<p class="import-help">Showing the first 100 rows. All rows have been validated. Download the validation report to inspect every row.</p>' : ''}
    <div class="import-confirm"><button class="button" id="csv-validation-report">Download validation report</button><button class="button primary" id="csv-confirm" ${canImport ? '' : 'disabled'}>Import ${result.ready.length} transactions</button></div>
    <p class="import-help">Exact matches are skipped. Reused bank tracking codes with different details are blocked. Missing times and codes remain blank. Original source fields are included in JSON backups.</p>`;
}
function confirmImport() {
  if (!importSession?.result) return;
  // Revalidate against the current books immediately before committing.
  reviewImport();
  const { result, options } = importSession;
  if (result.errors.length || result.invalid || !result.ready.length) return;
  const batchId = crypto.randomUUID();
  const candidate = { ...state, currency: options.currency, transactions: [...state.transactions, ...result.ready.map(t => ({ ...t, id: crypto.randomUUID(), importBatch: batchId }))] };
  try {
    // Persist first: a quota/storage failure must not leave a partial import.
    localStorage.setItem('ledger-v1', JSON.stringify(candidate));
  } catch {
    importMessage('Import was not saved. Browser storage is full or unavailable. No transactions were added. Export a backup or use a smaller file.');
    return;
  }
  const count = result.ready.length;
  state = candidate;
  importSession = null;
  importDialog.close();
  query = ''; typeFilter = 'all';
  go('transactions');
  toast(`${count} transactions imported and saved.`);
}
function downloadValidationReport() {
  const result = importSession?.result;
  if (!result) return;
  const rows = [['Source line', 'Status', 'Errors', 'Notes'], ...result.errors.map(e => ['', 'configuration error', e, '']), ...result.rows.map(r => [r.line, r.status, r.issues.join('; '), r.warnings.join('; ')])];
  download('\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n'), 'ledger-import-validation.csv', 'text/csv;charset=utf-8');
}
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.action === 'import') openImport();
  if (b.id === 'close-import') { importReadVersion++; importDialog.close(); importSession = null; }
  if (b.id === 'csv-review') reviewImport();
  if (b.id === 'csv-confirm') confirmImport();
  if (b.id === 'csv-validation-report') downloadValidationReport();
  if (b.id === 'csv-template') download('\uFEFFPrice,Recipient,Date,Time,Description,Tracking code,Originating bank,Type,Currency\r\n1250.50,Example recipient,2026-09-16,14:35:20,Invoice payment,0000123456789,Example Bank,expense,USD\r\n', 'ledger-import-example.csv', 'text/csv;charset=utf-8');
});
importDialog.addEventListener('change', e => {
  if (e.target.id === 'csv-file' || e.target.id === 'csv-encoding') { readImportFile(); return; }
  if (!importSession) return;
  importSession.result = null;
  document.getElementById('csv-preview').innerHTML = '';
  if (e.target.id === 'csv-delimiter') {
    try { importSession.parsed = LedgerCSV.parseCSV(importSession.text, e.target.value === 'tab' ? '\t' : e.target.value); renderImportSetup(); importMessage(`${importSession.fileName} · ${importSession.parsed.rows.length} transaction rows`); }
    catch (error) { importMessage(error.message); document.getElementById('csv-review').disabled = true; }
  }
});
importDialog.addEventListener('input', e => {
  if (e.target.id === 'csv-bank' && importSession) { importSession.result = null; document.getElementById('csv-preview').innerHTML = ''; }
});
importDialog.addEventListener('cancel', () => { importReadVersion++; importSession = null; });
