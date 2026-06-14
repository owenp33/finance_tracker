# Finance Tracker

A self-hosted personal finance dashboard for tracking spending across multiple bank accounts, managing monthly budgets, and importing transactions from CSV/Excel exports.

---

## Features

- **Multi-account support** — manage any number of bank accounts with independent balance tracking
- **Transaction management** — add, edit, delete, and bulk-operate on transactions; filter by date, category, or over-budget status
- **Transfers** — link paired transactions across accounts (auto-detected or manually paired); balance adjustments reflect on both accounts
- **Reimbursements** — flag positive transactions as reimbursements to offset category spending in budgets while still crediting the account balance normally
- **Recurring transactions** — configure templates (weekly, monthly, custom frequency) that auto-generate on login and daily at midnight UTC
- **Budget planning** — set monthly allocations per category with optional rollover; visual progress bars show spent vs. allocated; transactions within each category are expandable inline
- **CSV / Excel import** — two-step import (preview → confirm) supporting CSV, XLSX, and XLS exports from most banks; flexible column-name mapping handles varied export formats
- **Insights** — spending reports and charts aggregated across all accounts

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Flask 3.1 + Flask-SQLAlchemy |
| Database | PostgreSQL 15 (SQLite for tests) |
| Auth | Flask-JWT-Extended (JWT, 24h expiry) |
| Background jobs | APScheduler |
| File parsing | pandas, openpyxl, xlrd |
| WSGI server | gunicorn |
| Frontend | React 18 |
| Charts | Recharts |
| Icons | Lucide React |
| Reverse proxy | nginx |
| Containers | Docker + Docker Compose |
| CI/CD | GitHub Actions + GitHub Container Registry |

---

## Project Structure

```
money/
├── backend/
│   ├── app.py                  # Flask app factory, migrations, startup
│   ├── extensions.py           # db, jwt, cors singletons
│   ├── wsgi.py                 # gunicorn entrypoint
│   ├── models/
│   │   ├── user.py
│   │   ├── account.py
│   │   ├── transaction.py
│   │   ├── recurring.py
│   │   └── budget.py
│   ├── routes/                 # Thin HTTP handlers (one file per domain)
│   ├── services/
│   │   ├── db_service.py       # Data access layer
│   │   ├── account_service.py  # Transaction + recurring business logic
│   │   ├── budget_service.py   # Budget progress and allocation
│   │   ├── analytics_service.py# CSV/Excel parsing + import logic
│   │   └── scheduler.py        # Daily recurring generation job
│   ├── middleware/
│   │   ├── ownership.py        # Decorators: verify JWT user owns resource
│   │   └── error_handlers.py
│   ├── Dockerfile
│   ├── .dockerignore
│   └── requirements.prod.txt
├── frontend/
│   ├── src/
│   │   ├── App.js
│   │   ├── App.css
│   │   ├── api/                # Per-domain fetch wrappers
│   │   ├── components/         # Views and UI components
│   │   └── hooks/              # Custom hooks (data fetching + business logic)
│   ├── nginx.conf
│   ├── Dockerfile
│   └── .dockerignore
├── .github/workflows/
│   ├── ci.yml                  # Run pytest + Jest on push/PR
│   └── deploy.yml              # Build images → push ghcr.io → SSH deploy
├── docker-compose.yml
├── .env.example
└── start-dev.sh                # Local dev startup script (WSL)
```

---

## Database Schema

All monetary amounts are stored as **integer cents** to avoid floating-point errors.

```
users
  id, username, email, password_hash, created_at

accounts
  id, user_id → users, acct_id_str, acct_name, balance_cents

transactions
  id, account_id → accounts, recurring_id → recurring
  date, vendor, category, amount_cents, notes
  over_budget (bool)          — re-evaluated on every write
  is_transfer (bool)          — paired cross-account movement
  transfer_peer_id → self     — bidirectional link to paired transaction
  is_reimbursement (bool)     — offsets category spending; still updates account balance normally

recurring
  id, account_id → accounts
  vendor, category, amount_cents, notes
  start_date, next_date, frequency (days), number (-1 = infinite), idx

budgets
  id, user_id → users
  category, period (YYYY-MM), amount_cents
  rollover (bool), carried_over_cents
  UNIQUE (user_id, category, period)
```

Negative `amount_cents` = expense. Positive = income or reimbursement.

---

## Key Design Choices

### Currency as integer cents
Floating-point arithmetic is unsuitable for money. Every amount is stored and computed as an integer number of cents (`amount_cents`). Display conversion to dollars happens at the API boundary and in the frontend.

### Service layer
Routes handle only HTTP parsing and response formatting. All business logic lives in services (`AccountService`, `BudgetService`, `AnalyticsService`). This makes the logic testable without HTTP context.

### Over-budget flagging
Rather than computing over-budget status at query time, a `_reevaluate_category_flags` pass runs after every transaction mutation. It walks a category's transactions chronologically, accumulates spending (with reimbursements pre-credited), and sets `over_budget = True` on each row once the cumulative total exceeds the allocation. This keeps the flag accurate at the row level, not just as an aggregate.

### Transfer linking
A transfer is a pair of transactions in different accounts with opposite-sign amounts, linked by `transfer_peer_id` (a self-referencing FK on the transactions table). When a transfer is toggled, the backend auto-detects a likely peer within ±5 days; if none exists, it creates a counterpart in the selected account with the negated amount.

### Reimbursements
A reimbursement is a positive transaction that should reduce a category's spending rather than inflate income. Setting `is_reimbursement = True` tells the budget service to subtract that amount from the category's spending total (clamped at 0) and pre-credit it in the over-budget flagging walk. Account balance is updated normally — the money still hits your account.

### Recurring generation
Recurring templates store a `next_date` and `frequency` (in days). Generation runs on login and daily at 00:05 UTC via APScheduler. Each call advances `next_date` by `frequency` days and increments `idx` until `idx > number` (or indefinitely if `number == -1`). This lazy approach means catch-up generation works correctly after downtime.

### CSV / Excel import
Import is two-step (preview → confirm) so the user can review and deselect rows before writing. The parser normalizes varied column names from different banks (`expense`, `withdrawal` → `amount`; `store` → `vendor`; etc.) and detects duplicates before insertion. Encoding is detected in order: UTF-8-sig, UTF-8, Latin-1.

### Frontend data flow
Each view has a corresponding custom hook that owns all data fetching and mutation logic (e.g., `useBudgetData`, `useTransactions`). Components are pure renderers that receive data and callbacks as props. This separation keeps components testable and the business logic reusable.

### SOLID in the budget UI
The budget UI follows SOLID principles explicitly:
- **SRP**: `BudgetRow`, `BudgetProgressBar`, `BudgetTransactionList`, `ColorPickerPopover`, and `AddBudgetForm` each have one job
- **OCP**: `BudgetProgressBar` accepts a `compact` prop to render in either the dashboard layout or the budget row layout without modifying the component
- **ISP**: `BudgetingView` pre-filters transactions by category and passes only the relevant slice to each `BudgetRow` — rows do not receive data they don't need
- **DIP**: `BudgetingView` depends on the `useBudgetData` hook abstraction, not directly on fetch calls

---

## Running Locally (WSL / Linux)

```bash
# Start everything (PostgreSQL + Flask + React)
bash start-dev.sh
```

The script starts PostgreSQL, activates the Python venv, launches Flask on `:5000`, and starts the React dev server on `:3000`. It cleans up all processes on Ctrl-C.

**Prerequisites:**
- WSL with PostgreSQL installed and a `finance_app` database
- Python venv at `backend/venv` with `requirements.prod.txt` installed
- Node.js 18+ with dependencies installed in `frontend/`

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

Registration and login return a JWT (24 h expiry). The token is stored in `localStorage` and sent as a `Bearer` header on all API requests. Every protected route verifies the token, then checks that the requested resource belongs to the authenticated user via ownership middleware decorators (`owns_account`, `owns_transaction`, etc.).

Recurring generation runs on login and on every page load (via `/api/auth/me`), ensuring newly due transactions appear immediately without a separate trigger.

---

## API Overview

All routes are prefixed with `/api`.

| Prefix | Purpose |
|---|---|
| `/auth` | register, login, current user |
| `/accounts` | account CRUD; account transactions with filters |
| `/transactions` | transaction CRUD; transfer link/unlink; bulk delete |
| `/recurring` | recurring template CRUD; manual generation |
| `/budgets` | budget CRUD; progress report |
| `/analytics` | spending report (per-account or aggregated) |
| `/import` | two-step import: preview (upload file) + confirm (write selected rows) |
| `/health` | liveness check |
