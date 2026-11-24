# Finance Tracker

A self-hosted personal finance dashboard for tracking spending across multiple bank accounts, managing monthly budgets, importing transactions from CSV/Excel exports, and exporting reports.

This README covers what the app does and how to run it. For how the backend is built (layers, conventions, data model, invariants, every API endpoint, and how to add a feature), see [docs/backend.md](docs/backend.md).

---

## Features

- **Accounts** — bank, card, and loan accounts, each with a starting and current balance. An optional yearly interest rate books a charge monthly, quarterly, or yearly, which waits for your approval (edit, approve, or delete) before it touches the balance.
- **Transactions** — add, edit, filter, and bulk-edit; link transfers across accounts; mark reimbursements, which lower a category's spending in budgets.
- **Recurring series** — weekly to annual templates that add due payments automatically, link the real charge instead of duplicating it, and can pay down a loan. "Find recurring" spots series you haven't set up yet.
- **Budgets** — monthly allocations per category with optional rollover, and a pace bar showing whether each category is ahead, under, or over for the day, with bills still due this month.
- **Goals** — ordered savings and loan-payoff goals with a suggested monthly amount (income less bills and spending), a reach date, a loan payoff chart, and the plan month by month.
- **Dashboard** — this month at a glance: what's left to spend, income, expenses, and net against last month, budget pace, recent transactions, the active goal, a 90-day projection, and the next 30 days of scheduled payments.
- **Insights** — spending by category, net per month, top vendors, recurring costs and their timeline, and each account's balance over time with a 90-day forecast.
- **Import** — CSV, XLSX, and XLS files from most banks, previewed before anything is saved, with duplicate detection and flexible column names.
- **Exports** — a re-importable CSV with running balances, or a PDF report with summary charts and a page per account.

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
│   │   ├── styles/             # One stylesheet per feature; index.css imports them in cascade order
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

The essentials; [docs/backend.md](docs/backend.md) has the details.

- **Money** is stored as integer cents (negative = expense). An account's balance always equals its starting balance plus its transactions, and every change is a single SQL update, so simultaneous requests can't lose one. See [Invariants](docs/backend.md#invariants).
- **Layers**: routes parse requests and shape responses, services hold the business rules, and `DbService` does data access. See [Conventions](docs/backend.md#conventions).
- **Over-budget flags** are worked out whenever transactions are read, never stored, so no edit can leave one stale.
- **Transfers** are linked pairs of opposite transactions in two accounts, matched automatically within ±5 days.
- **Reimbursements** lower their category's spending in budgets and the forecast; everywhere else they count as income.
- **Recurring payments** are added lazily (at login, on page load, and daily), so catch-up after downtime just works. A due payment links the real charge (same vendor and amount, within ±3 days) instead of adding a copy. See [Recurring transactions](docs/backend.md#recurring-transactions).
- **Import** is two steps (preview, then confirm): column names from different banks are normalized, duplicates are found before anything is written, and a row matching an existing recurring payment replaces it. See [Importing files](docs/backend.md#importing-files).
- **Exports** cover any period and set of accounts. The CSV (`Bank Account, Date, Vendor, Category, Notes, Income, Expense, Running balance`) imports back cleanly, and text a spreadsheet would run as a formula is escaped. The PDF has summary charts, then each account's balance chart and transactions.
- **Frontend**: no router; `App.js` switches views and owns every change, custom hooks fetch data, and every request goes through `src/api/client.js`. The budget UI follows SOLID: single-purpose components, pace math in pure functions, and the view depends on a data hook rather than on fetch calls.

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

## Authentication and API

Passwords are stored as salted scrypt hashes. Logging in returns a JWT (24 h) sent as a `Bearer` header; every protected route checks it and that the requested record belongs to you. Routes live under `/api/<domain>` (`auth`, `accounts`, `transactions`, `recurring`, `budgets`, `goals`, `balances`, `interest`, `analytics`, `import`, `export`), `GET /health` is the liveness check, and errors come back as `{"success": false, "error": "..."}` with a 4xx status for bad input. Every endpoint is in [docs/backend.md § API reference](docs/backend.md#api-reference).
