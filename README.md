# Ledger — Smart accounting

A responsive accounting workspace with a dashboard, cash-flow chart, spending breakdown, searchable transactions, invoices, monthly budgets, reports, CSV import/export, and JSON backups.

Run `npm start`, then open `http://localhost:3000`. No dependencies or build step are required. Set `PORT` to use another port.

Records are stored in browser localStorage. The first visit includes sample data; use Settings → Start with empty books to clear it. Marking an invoice paid creates an income transaction. Dashboard totals and budgets use the current calendar month. Cash balance includes all recorded transactions and the initial sample balance.

This is a single-device prototype, without authentication, cloud synchronization, tax calculations, or double-entry bookkeeping. Export backups before clearing browser data. Google Fonts are optional; system fonts are used offline.

Run `npm run check` for JavaScript syntax checks and `npm test` for accounting workflow checks. The workflow checks use a simulated DOM; they do not replace visual browser testing.

On Windows, if PowerShell blocks npm scripts, use `npm.cmd start`, `npm.cmd run check`, and `npm.cmd test`.

## Importing bank transactions

1. Click **Import CSV**. Choose a CSV/TSV file (maximum 5 MB and 10,000 transaction rows).
2. Select the encoding if necessary. UTF-8 is the default; Windows-1256 and UTF-16 are available for bank exports.
3. Check the detected separator, source calendar, date order, number format, and currency. If the file has no transaction type, explicitly select expenses, income, or positive-income/negative-expense amounts.
4. Review the column mappings. English and Persian headers are recognized. Price, recipient, date, and description/reason must be mapped. Supply the bank in a column or as a default. Time and tracking/backup codes may be blank, with a review note.
5. Click **Review transactions**. Invalid rows block the entire import. Fix the settings or source file before proceeding. The preview displays the first 100 rows; the downloadable validation report covers every row.
6. Click **Import transactions** to save. Nothing is added before this step. Storage failures leave the books unchanged.

Fields retained: price, recipient, date, time, description/reason, tracking/reference/backup code (کد پیگیری), originating bank, type, category, and currency. Original headers and row values are retained in JSON backups. Codes are text and keep their leading zeros. Amounts accept up to two decimal places; scientific notation and currency symbols in amount cells are rejected rather than guessed.

CSV supports quoted delimiters, escaped quotes, multiline descriptions, comma/semicolon/tab separators, and Persian/Arabic numerals. Select Gregorian or Jalali explicitly; ambiguous day/month order is never guessed. Jalali dates are normalized to Gregorian dates using the browser's Persian calendar, while retaining the source date. Times accept 24-hour HH:mm[:ss] or AM/PM and are stored without timezone conversion.

Exact transaction matches are skipped, including duplicates within one file. Reusing a bank and tracking code with different transaction details blocks the conflicting row. This is a conservative duplicate check: review the validation report if a bank legitimately reuses codes. Unknown categories retain their source text and are grouped into Other for expenses or Client payments for income.

Each workspace uses one currency: USD, IRR (rials), or IRT (tomans). No exchange-rate or rial/toman conversion is performed. To import a different currency, first download a backup and clear the existing books in Settings. Select the new currency during import and review/reset budget limits afterward. Sample books start in USD.

Examples: [English CSV](examples/transactions.csv) and [Persian CSV](examples/transactions-persian.csv). The Persian example uses Jalali dates and IRR. Exported CSV includes all seven requested fields. Spreadsheet programs may reformat numeric-looking codes when opening CSV; import directly into Ledger or explicitly mark code columns as text in your spreadsheet. Formula-like export values are prefixed with an apostrophe for spreadsheet safety; raw original values remain in JSON backups.

Run `node verify-browser.cjs` for real Chrome integration checks, using a temporary browser profile and isolated test server. Set `CHROME_PATH` if Chrome is installed elsewhere. The test requires free ports 3107 and 9339. Parser tests are included in `npm test`.
