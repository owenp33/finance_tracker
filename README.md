# Finance Tracker

A self-hosted personal finance dashboard for tracking spending across multiple bank accounts, managing monthly budgets, importing transactions from CSV/Excel exports, and exporting reports.

This README covers what the app does and how to run it. For how the backend is built (layers, conventions, data model, invariants, every API endpoint, and how to add a feature), see [docs/backend.md](docs/backend.md).

---

## Features

- **Multi-account support** — any number of bank accounts, each with its own starting balance and current balance
- **Transaction management** — add, edit, delete, and bulk-operate on transactions; filter by date, account, or category; over-budget transactions carry an "Over budget" chip
- **Transfers** — link paired transactions across accounts (auto-detected or manually paired); both balances reflect the move
- **Reimbursements** — flag positive transactions as reimbursements to offset category spending in budgets while still crediting the account balance normally
- **Recurring transactions** — templates repeat weekly, biweekly, monthly, quarterly, or annually; due occurrences appear automatically, an existing matching charge is linked instead of duplicated, and the Recurring tab suggests past transactions that belong to a series
- **Budget planning** — set monthly allocations per category with optional rollover; visual progress bars show spent vs. allocated; transactions within each category are expandable inline
- **CSV / Excel import** — two-step import (preview → confirm) supporting CSV, XLSX, and XLS exports from most banks; flexible column-name mapping handles varied export formats; accounts the file names that you don't have yet can be created, mapped to an existing account, or skipped
- **Insights** — spending reports and charts aggregated across all accounts
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
│   │   └── utils/              # Shared pure helpers (money, dates, sequencing)
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
Every amount is stored as an integer number of cents (negative = expense, positive = income); dollars appear only at the API boundary and in the frontend. Each account stores its current balance, which always equals its starting balance plus the sum of its transactions, and every change is applied as a single SQL update so simultaneous requests can't lose one. See [Data model](docs/backend.md#data-model) and [Invariants](docs/backend.md#invariants).

### Layers
Routes only parse requests and shape responses; business rules live in services, and `DbService` is the data-access layer, which keeps the logic testable without HTTP. See [Services](docs/backend.md#services) and [Conventions](docs/backend.md#conventions).

### Budgets and over-budget flags
A budget allows its amount plus any rolled-over money for one category and month. Whether a transaction is over budget is computed whenever transactions are read: walking the month's expenses in date order (reimbursements credited up front, transfers left out), every expense from the point the allocation is passed is flagged. Nothing is stored, so no edit can leave a flag out of date.

### Transfers
A transfer is a pair of transactions in different accounts with opposite amounts, linked to each other. Marking a transaction as a transfer links a matching counterpart within ±5 days when one exists; pairing creates the counterpart in the account you pick.

### Reimbursements
A reimbursement is a positive transaction that reduces its category's spending instead of counting as income: budgets subtract it from the month's spending (never below 0) and credit it up front in the over-budget walk. The account balance changes normally, since the money still reaches the account.

### Recurring series
Templates repeat every N days or N calendar months; monthly ones keep their day of the month and fall back to the month's last day (a template on the 31st lands on Feb 28). Generation is lazy: on login, on every page load, and daily at 00:05 (server time), each occurrence that has come due is created, so catch-up after downtime just works. A due occurrence first looks for the real charge (same account and vendor, exact amount, within ±3 days) and links it instead of creating a copy. The Recurring tab suggests unlinked past transactions that look like part of a series, points out possible duplicates, and remembers the ones you mark unrelated. See [Recurring transactions](docs/backend.md#recurring-transactions).

### CSV / Excel import
Import is two-step (preview → confirm) so the user can review and deselect rows before writing. The parser normalizes varied column names from different banks (`expense`, `withdrawal` → `amount`; `store` → `vendor`; etc.) and detects duplicates before insertion. Rows are matched to your accounts by the file's account column (by name or account ID); for names it doesn't know, you choose to create the account (flagged for review), put the rows into an existing account, or skip them. Encoding is detected in order: UTF-8-sig, UTF-8, Latin-1. See [Importing files](docs/backend.md#importing-files).

### Exports
Insights → Reports downloads a CSV or a PDF for a period (all time, a month, quarter or year, or custom dates) and any set of accounts. There is no category filter: an export covers every transaction of the chosen accounts in the period. Accounts with no transactions in the period are left out, and if none has any, the download says "No transactions in this period." instead of producing an empty file. Files are named after the period, e.g. `transactions_2026-01-01_to_2026-06-30.csv`; when a side is left open (all time), the first or last exported transaction's date fills it.

- **CSV**: one row per transaction, oldest first, with the columns `Bank Account, Date, Vendor, Category, Notes, Income, Expense, Running balance`. Income and expense are positive amounts in their own column. The running balance is that account's balance right after the row, counting its starting balance and everything before the period.
- **Re-importable**: the importer reads `Bank Account` as the account column and ignores `Running balance`, so importing an export on top of the same data finds every row a duplicate. Transfer and reimbursement marks aren't in the file; on import, rows in the `Transfer` or `Payment` categories are marked as transfers again.
- **Safe to open in a spreadsheet**: text that Excel, Sheets or LibreOffice would run as a formula (starting with `=`, `+`, `-`, `@`, a tab or a carriage return) gets a leading apostrophe, which the importer removes again.
- **PDF** (drawn with matplotlib): six summary pages (totals, monthly trends, spending and income by category, top vendors, a spending breakdown) that leave transfers out, then a section per account: its opening and closing balance, a balance-over-time chart, and its transactions with running balances, over-budget rows highlighted. Account pages include transfers, since that money really moved.

### Frontend data flow
There's no router: `App.js` switches between the Dashboard, Transactions, Budgeting, and Insights views, owns authentication and every mutation handler, and passes data down as props. Data fetching lives in custom hooks (`useAccounts`, `useTransactions`, `useBudgetData`, ...), and every request goes through `src/api/client.js`.

### SOLID in the budget UI
The budget UI follows SOLID principles explicitly:
- **SRP**: `BudgetRow`, `BudgetProgressBar`, `BudgetTransactionList`, `ColorPickerPopover`, and `AddBudgetForm` each have one job
- **OCP**: `BudgetProgressBar` accepts a `compact` prop to render in either the dashboard layout or the budget row layout without modifying the component
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
Runs on every push to `main`/`develop` and on PRs targeting `main`.
- **Backend**: pytest against SQLite in-memory — no PostgreSQL service needed
- **Frontend**: `npm ci` + Jest

### Deploy (`deploy.yml`)
Runs automatically after CI passes on `main`.
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

Passwords are stored as salted hashes (Werkzeug's `generate_password_hash`, scrypt by default), never in plain text. Registration and login return a JWT (24 h expiry). The token is stored in `localStorage` and sent as a `Bearer` header on all API requests; when it expires or is rejected, the app returns to the login screen with the reason. Every protected route verifies the token, then checks that the requested resource belongs to the authenticated user via ownership middleware decorators (`owns_account`, `owns_transaction`, etc.).

---

## API

Routes live under `/api/<domain>`: `auth`, `accounts`, `transactions`, `recurring`, `budgets`, `analytics`, `import`, and `export`. `GET /health` (outside `/api`) is the liveness check. Errors come back as `{"success": false, "error": "..."}`, with a 4xx status for bad input. Every endpoint is listed in [docs/backend.md § API reference](docs/backend.md#api-reference).
