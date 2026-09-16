'use strict';
const { parseDate, parseTime } = require('./csv.js');
const emptyWorkspace = () => ({ transactions: [], invoices: [], budgets: [], openingBalance: 0, currency: 'USD' });
function invalid(message) { const error = new Error(message); error.status = 400; throw error; }
function string(value, label, max = 1000, optional = false) {
  if (optional && (value === undefined || value === null)) return '';
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) invalid(`Invalid ${label}.`);
  return value;
}
function amount(value, label, zero = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < (zero ? 0 : 0.01) || value > 999999999999.99 || Math.abs(value * 100 - Math.round(value * 100)) > 0.02) invalid(`Invalid ${label}.`);
  return Math.round(value * 100) / 100;
}
function date(value) {
  try { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(); return parseDate(value).date; }
  catch { invalid('Invalid transaction or invoice date.'); }
}
function validateWorkspace(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Invalid workspace.');
  const currency = input.currency || 'USD';
  if (!['USD', 'IRR', 'IRT'].includes(currency)) invalid('Unsupported currency.');
  for (const key of ['transactions', 'invoices', 'budgets']) if (!Array.isArray(input[key]) || input[key].length > (key === 'budgets' ? 100 : 50000)) invalid(`Invalid ${key} list.`);
  const ids = new Set();
  const transactions = input.transactions.map(t => {
    if (!t || typeof t !== 'object') invalid('Invalid transaction.');
    const id = string(t.id, 'transaction ID', 100);
    if (ids.has(id)) invalid('Duplicate transaction ID.'); ids.add(id);
    if (!['income', 'expense'].includes(t.type)) invalid('Invalid transaction type.');
    if (t.currency && t.currency !== currency) invalid('Mixed transaction currencies are not supported.');
    const category = string(t.category, 'category', 100);
    if (!['Software', 'Marketing', 'Office', 'Other', 'Client payments', 'Consulting'].includes(category)) invalid('Invalid category.');
    let time;
    try { time = parseTime(string(t.time, 'time', 30, true)); } catch { invalid('Invalid transaction time.'); }
    const result = { id, amount: amount(t.amount, 'transaction amount'), type: t.type, company: string(t.company, 'recipient'), name: string(t.name, 'description', 10000), date: date(t.date), time, category, bank: string(t.bank, 'bank', 1000, true), referenceCode: string(t.referenceCode, 'tracking code', 1000, true), currency };
    for (const key of ['sourceCategory', 'sourceDate', 'sourceCalendar', 'importBatch']) if (t[key] !== undefined) result[key] = string(t[key], key, 1000, true);
    if (t.source) {
      const s = t.source;
      if (!Array.isArray(s.headers) || !Array.isArray(s.values) || s.headers.length !== s.values.length || s.headers.length > 200) invalid('Invalid original CSV row.');
      result.source = { headers: s.headers.map(v => string(v, 'source header', 1000, true)), values: s.values.map(v => string(v, 'source cell', 20000, true)), file: string(s.file, 'source filename', 1000, true), line: Number.isSafeInteger(s.line) && s.line > 0 ? s.line : 1 };
    }
    return result;
  });
  const invoiceIds = new Set();
  const invoices = input.invoices.map(i => {
    if (!i || typeof i !== 'object') invalid('Invalid invoice.');
    const id = string(i.id, 'invoice ID', 100);
    if (invoiceIds.has(id)) invalid('Duplicate invoice ID.'); invoiceIds.add(id);
    if (!['paid', 'pending'].includes(i.status)) invalid('Invalid invoice status.');
    return { id, client: string(i.client, 'client'), description: string(i.description, 'invoice description', 10000), amount: amount(i.amount, 'invoice amount'), date: date(i.date), status: i.status };
  });
  const categories = new Set();
  const budgets = input.budgets.map(b => {
    if (!b || !['Software', 'Marketing', 'Office', 'Other'].includes(b.name) || categories.has(b.name)) invalid('Invalid or duplicate budget category.');
    categories.add(b.name); return { name: b.name, limit: amount(b.limit, 'budget limit') };
  });
  if (typeof input.openingBalance !== 'number' || !Number.isFinite(input.openingBalance)) invalid('Invalid opening balance.');
  const openingBalance = amount(Math.abs(input.openingBalance), 'opening balance', true) * (input.openingBalance < 0 ? -1 : 1);
  return { transactions, invoices, budgets, openingBalance, currency };
}
module.exports = { emptyWorkspace, validateWorkspace };
