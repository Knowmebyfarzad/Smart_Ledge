# Ledger — Smart accounting

A responsive accounting workspace with a dashboard, cash-flow chart, spending breakdown, searchable transactions, invoices, monthly budgets, reports, CSV import/export, and JSON backups.

Requires Node.js 24 or later. Run `npm start`, then open `http://localhost:3000`. No packages or build step are required. On Windows PowerShell, use `npm.cmd start` if PowerShell blocks `npm.ps1`.

## First administrator and users

1. Start the server and open the app. The first visit shows **Create your administrator**.
2. On the server computer, open `.data/setup-code.txt`. Paste its one-time code into the setup form and choose your name, email, and password. The code is never served through the website and stops working after setup.
3. Open **Settings → Users and access → Create user**. Choose a member or administrator role and a temporary password of at least 12 characters.
4. Share the login address, email, and temporary password privately. Users must replace temporary passwords before opening their books. The app does not send emails.

Every user starts with empty books and has separate transactions, invoices, budgets, currency, and CSV imports. Administrators manage accounts and reset passwords; the accounting API always uses the signed-in user's own workspace. Users can change their own passwords in Settings. Disabling an account, resetting its password, or changing a password revokes its other active sessions. Sign out ends the current session.

The server stores accounts and records in `.data/ledger.sqlite`; session tokens use HTTP-only cookies, and passwords are stored as salted scrypt hashes. Records are accessible on other devices by signing in to the same server. Concurrent edits are checked by workspace version: if another device saved first, reload the latest records before retrying. A failed or uncertain save keeps the browser's previous state and requires reloading before further changes.

Dashboard totals and budgets use the current calendar month. Marking an invoice paid records the income. Cash balance includes all recorded transactions and the opening balance. This app does not implement tax calculations, bank connections, or double-entry bookkeeping.

## Existing browser records and backups

Old browser records are not automatically assigned to whoever signs in. In the original browser and at the original address, the administrator can choose **Settings → Transfer old browser records** to move them into empty books. The local copy is removed only after the server confirms the save. If moving from `localhost` to a domain, transfer at the original address first, or export a JSON backup from the old workspace and restore it using **Settings → Restore JSON backup**. Browser storage is separate for different addresses.

JSON restore requires empty books and validates the records on the server. CSV exports and JSON backups include only the signed-in user's records. Keep a backup before clearing books. For a full server backup, stop the server, copy the entire `.data` directory to protected storage, then restart. That backup contains account credentials and sessions as well as all users' records; protect it accordingly. The database is not encrypted at rest, and the server operator can access it. Password recovery is handled by another administrator; there is no email recovery service.

## Domain and tunnel setup

For database inspection and manual maintenance, see [Opening the database in Beekeeper Studio](#opening-the-database-in-beekeeper-studio).

Complete administrator setup locally first. Copy `.env.example` to `.env` in the project directory and edit it:

```dotenv
PORT=3000
PUBLIC_ORIGIN=https://accounts.your-domain.com
LEDGER_DATA_DIR=.data
```

Replace the example with your exact HTTPS address, without a path. Restart using `npm start` (or `npm.cmd start`). Configure your tunnel/reverse proxy to forward that address to `http://127.0.0.1:3000`, preserving cookies and request Origin. The server binds to loopback; keep the tunnel agent on the same machine. When `PUBLIC_ORIGIN` is set, open the app through that HTTPS domain; HTTP localhost writes are intentionally rejected, and existing local-development sessions must sign in again. Changing the domain also requires updating `PUBLIC_ORIGIN` and restarting. `.env` is loaded by the npm start/dev commands; running `node server.js` directly uses only environment variables already set in the shell.

For local-only development, leave `PUBLIC_ORIGIN` empty. Do not publish the app over plain HTTP. The configured HTTPS mode adds Secure session cookies, origin checks, and HTTPS response headers. The proxy must actually terminate HTTPS; forwarded headers alone do not configure the app. Public account registration is closed. Sign-in attempts are rate limited, sessions expire after 12 hours, and JSON APIs require a session plus CSRF protection for changes. Google Fonts are optional; system fonts are used if unavailable.

The domain/tunnel itself must be configured in your hosting or tunnel provider. Setting `PUBLIC_ORIGIN` does not create a tunnel or DNS record. Keep the server running and preserve its data directory across restarts/deployments.

Run `npm run check` for JavaScript syntax checks and `npm test` for accounting, CSV, and real HTTP authentication tests. The account tests use isolated temporary databases, including separate-user authorization, session revocation, save conflicts, server restart persistence, and HTTPS configuration. Use `npm run test:browser` for actual Chrome login and CSV workflows. On Windows, substitute `npm.cmd` if needed.

## Importing bank transactions

1. Click **Import CSV**. Choose a CSV/TSV file (maximum 5 MB and 10,000 transaction rows).
2. Select the encoding if necessary. UTF-8 is the default; Windows-1256 and UTF-16 are available for bank exports.
3. Check the detected separator, source calendar, date order, number format, and currency. If the file has no transaction type, explicitly select expenses, income, or positive-income/negative-expense amounts.
4. Review the column mappings. English and Persian headers are recognized. Price, recipient, date, and description/reason must be mapped. Supply the bank in a column or as a default. Time and tracking/backup codes may be blank, with a review note.
5. Click **Review transactions**. Invalid rows block the entire import. Fix the settings or source file before proceeding. The preview displays the first 100 rows; the downloadable validation report covers every row.
6. Click **Import transactions** to save to your signed-in account. Nothing is added before this step. On a connection failure, reload your latest records before retrying: the server may have saved even if the response was lost.

Fields retained: price, recipient, date, time, description/reason, tracking/reference/backup code (کد پیگیری), originating bank, type, category, and currency. Original headers and row values are retained in JSON backups. Codes are text and keep their leading zeros. Amounts accept up to two decimal places; scientific notation and currency symbols in amount cells are rejected rather than guessed.

CSV supports quoted delimiters, escaped quotes, multiline descriptions, comma/semicolon/tab separators, and Persian/Arabic numerals. Select Gregorian or Jalali explicitly; ambiguous day/month order is never guessed. Jalali dates are normalized to Gregorian dates using the browser's Persian calendar, while retaining the source date. Times accept 24-hour HH:mm[:ss] or AM/PM and are stored without timezone conversion.

Exact transaction matches are skipped, including duplicates within one file. Reusing a bank and tracking code with different transaction details blocks the conflicting row. This is a conservative duplicate check: review the validation report if a bank legitimately reuses codes. Unknown categories retain their source text and are grouped into Other for expenses or Client payments for income.

Each workspace uses one currency: USD, IRR (rials), or IRT (tomans). No exchange-rate or rial/toman conversion is performed. New empty books default to USD but can use any supported currency on their first import. To change currency after recording transactions, export a backup and clear your books in Settings first. Clearing books also clears budget limits.

Examples: [English CSV](examples/transactions.csv) and [Persian CSV](examples/transactions-persian.csv). The Persian example uses Jalali dates and IRR. Exported CSV includes all seven requested fields. Spreadsheet programs may reformat numeric-looking codes when opening CSV; import directly into Ledger or explicitly mark code columns as text in your spreadsheet. Formula-like export values are prefixed with an apostrophe for spreadsheet safety; raw original values remain in JSON backups.

Run `node verify-browser.cjs` for real Chrome integration checks, using a temporary browser profile and isolated test server. Set `CHROME_PATH` if Chrome is installed elsewhere. The test requires free ports 3107 and 9339. Parser tests are included in `npm test`.

## Opening the database in Beekeeper Studio

The database is SQLite. In this project its default location is `F:\Smart_acounting\.data\ledger.sqlite`. If you set `LEDGER_DATA_DIR`, use `ledger.sqlite` in that directory instead. Create a connection in Beekeeper Studio, choose **SQLite**, select this file, then connect. No database host, port, or database password is needed. Your app login password is unrelated to this file connection. Select `ledger.sqlite`, not the adjacent `-wal` or `-shm` files; leave those files in place.

| Table | Contents |
| --- | --- |
| `users` | Account ID, display name, email, role, disabled flag, password hash, and password-change flag. The greeting uses `users.name`. |
| `workspaces` | One row per user, linked by `user_id`. The `data` column stores transactions, invoices, budgets, currency, and opening balance as JSON. `version` prevents outdated app saves. |
| `sessions` | Login session hashes, CSRF tokens, and expiry times. |
| `attempts` | Sign-in rate-limit counters. |

There is currently no separate `transactions` table. Open [database-queries.sql](database-queries.sql) in Beekeeper's SQL editor and run the selected query to list users, display transactions as rows, or inspect workspace counts. These queries only read data; the transaction query is a view of the JSON and is not an editable transaction table.

For direct edits, stop the app and back up the entire `.data` directory first. Edit account names/emails in `users`, or accounting records in `workspaces.data` while preserving the existing JSON structure. When changing `workspaces.data`, also increase that row's `version` by one so an older browser tab cannot silently overwrite your edit. Restart the server and reload records in the app afterward. Creating users, resetting passwords, and disabling access through the app is preferred because those actions also maintain workspace/session records. Do not replace `password_hash` with a plain-text password or delete a `users` row by itself.
