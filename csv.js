/* CSV parsing and normalization. Kept independent of the UI for verification. */
(function (root) {
  'use strict';
  const fields = [
    { key: 'amount', label: 'Price / amount', required: true, aliases: ['price', 'amount', 'value', 'مبلغ', 'مبلغ تراکنش', 'قیمت'] },
    { key: 'company', label: 'Recipient', required: true, aliases: ['recipient', 'beneficiary', 'payee', 'business', 'company', 'client', 'گیرنده', 'دریافت کننده', 'نام گیرنده', 'ذینفع'] },
    { key: 'date', label: 'Date', required: true, aliases: ['date', 'transaction date', 'datetime', 'date time', 'تاریخ', 'تاریخ تراکنش', 'تاریخ و ساعت'] },
    { key: 'time', label: 'Time', aliases: ['time', 'transaction time', 'ساعت', 'زمان', 'زمان تراکنش'] },
    { key: 'name', label: 'Description / reason', required: true, aliases: ['description', 'reason', 'description reason', 'memo', 'details', 'شرح', 'توضیحات', 'بابت', 'علت', 'شرح تراکنش'] },
    { key: 'referenceCode', label: 'Tracking / backup code (کد پیگیری)', aliases: ['reference code', 'reference', 'tracking code', 'tracking number', 'backup code', 'code pagiry', 'code peigiri', 'کد پیگیری', 'شماره پیگیری', 'کد رهگیری', 'شماره مرجع', 'کد پشتیبان'] },
    { key: 'bank', label: 'Originating bank', aliases: ['bank', 'originating bank', 'source bank', 'bank name', 'بانک', 'بانک مبدا', 'نام بانک'] },
    { key: 'type', label: 'Income / expense (optional)', aliases: ['type', 'direction', 'transaction type', 'نوع', 'نوع تراکنش'] },
    { key: 'category', label: 'Category (optional)', aliases: ['category', 'دسته بندی', 'دسته'] },
    { key: 'currency', label: 'Currency (optional)', aliases: ['currency', 'واحد پول', 'ارز'] }
  ];
  const digits = s => String(s).replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 1776)).replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 1632));
  const normalizeHeader = s => digits(s).toLowerCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[\s_\-/()\u200c\u200e\u200f]+/g, '').trim();
  function parseCSV(text, delimiter = ',') {
    if (![',', ';', '\t'].includes(delimiter)) throw new Error('Choose comma, semicolon, or tab as the separator.');
    text = String(text).replace(/^\uFEFF/, '');
    const rows = []; let cells = [], value = '', quoted = false, closed = false, line = 1, rowLine = 1;
    const cell = () => { cells.push(value); value = ''; closed = false; };
    const row = () => { cell(); if (cells.some(c => c.trim() !== '')) rows.push({ cells, line: rowLine }); cells = []; };
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') { if (text[i + 1] === '"') { value += '"'; i++; } else { quoted = false; closed = true; } }
        else { value += c; if (c === '\n' || (c === '\r' && text[i + 1] !== '\n')) line++; }
      } else if (c === delimiter) cell();
      else if (c === '\r' || c === '\n') { row(); if (c === '\r' && text[i + 1] === '\n') i++; line++; rowLine = line; }
      else if (closed) { if (c !== ' ' && c !== '\t') throw new Error(`Line ${line}: unexpected text after a closing quote.`); }
      else if (c === '"') { if (value !== '') throw new Error(`Line ${line}: quote inside an unquoted field.`); quoted = true; }
      else value += c;
    }
    if (quoted) throw new Error(`Line ${rowLine}: quoted field is not closed.`);
    if (value || cells.length || closed) row();
    if (rows.length < 2) throw new Error('Include a header row and at least one transaction.');
    if (rows.length > 10001) throw new Error('Import at most 10,000 transactions per file.');
    const headers = rows.shift().cells.map(s => s.trim());
    if (headers.length < 2) throw new Error('Only one column found. Check the separator.');
    return { headers, rows, delimiter };
  }
  function detectCSV(text) {
    const candidates = [',', ';', '\t'].map(delimiter => {
      try { const parsed = parseCSV(text, delimiter); return { parsed, score: parsed.rows.filter(r => r.cells.length === parsed.headers.length).length / parsed.rows.length, width: parsed.headers.length }; } catch { return null; }
    }).filter(Boolean).sort((a, b) => b.score - a.score || b.width - a.width);
    if (!candidates.length) return parseCSV(text, ',');
    return candidates[0].parsed;
  }
  function autoMap(headers) {
    const map = {};
    for (const f of fields) {
      const matches = headers.map((h, i) => f.aliases.some(a => normalizeHeader(a) === normalizeHeader(h)) ? i : -1).filter(i => i >= 0);
      map[f.key] = matches.length === 1 ? matches[0] : -1;
    }
    return map;
  }
  function parseAmount(raw, format = 'dot') {
    let text = digits(raw).trim().replace(/[\u200e\u200f\u061c]/g, '').replace(/−/g, '-').replace(/٬/g, ',').replace(/٫/g, '.');
    let negative = false;
    if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1).trim(); }
    if (/^[+-]/.test(text)) { if (negative) throw new Error('Amount has conflicting signs.'); negative = text[0] === '-'; text = text.slice(1); }
    const decimal = format === 'comma' ? ',' : '.';
    const group = format === 'comma' ? '.' : ',';
    const parts = text.split(decimal);
    if (parts.length > 2 || (parts.length === 2 && !/^\d{1,2}$/.test(parts[1]))) throw new Error('Amount must have at most two decimal places. Check the number format.');
    let integer = parts[0];
    if (integer.includes(group)) {
      const escaped = group === '.' ? '\\.' : ',';
      if (!new RegExp('^\\d{1,3}(?:' + escaped + '\\d{3})+$').test(integer)) throw new Error('Invalid thousands separators in amount.');
      integer = integer.split(group).join('');
    } else if (/[ \u00a0\u202f]/.test(integer)) {
      if (!/^\d{1,3}(?:[ \u00a0\u202f]\d{3})+$/.test(integer)) throw new Error('Invalid spaces in amount.');
      integer = integer.replace(/[ \u00a0\u202f]/g, '');
    }
    if (!/^\d+$/.test(integer)) throw new Error('Amount must be a number without currency symbols.');
    const minor = Number(integer) * 100 + Number((parts[1] || '').padEnd(2, '0'));
    if (!Number.isSafeInteger(minor) || minor <= 0 || minor > 99999999999999) throw new Error('Amount must be greater than zero and no more than 999,999,999,999.99.');
    return { amount: minor / 100, negative };
  }
  const persianYears = new Map();
  function jalaliDate(y, m, d) {
    if (y < 1200 || y > 1600) throw new Error('Jalali year must be between 1200 and 1600.');
    if (!persianYears.has(y)) {
      const fmt = new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
      const dates = new Map();
      for (let n = Date.UTC(y + 621, 2, 18); n <= Date.UTC(y + 622, 2, 23); n += 86400000) {
        const date = new Date(n), p = Object.fromEntries(fmt.formatToParts(date).map(x => [x.type, x.value]));
        if (Number(p.year) === y) dates.set(`${Number(p.month)}-${Number(p.day)}`, date.toISOString().slice(0, 10));
      }
      persianYears.set(y, dates);
    }
    const date = persianYears.get(y).get(`${m}-${d}`);
    if (!date) throw new Error('Invalid Jalali calendar date.');
    return date;
  }
  function parseDate(raw, order = 'ymd', calendar = 'gregorian') {
    const text = digits(raw).trim().replace(/[\u200e\u200f\u061c]/g, '');
    const match = text.match(/^(\d{1,4})([-/.])(\d{1,2})\2(\d{1,4})(?:[T\s]+(.+))?$/);
    if (!match) throw new Error('Use a numeric date such as 2026-09-16 or 1405/06/25.');
    const a = Number(match[1]), b = Number(match[3]), c = Number(match[4]);
    let y, m, d;
    if (order === 'dmy') { y = c; m = b; d = a; } else if (order === 'mdy') { y = c; m = a; d = b; } else { y = a; m = b; d = c; }
    if ((order === 'ymd' ? match[1] : match[4]).length !== 4) throw new Error('Use a four-digit year and check the date order.');
    let date;
    if (calendar === 'jalali') date = jalaliDate(y, m, d);
    else {
      if (y < 1900 || y > 2200) throw new Error('Gregorian year must be 1900–2200. For Persian dates, choose Jalali.');
      const check = new Date(Date.UTC(y, m - 1, d));
      if (check.getUTCFullYear() !== y || check.getUTCMonth() + 1 !== m || check.getUTCDate() !== d) throw new Error('Invalid calendar date.');
      date = check.toISOString().slice(0, 10);
    }
    return { date, embeddedTime: match[5] ? parseTime(match[5]) : '' };
  }
  function parseTime(raw) {
    const text = digits(raw).trim().replace(/[\u200e\u200f\u061c]/g, '');
    if (!text) return '';
    const m = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (!m) throw new Error('Time must be HH:mm or HH:mm:ss, optionally AM/PM. Time zones are not converted.');
    let h = Number(m[1]); const minute = Number(m[2]), second = Number(m[3] || 0);
    if (minute > 59 || second > 59 || h > (m[4] ? 12 : 23) || (m[4] && h < 1)) throw new Error('Invalid time.');
    if (m[4]) h = h % 12 + (m[4].toLowerCase() === 'pm' ? 12 : 0);
    return [h, minute, second].map(v => String(v).padStart(2, '0')).join(':');
  }
  const typeNames = { income: ['income', 'credit', 'deposit', 'received', 'واریز', 'درآمد', 'بستانکار'], expense: ['expense', 'debit', 'withdrawal', 'payment', 'برداشت', 'هزینه', 'بدهکار'] };
  const keyOf = t => JSON.stringify([t.amount, t.company || '', t.date, t.time || '', t.name || '', t.referenceCode || '', t.bank || '', t.type]);
  const refOf = t => t.referenceCode && t.bank ? JSON.stringify([t.bank.trim().toLowerCase(), digits(t.referenceCode)]) : '';
  function validate(parsed, mapping, options = {}, existing = []) {
    const errors = [];
    for (const f of fields.filter(f => f.required)) if (!Number.isInteger(mapping[f.key]) || mapping[f.key] < 0 || mapping[f.key] >= parsed.headers.length) errors.push(`Map the ${f.label} column.`);
    const indices = Object.values(mapping).filter(i => Number.isInteger(i) && i >= 0);
    if (new Set(indices).size !== indices.length) errors.push('Each source column can only be mapped once.');
    if (errors.length) return { errors, rows: [], ready: [], duplicates: 0, invalid: 0 };
    const known = new Set(existing.map(keyOf));
    const refs = new Map(existing.filter(t => refOf(t)).map(t => [refOf(t), keyOf(t)]));
    const rows = parsed.rows.map(row => {
      const issues = [], warnings = [];
      const get = key => mapping[key] >= 0 ? String(row.cells[mapping[key]] || '').trim() : '';
      let transaction;
      try {
        if (row.cells.length !== parsed.headers.length) throw new Error(`Expected ${parsed.headers.length} columns; found ${row.cells.length}.`);
        const { amount, negative } = parseAmount(get('amount'), options.numberFormat || 'dot');
        const { date, embeddedTime } = parseDate(get('date'), options.dateOrder || 'ymd', options.calendar || 'gregorian');
        const time = parseTime(get('time')) || embeddedTime;
        if (get('time') && embeddedTime && time !== embeddedTime) throw new Error('Date/time and separate time column disagree.');
        const company = get('company'), name = get('name'), bank = get('bank') || (options.bank || '').trim(), referenceCode = get('referenceCode');
        if (!company) throw new Error('Recipient is empty.');
        if (!name) throw new Error('Description / reason is empty.');
        if (!bank) throw new Error('Originating bank is empty. Map its column or supply a default bank.');
        const rawType = get('type'); let type;
        if (rawType) {
          type = Object.keys(typeNames).find(t => typeNames[t].some(n => normalizeHeader(n) === normalizeHeader(rawType)));
          if (!type) throw new Error(`Unrecognized transaction type: ${rawType}.`);
          if (negative && type === 'income') throw new Error('Negative amount conflicts with income type.');
        } else if (options.direction === 'signed') type = negative ? 'expense' : 'income';
        else if (['income', 'expense'].includes(options.direction)) {
          type = options.direction;
          if (negative && type === 'income') throw new Error('Negative amount conflicts with the selected income direction.');
        } else throw new Error('Choose an income/expense rule or map a type column.');
        const currency = (options.currency || 'USD').toUpperCase();
        const currencyAliases = { 'ریال': 'IRR', 'تومان': 'IRT', 'TOMAN': 'IRT', 'RIAL': 'IRR', '$': 'USD' };
        const rawCurrency = get('currency').toUpperCase();
        if (rawCurrency && (currencyAliases[rawCurrency] || rawCurrency) !== currency) throw new Error(`Currency ${rawCurrency} does not match ${currency}. No currency conversion is performed.`);
        const rawCategory = get('category');
        const allowed = type === 'income' ? ['Client payments', 'Consulting'] : ['Software', 'Marketing', 'Office', 'Other'];
        const category = allowed.find(c => c.toLowerCase() === rawCategory.toLowerCase()) || (type === 'income' ? 'Client payments' : 'Other');
        if (rawCategory && !allowed.some(c => c.toLowerCase() === rawCategory.toLowerCase())) warnings.push(`Category “${rawCategory}” stored as source category; grouped under ${category}.`);
        if (!time) warnings.push('No time supplied.');
        if (!referenceCode) warnings.push('No tracking / backup code supplied.');
        transaction = { amount, company, name, date, time, referenceCode, bank, type, category, currency, sourceCategory: rawCategory, sourceDate: get('date'), sourceCalendar: options.calendar || 'gregorian', source: { headers: parsed.headers.slice(), values: row.cells.slice(), line: row.line, file: options.fileName || '' } };
        const key = keyOf(transaction), ref = refOf(transaction);
        if (known.has(key)) return { line: row.line, status: 'duplicate', transaction, issues, warnings };
        if (ref && refs.has(ref) && refs.get(ref) !== key) throw new Error('This bank and tracking code already exist with different details. Resolve the conflict before importing.');
        known.add(key); if (ref) refs.set(ref, key);
      } catch (e) { issues.push(e.message); }
      return { line: row.line, status: issues.length ? 'invalid' : 'ready', transaction, issues, warnings };
    });
    return { errors, rows, ready: rows.filter(r => r.status === 'ready').map(r => r.transaction), duplicates: rows.filter(r => r.status === 'duplicate').length, invalid: rows.filter(r => r.status === 'invalid').length };
  }
  const api = { fields, digits, parseCSV, detectCSV, autoMap, parseAmount, parseDate, parseTime, validate, keyOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LedgerCSV = api;
})(globalThis);
