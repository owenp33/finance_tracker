# Finance Tracker

A self-hosted personal finance dashboard for tracking spending across multiple bank accounts, managing monthly budgets, importing transactions from CSV/Excel exports, and exporting reports.

This README covers what the app does and how to run it. For how the backend is built (layers, conventions, data model, invariants, every API endpoint, and how to add a feature), see [docs/backend.md](docs/backend.md).

---

## Features

- **Multi-account support** — any number of bank, card, and loan accounts, each with its own starting balance and current balance. Any account can have a yearly interest rate that hits monthly, quarterly, or yearly on the 1st (a loan is charged on what it owes; a bank account like savings is paid on a positive balance, as income), caught up for any months the app wasn't opened. A loan's transactions move only its balance and Net position, never income, spending or budgets. An account with a goal shows its progress on its row in the Accounts tab (how far along it is, what's left, and whether it's the active goal). A recurring series can pay a loan down ("Pays down" on the Recurring tab): each of its payments stays a bill in your bank account and also shows on the loan as a read-only "Loan entry" for the opposite amount, past payments included, listed under the loan in the Accounts tab
- **Transaction management** — add, edit, delete, and bulk-operate on transactions; filter by date, account, or category; over-budget transactions carry an "Over budget" chip
- **Transfers** — link paired transactions across accounts (auto-detected or manually paired); both balances reflect the move
- **Reimbursements** — flag positive transactions as reimbursements to offset category spending in budgets and the balance forecast while still crediting the account balance normally
- **Recurring transactions** — templates repeat weekly, biweekly, monthly, quarterly, or annually; due occurrences appear automatically, an existing matching charge is linked instead of duplicated, the Recurring tab suggests past transactions that belong to a series, and "Find recurring" spots series you haven't set up yet (ongoing or already ended)
- **Dashboard** — this month so far at a glance: what's left to spend of your budgets, plus income, expenses, and net, each compared with the same days of last month (Nov 1–5 against Oct 1–5, never a partial month against a whole one; transfers never count, and reimbursements count as income), the 5 budgets furthest ahead of pace (paced exactly as on the Budgeting page) and your recent transactions; then the active goal (where it stands, what to leave in savings or pay toward a loan this month, and when it's reached) (with a warning when the forecast dips under a goal you've already reached) beside a 90-day projection of your net position, with a small chart, by the same forecast as Insights; below them, the next 30 days of scheduled recurring charges and income, grouped by week, each with its amount and a running total
- **Budget planning** — set monthly allocations per category with optional rollover; each category's bar shows how much of its budget is spent, with a marker where spending should be today and the status in words ("$15 ahead", "$43 under", "On pace", "Over by $19.40"). Recurring charges still due this month appear as stripes after what's spent (orange, with a note, when they'd take the category over budget). The marker assumes even spending through the month unless the category is set to "Pace by recurring", which expects its recurring charges on their due dates (so an early subscription charge isn't called "ahead"). Hover or tap a bar for the expected spend, the bills still due, and where the month ends at this rate; transactions within each category are expandable inline
- **Goals** — on the Budgeting page, set a target balance on any account (savings up to an amount, a loan paid off) and put the goals in order: the first one not reached gets each month's room (scheduled income less scheduled bills and average spending over the next 90 days) or your own monthly amount, and the next takes over once it's reached; each goal shows its progress and when it's reached at that pace, a loan's with its interest and regular payments. A loan goal also charts what's owed month by month with that monthly amount and with its regular payments only, with the interest each way and where the regular payments alone leave it. This month's budgets show the active goal's saving beside them, with how much has gone to it so far, and Unallocated leaves it out. Insights → Accounts shows the same plan over time: a small chart per goal on one timeline until the last goal is reached (savings climbing to its target, a loan's balance falling), each hand-off from one goal to the next marked, and the months as a table
- **CSV / Excel import** — two-step import (preview → confirm) supporting CSV, XLSX, and XLS exports from most banks; flexible column-name mapping handles varied export formats; accounts the file names that you don't have yet can be created, mapped to an existing account, or skipped; a row that matches a recurring transaction already in the app can replace it instead of duplicating it
- **Insights** — spending reports and charts aggregated across all accounts. The Overview shows spending by category as one small chart per category (8 at most: the top 7, then Other), each a bar per month on its own scale with its monthly average dashed and the latest full month compared with it; reimbursements count as income and aren't taken off their categories (only budgets do that), so the categories add up to Total Expenses. Income by category is one line, and net per month is a bar chart around $0 (more in than out above, more out than in below) with a 3-month average drawn on the middle month of each three full months in a row. Top vendors are horizontal bars; click one for its charges, average, spending per month and latest transactions, and a toggle leaves out recurring charges so rent and loans don't dominate. The Recurring tab totals what your active recurring series cost per month (each at its scheduled amount, weekly and biweekly ones converted to a month) with a bar per series, ended ones lighter, and notes any series that paid beyond its schedule over the last 12 full months (the Transactions → Recurring tab shows the total too); its timeline draws each series from its first payment to its last, then what's still scheduled for the next three months, with a ring where the amount changed (Active, Ended, or All); hover or tap any payment to see how it compares with the series' typical payment, where it ranks in the series, and what share of that month's spending it was. The Accounts tab charts your net position or any one account's balance over the last 3 or 6 months, a year, or all time (a step line with a brush to zoom, and a $0 line when it crosses zero), with the current balance and how far it moved over the range; hover a day for its balance and transactions. Past today the line continues dashed as a 90-day forecast that learns from the last 90 days: a category mostly paid through recurring series (90% or more of its spending over the last 90 days, less reimbursements) is forecast by its scheduled charges on their dates, every other category by its average spending over the last 90 days, less reimbursements, spread evenly per day, and income only by scheduled income; series that have ended are left out, since they won't charge again. A loan is forecast by the scheduled payments of the series that pay it down, and any account with an interest rate by its interest on the 1st of each period, as it will be booked (a loan charged on what it owes, savings paid on what they hold); Net position includes them. An account with a goal shows it as a dashed line, with when the forecast reaches it, or a warning when the forecast dips under a goal already reached. "What the forecast assumes", under the chart, lists each category with its spending over the last 90 days, the reimbursements taken off, its share in recurring series, how it's forecast and what it adds over the next 90 days, plus the scheduled income and a total
- **Exports** — for any period and set of accounts, download a re-importable CSV with running balances, or a PDF report with summary charts plus each account's balance chart and transactions (over-budget rows highlighted)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Flask 3.1 + Flask-SQLAlchemy (SQLAlchemy 2.0) |
| Database | PostgreSQL 18 (SQLite for tests) |
| Auth | Flask-JWT-Extended (JWT, 24h expiry) |
| Background jobs | APScheduler |
| File parsing | pandas, openpyxl, xlrd |
| PDF reports | matplotlib |
| WSGI server | gunicorn |
| Frontend | React 18 (Create React App) |
| Charts | Recharts |
| Icons | Lucide React |
| Reverse proxy | nginx |
| Containers | Docker + Docker Compose |
| CI/CD | GitHub Actions + GitHub Container Registry |

---

## Project Structure

```
finance_tracker/
├── backend/                    # Flask API: models, routes, services, middleware, tests
│                               # (folder by folder: docs/backend.md § Layout)
├── frontend/
│   ├── src/
│   │   ├── App.js              # Views, authentication, and every mutation handler
│   │   ├── api/                # Per-domain wrappers; every request goes through api/client.js
│   │   ├── hooks/              # Data fetching (accounts, transactions, budgets, ...)
│   │   ├── components/         # Views and UI components (feature folders insights/, transactions/)
│   │   └── utils/              # Shared pure helpers (money, dates, sequencing, money rules, budget pace, recurring costs)
│   ├── nginx.conf
│   └── Dockerfile
├── docs/
│   └── backend.md              # Backend architecture reference
├── .github/workflows/
│   ├── ci.yml                  # Run pytest + Jest on push/PR
│   └── deploy.yml              # Build images → push ghcr.io → SSH deploy
├── docker-compose.yml          # Production-style stack (db + gunicorn + nginx)
├── docker-compose.dev.yml      # Local dev database only (Postgres 18)
├── .env.example
└── dev.ps1                     # One-command local dev (Windows PowerShell)
```

`legacy-flask/` and the leftovers in `backend/` listed in [docs/backend.md § Layout](docs/backend.md#layout) are unused code from earlier versions.

---

## How It Works

A short tour; [docs/backend.md](docs/backend.md) has the details behind each part.

### Money and balances
Every amount is stored as an integer number of cents (negative = expense, positive = income); dollars appear only at the API boundary and in the frontend. Each account stores its current balance, which always equals its starting balance plus the sum of its transactions, and every change is applied as a single SQL update so simultaneous requests can't lose one. The Accounts tab edits either side: type the starting balance and the current balance follows, or type the current balance your bank shows and the starting balance becomes it less the transactions. See [Data model](docs/backend.md#data-model) and [Invariants](docs/backend.md#invariants).

### Layers
Routes only parse requests and shape responses; business rules live in services, and `DbService` is the data-access layer, which keeps the logic testable without HTTP. See [Services](docs/backend.md#services) and [Conventions](docs/backend.md#conventions).

### Budgets and over-budget flags
A budget allows its amount plus any rolled-over money for one category and month. Whether a transaction is over budget is computed whenever transactions are read: walking the month's expenses in date order (reimbursements credited up front, transfers left out), every expense from the point the allocation is passed is flagged. Nothing is stored, so no edit can leave a flag out of date.

### Transfers
A transfer is a pair of transactions in different accounts with opposite amounts, linked to each other. Marking a transaction as a transfer links a matching counterpart within ±5 days when one exists; pairing creates the counterpart in the account you pick, and so does naming a To account when adding a transfer.

### Reimbursements
A reimbursement is a positive transaction that pays you back for spending in its category. It matters to budgets (the Budgeting page and the Dashboard's budget pace): they subtract it from its category's spending for the month (never below 0) and credit it up front in the over-budget walk. The balance forecast on Insights → Accounts also takes a category's reimbursements over the last 90 days off its spending, since it leaves the paybacks themselves out as irregular income. Everywhere else (the rest of Insights, the Dashboard's income and the PDF report) it's ordinary money in, counted as income. The account balance changes normally, since the money still reaches the account.

### Recurring series
Templates repeat every N days or N calendar months; monthly ones keep their day of the month and fall back to the month's last day (a template on the 31st lands on Feb 28). Generation is lazy: on login, on every page load, and daily at 00:05 (server time), each occurrence that has come due is created, so catch-up after downtime just works. A due occurrence first looks for the real charge (same account and vendor, exact amount, within ±3 days) and links it instead of creating a copy. The Recurring tab suggests unlinked past transactions that look like part of a series, points out possible duplicates, and remembers the ones you mark unrelated. Its **Find recurring** button looks for series you haven't set up yet: 4 or more payments to one vendor on one account, of a similar size, that keep one of the five schedules. Adding one creates a template linked to those payments; a series that has ended becomes a finished record that never adds transactions (listed under **Finished** at the bottom of the tab, with its last payment's date), and an ongoing one continues from its next date, so nothing in the past is ever generated. "Not recurring" hides a suggestion for good. See [Recurring transactions](docs/backend.md#recurring-transactions).

### CSV / Excel import
Import is two-step (preview → confirm) so the user can review and deselect rows before writing. The parser normalizes varied column names from different banks (`expense`, `withdrawal` → `amount`; `store` → `vendor`; etc.) and detects duplicates before insertion. Rows are matched to your accounts by the file's account column (by name or account ID); for names it doesn't know, you choose to create the account (flagged for review), put the rows into an existing account, or skip them. A row that looks like a recurring transaction already in the app (same account, within ±3 days, the same or a similar vendor name, an amount within 50%) is offered as its replacement: confirming it gives that transaction the bank's date and amount instead of adding a second copy, and a confirmed bank spelling counts as the series' own name next time. Encoding is detected in order: UTF-8-sig, UTF-8, Latin-1. See [Importing files](docs/backend.md#importing-files).

### Exports
Insights → Reports downloads a CSV or a PDF for a period (all time, a month, quarter or year, or custom dates) and any set of accounts. There is no category filter: an export covers every transaction of the chosen accounts in the period. Accounts with no transactions in the period are left out, and if none has any, the download says "No transactions in this period." instead of producing an empty file. Files are named after the period, e.g. `transactions_2026-01-01_to_2026-06-30.csv`; when a side is left open (all time), the first or last exported transaction's date fills it.

- **CSV**: one row per transaction, oldest first, with the columns `Bank Account, Date, Vendor, Category, Notes, Income, Expense, Running balance`. Income and expense are positive amounts in their own column. The running balance is that account's balance right after the row, counting its starting balance and everything before the period.
- **Re-importable**: the importer reads `Bank Account` as the account column and ignores `Running balance`, so importing an export on top of the same data finds every row a duplicate. Transfer and reimbursement marks aren't in the file; on import, rows in the `Transfer` or `Payment` categories are marked as transfers again.
- **Safe to open in a spreadsheet**: text that Excel, Sheets or LibreOffice would run as a formula (starting with `=`, `+`, `-`, `@`, a tab or a carriage return) gets a leading apostrophe, which the importer removes again.
- **PDF** (drawn with matplotlib): summary pages (totals, with income by category as one line; net per month as on Insights, bars around $0 with the 3-month average and a table, when the period covers two or more months; spending by category as on Insights, a small chart per category, 8 at most (the top 7 and Other), each with its monthly average, and a table; top vendors as on Insights, a bar each with its total, and a table; recurring costs as on Insights → Recurring, as of the day the report is made) that leave transfers out, then a section per account: its opening and closing balance, a balance-over-time chart, and its transactions with running balances, over-budget rows highlighted. Account pages include transfers, since that money really moved.

### Frontend data flow
There's no router: `App.js` switches between the Dashboard, Budgeting, Transactions, and Insights views, owns authentication and every mutation handler, and passes data down as props. Data fetching lives in custom hooks (`useAccounts`, `useTransactions`, `useBudgetData`, ...), and every request goes through `src/api/client.js`.

### SOLID in the budget UI
The budget UI follows SOLID principles explicitly:
- **SRP**: `BudgetRow`, `BudgetPace`, `BudgetTransactionList`, `ColorPickerPopover`, and `AddBudgetForm` each have one job; the pace arithmetic lives in pure functions (`src/utils/budgetPace.js`, which the Dashboard shares)
- **OCP**: `BudgetPace` draws whatever expected spend it's given (`evenExpectation`, or `scheduledExpectation` from the category's recurring charges), so a new way of pacing a category doesn't change the component
- **ISP**: `BudgetingView` pre-filters transactions by category and passes only the relevant slice to each `BudgetRow` — rows do not receive data they don't need
- **DIP**: `BudgetingView` depends on the `useBudgetData` hook abstraction, not directly on fetch calls

---

## Local Development

**Prerequisites:** Docker Desktop, Python 3.13 (pinned in `backend/.python-version`), Node.js 24 LTS (pinned in `frontend/.nvmrc`).

```powershell
.\dev.ps1            # Postgres (Docker) + Flask on :5000 + React on :3000
.\dev.ps1 -Lan       # same, but other devices on your Wi-Fi can open the app (trusted networks only)
.\dev.ps1 -Ngrok     # same, plus an ngrok tunnel to open the app from anywhere
```

The script starts Docker Desktop if needed, brings up the dev database (`docker-compose.dev.yml`), and installs backend and frontend dependencies on first run (and again whenever the backend requirements files or `package-lock.json` change). It then runs both servers in one window with labeled output. Ctrl+C stops everything; the database container is stopped but its data is kept.

By default both dev servers accept connections from this machine only, so nobody else on a shared or public network can reach the app. `-Lan` opens the React dev server to your network; Flask always stays on localhost behind React's `/api` proxy. If Windows Firewall asks about Node.js, allow it on **Private networks** only, so `-Lan` stays closed on public Wi-Fi as well.

No `.env` file is needed: the backend's defaults (see `backend/app.py`) match the dev database. To override one locally, put it in `backend/.env` (gitignored).

To run the pieces individually (any OS; on Windows use `venv\Scripts\` instead of `venv/bin/`):

```bash
docker compose -f docker-compose.dev.yml up -d
cd backend  && python -m venv venv && venv/bin/pip install -r requirements.dev.txt && venv/bin/python app.py
cd frontend && npm ci && npm start
```

To run the tests (neither suite needs the database; backend tests use in-memory SQLite):

```bash
cd backend  && venv/bin/python -m pytest tests/
cd frontend && npm test -- --watchAll=false
```

To erase the dev database and start fresh (this deletes everything in it): `docker compose -f docker-compose.dev.yml down -v`

**ngrok (optional):** install ngrok and run `ngrok config add-authtoken <token>` once. Only the React dev server is tunneled; it proxies `/api` requests to Flask, so a single tunnel covers the whole app.

---

## Running with Docker

```bash
cp .env.example .env
# Fill in POSTGRES_PASSWORD and JWT_SECRET_KEY

docker compose up --build
```

The app is available at `http://localhost` (port 80 by default). The frontend nginx container proxies `/api/*` to the Flask backend — no CORS issues, and the backend port is never exposed publicly.

To change the public port, set `PORT=8080` in `.env`.

---

## Environment Variables

Copy `.env.example` to `.env` and set:

| Variable | Required | Description |
|---|---|---|
| `POSTGRES_PASSWORD` | Yes | PostgreSQL password |
| `JWT_SECRET_KEY` | Yes | Long random string for signing JWTs |
| `PORT` | No | Host port for the frontend (default: 80) |
| `GUNICORN_WORKERS` | No | gunicorn worker count (default: 2) |
| `BACKEND_IMAGE` | No | Full ghcr.io image tag (for `docker compose pull` on server) |
| `FRONTEND_IMAGE` | No | Full ghcr.io image tag (for `docker compose pull` on server) |

Generate a JWT secret:
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

---

## CI/CD

Two GitHub Actions workflows automate testing and deployment.

### CI (`ci.yml`)
Runs on every push to `main` or `dev`, on pull requests into either, and by hand from the Actions tab ("Run workflow", any branch).
- **Backend**: pytest against SQLite in-memory — no PostgreSQL service needed
- **Frontend**: `npm ci` + Jest

### Deploy (`deploy.yml`)
Runs by hand for now (Actions → Deploy → Run workflow), until there's a server to deploy to and its secrets are set; then it can go back to running after CI passes on `main`.
1. Builds backend and frontend Docker images with layer caching
2. Pushes to GitHub Container Registry (`ghcr.io`) using the auto-provided `GITHUB_TOKEN`
3. SSHes into the production server and runs:
   ```bash
   docker compose pull
   docker compose up -d --remove-orphans
   docker image prune -f
   ```

**Required GitHub Secrets** (Settings → Secrets → Actions):

| Secret | Value |
|---|---|
| `SERVER_HOST` | Server IP or domain |
| `SERVER_USER` | SSH username |
| `SERVER_SSH_KEY` | Contents of the server's private SSH key |

**Server setup (one-time):**
```bash
mkdir ~/money-tracker
# Copy docker-compose.yml and create .env with real values
# Uncomment and set BACKEND_IMAGE / FRONTEND_IMAGE in .env
```

---

## Authentication

Passwords are stored as salted hashes (Werkzeug's `generate_password_hash`, scrypt by default), never in plain text. Registration and login return a JWT (24 h expiry). The token is stored in `localStorage` and sent as a `Bearer` header on all API requests; when it expires or is rejected, the app returns to the login screen with the reason, which goes away once you log back in. Every protected route verifies the token, then checks that the requested resource belongs to the authenticated user via ownership middleware decorators (`owns_account`, `owns_transaction`, etc.).

---

## API

Routes live under `/api/<domain>`: `auth`, `accounts`, `transactions`, `recurring`, `budgets`, `analytics`, `import`, and `export`. `GET /health` (outside `/api`) is the liveness check. Errors come back as `{"success": false, "error": "..."}`, with a 4xx status for bad input. Every endpoint is listed in [docs/backend.md § API reference](docs/backend.md#api-reference).
