# Backend architecture

How the Flask backend is organized, the rules its code follows, and the invariants every change
must keep. Setup, running, and deployment are covered in the [README](../README.md).

**Keep this file current.** A change to a service, endpoint, model, or invariant updates the
matching section here in the same commit.

1. [Layout](#layout)
2. [How a request flows](#how-a-request-flows)
3. [Conventions](#conventions)
4. [Services](#services)
5. [Data model](#data-model)
6. [Invariants](#invariants)
7. [Importing files](#importing-files)
8. [Recurring transactions](#recurring-transactions)
9. [API reference](#api-reference)
10. [Schema changes](#schema-changes)
11. [Testing](#testing)
12. [Adding a feature](#adding-a-feature)
13. [Known limitations](#known-limitations)

---

## Layout

```
backend/
├── app.py                 create_app(): config, extensions, CORS, blueprints, error handlers,
│                          table creation, schema migrations, scheduler
├── wsgi.py                gunicorn entrypoint (wsgi:application)
├── extensions.py          the shared db (Flask-SQLAlchemy) and jwt (Flask-JWT-Extended) instances
├── models/                one SQLAlchemy model per file
├── routes/                one blueprint per domain: thin HTTP handlers
├── services/              business logic, data access, file parsing, the background scheduler
├── middleware/            ownership checks, request-body parsing, global error handlers
├── tests/                 pytest suite (in-memory SQLite)
├── requirements.prod.txt  runtime dependencies (the Docker image)
└── requirements.dev.txt   runtime + test tools (local venv, CI)
```

Other files in `backend/` (`legacy/`, `tests.py`, the sample CSV and JSON files, the npm files) are
unused leftovers from earlier versions. Don't build on them.

**Configuration** comes from environment variables, with development defaults in `create_app()`:

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres:password@localhost:5432/finance_app` | Matches the dev database in `docker-compose.dev.yml` |
| `JWT_SECRET_KEY` | a development placeholder | Must be set to a long random value in production |
| `FRONTEND_URL` | empty | An extra allowed CORS origin |

A local `backend/.env` (gitignored) is loaded when present. Access tokens expire after 24 hours.

---

## How a request flows

```
HTTP request
  → route (routes/*.py)       @jwt_required(), then an owns_* decorator or a query scoped by user id
  → service (services/*.py)   business rules; raises ValueError for bad input
  → DbService and models      reads and writes through Flask-SQLAlchemy
  → route                     shapes the JSON reply
```

`create_app()` registers nine blueprints, and `app.py` is the only place blueprints are registered:
`health` without a prefix, and `auth`, `accounts`, `transactions`, `recurring`, `analytics`,
`import`, `budgets`, and `export` under `/api/<name>`.

**Middleware**
- `middleware/ownership.py`: `owns_account`, `owns_transaction`, `owns_recurring`, `owns_budget`.
  Each loads the resource named in the URL and rejects the request unless it belongs to the
  token's user: 403 for someone else's resource, 404 for a missing one (`owns_account` answers 403
  in both cases).
- `middleware/request_body.py`: `json_body()` returns the JSON body as a dict, or `{}` when it is
  missing, malformed, or not an object.
- `middleware/auth_errors.py`: a missing, expired, or invalid access token gets a 401 in the usual
  error shape with a message for the user ("Your session has expired. Please log in again."),
  instead of Flask-JWT-Extended's default `{'msg': ...}` (or 422). The frontend treats any 401 on a
  protected request as "back to the login screen".
- `middleware/error_handlers.py`: a Werkzeug `HTTPException` (404, 405, 415, ...) keeps its status
  code. Its message is the specific description when one was given, else the short name such as
  "Not Found". Any other exception is a bug: it is logged with its traceback, and the client gets a
  generic `Internal server error` 500. Exception details never reach the client.

---

## Conventions

- **Thin routes.** A route parses and validates input, calls a service, and shapes the response.
  No ORM queries, business rules, or rendering (CSV, PDF, charts) in `routes/`.
- **Services own the rules.** `DbService` is data access only: reads and writes, no rules. The
  other services hold the business logic and use `DbService` and the models.
- **Errors.** A service raises `ValueError` with a message the user can read, and the route maps it
  to a 400 (`RegistrationConflict`, a `ValueError` subclass, maps to 409). Bad input must never
  produce a 500. Read request bodies with `json_body()`, not `request.get_json()` plus `data['key']`.
- **Response shape.** `{'success': True, ...}` on success, `{'success': False, 'error': message}`
  on failure.
- **Money is integer cents** in storage and arithmetic. Dollars appear only at the API boundary,
  through the models' dollar properties (`amount`, `balance`, `carried_over`).
- **Authorization.** Every resource route uses `@jwt_required()` plus an `owns_*` decorator, or
  scopes its query by the token's user id. The JWT identity is the user id **as a string**, so
  compare it with `int()`.
- **One domain per file** in `models/`, `routes/`, and `services/`. Services are exported from
  `services/__init__.py`. Route modules create their service instances at import time
  (`account_service = AccountService()`); services keep no state between calls.
- **Shared helpers live in one place.** No copy-pasted parsing, formatting, or period math.
- **Comments state intent or contract**, not history.
- **Tests come with the change.** New endpoints and service methods get pytest coverage in the same
  commit.

---

## Services

**`DbService`** (`db_service.py`): data access. CRUD and lookups for users, accounts,
transactions, recurring templates, and budgets, plus two queries used by business logic:
`transaction_exists` (the import duplicate check), `find_transfer_peer` (an unlinked transfer
with the opposite amount in another of the user's accounts, within ±5 days; the earliest such
match wins), `find_recurring_candidates` (transactions in no recurring series with a given
account, vendor and amount, within a window of days around a date, nearest first), and
`find_unlinked_transactions` (the looser suggestion query: vendor, direction, and category or
exact amount, within a date range), `get_series_transactions` (transactions in any recurring
series on some accounts between two dates, for the import preview's recurring matches),
`get_budget_activity` (a user's non-transfer expenses and
reimbursements in some categories between two dates, for budget flags), and
`get_transaction_totals_before` (one grouped query: each
account's transaction total before a date, for ledger opening balances). It also owns the only
two ways to change a stored balance, `adjust_balance` and `recompute_balance` (see Invariants).

**`AccountService`** (`account_service.py`): accounts, transactions, and transfers.
- `create_account(user_id, data)` takes `account_id` (required) and `account_name` (defaults to
  the id string), validated the same way as editing (trimmed, non-empty text, at most 100).
- `update_account(account_id, data)` accepts `account_name`, `account_id` (the account's id string),
  `opening_balance` (the starting balance, in dollars), and `needs_attention`, which may only be
  set to `false`. Names and id strings are trimmed and must be non-empty text within the column
  length (100). The starting balance must be a finite number within ±`MAX_OPENING_BALANCE`
  ($10,000,000, which keeps `balance_cents` far from the 32-bit integer limit); changing it moves
  the balance by the same amount. Invalid input raises `ValueError` before anything changes; the
  messages name the fields as the edit form shows them ("Display name", "Account ID", "Starting
  balance"). Sending any of these keys clears `needs_attention`. Returns `(account, error)`.
- `delete_account` unlinks the account's transfers, then deletes it; its transactions and
  recurring templates cascade.
- `add_transaction`, `update_transaction`, `delete_transaction` keep the account balance in step
  with every change (over-budget flags are computed on read; see `BudgetFlagService`).
- Transfers: `link_transfer`, `unlink_transfer` (clears the flag and the link on both sides),
  `break_transfer_link` (removes the pairing but keeps both flagged), and `create_transfer_pair`
  (creates the mirrored counterpart in another account and links the two).
- `recalculate_account_balance(account_id)` resets `balance_cents` to the starting balance plus
  the sum of the account's transactions.

**`RecurringService`** (`recurring_service.py`): recurring templates (`add_recurring`,
`update_recurring`, `delete_recurring`), generating their due occurrences
(`process_due_recurring`), and series membership (`match_candidates`, `link_transaction`,
`unlink_transaction`, `suggest_matches`, `dismiss_suggestion`, `undo_dismissal`,
`replace_occurrence` and `remember_alias` for imports, and `template_dict` for API
responses); see [Recurring transactions](#recurring-transactions). Occurrences are
created through `AccountService.add_transaction`, so balances have one code path.
Deleting a single generated transaction (which shrinks its series) is still handled by
`AccountService.delete_transaction`.

**`BalanceService`** (`balance_service.py`): read-only account ledgers for the exports.
`ledgers(user_id, account_ids=None, start_date=None, end_date=None)` returns one `AccountLedger`
per account (id order; accounts without activity included): `opening_cents` (starting balance
plus every transaction before the period), `rows` (each transaction in the period, date then id
order, as a `LedgerRow` with the balance right after it), and `closing_cents`. Transfers and
reimbursements count. Both dates are inclusive and optional; an account that isn't the user's,
or a start after the end, raises `ValueError`. The arithmetic is the pure function
`running_balances(opening_cents, transactions)`. Ledgers are computed from the transactions
themselves, so with no dates `closing_cents` equals the stored `balance_cents` whenever that
cache is correct.

**`BudgetFlagService`** (`budget_flag_service.py`): which expenses are over budget, computed
when transactions are read. `over_budget_ids(user_id, transactions)` returns the ids among the
given transactions that are over budget (counting all of the user's spending in each
category-month involved: one query for budgets, one for the expenses and reimbursements);
`transaction_dicts(user_id, transactions)` serializes transactions with `over_budget` filled in,
and every route that returns transactions uses it. The walk itself is the pure function
`over_budget_in_month(expenses, reimbursed_cents, allocated_cents)`.

**`BudgetService`** (`budget_service.py`): `get_budget_progress(user_id, period)` returns, per
budgeted category, spending (expenses minus reimbursements, never below 0; transfers excluded)
against the allocation (`amount + carried_over`). `delete_budget` also deletes the budget's
future rollover copies. Budget changes don't touch transactions: over-budget flags are computed
when transactions are read (`BudgetFlagService`), so they follow every budget change on their own.

**`AuthService`** (`auth_service.py`)
- `register(username, email, password)` trims the username and email, lowercases the email, and
  validates: all three required, lengths within the columns, a plausible email, and a password of
  at least `MIN_PASSWORD_LENGTH` (8) characters. It raises `ValueError` for invalid input and
  `RegistrationConflict` when the username or email is taken, including when a concurrent
  registration wins the race.
- `authenticate(username, password)` returns the user or `None`.
- `issue_token(user)` is the only place access tokens are created.
- Hashing lives on the `User` model (`set_password`, `verify_password`).

**`AnalyticsService`** (`analytics_service.py`): reporting only. `generate_report(transactions)`
builds the summary (totals, monthly trends, category and vendor breakdowns) behind
`/api/analytics` and the PDF report.

**Reports** (`services/reports/`, the export files):
- `filters.py`: `ExportFilters` (account ids, start and end dates; no account ids means all of
  the user's accounts) and `parse_export_filters(args)`, which reads them once from the query
  string and raises `ValueError` with a message for the user (a bad id list, a malformed date, a
  start after the end). There is no category filter: an export covers every transaction of the
  chosen accounts in the period.
- `csv_export.py`: `ledger_csv(rows)`, the CSV text from `LedgerRow`s. Columns: Bank Account,
  Date (ISO), Vendor, Category, Notes, Income, Expense, Running balance. Income and expense are
  positive amounts in their own column, the other left blank (a zero amount is income); the
  running balance is the row's own account's balance right after it. The file imports again:
  the importer reads "Bank Account" as the account and ignores "Running balance", so
  re-importing an export finds every row a duplicate (tested). Transfer and reimbursement marks
  aren't in the file; an import flags only `Transfer` / `Payment` categories as transfers.
  Text cells (Bank Account, Vendor, Category, Notes) go through `formula_guard.guard`; numbers
  don't, so a negative running balance stays a number.

**`formula_guard`** (`formula_guard.py`): keeps exported CSV text from running as a spreadsheet
formula. `guard(text)` puts an apostrophe in front of text that starts (after any apostrophes)
with `=`, `+`, `-`, `@`, a tab, or a carriage return; spreadsheets show it as plain text.
`unguard(text)` removes exactly that apostrophe, and `import_parser` applies it to the vendor,
category, notes and account columns, so an export imports back exactly. Text without the
pattern (e.g. `'Til Midnight`) is left alone both ways.
- `pdf_pages.py`: the matplotlib pages. Up to six summary pages (summary, monthly trends,
  category pies, top vendors, spending breakdown), one function each, drawn from
  `AnalyticsService.generate_report` data; they leave transfers out. `ReportService` adds the
  monthly trends page only when there are at least `MIN_TREND_MONTHS` (2) months of data: one
  month would be three lone points repeating the summary page's totals. Then
  `render_account_pages(pdf, ledger, over_budget_ids, period_label, start_date, end_date)` per
  account: a first page with the opening and closing balance, the balance over the period as a
  step line, and the first `FIRST_PAGE_ROWS` rows of the transaction table (Date, Vendor,
  Category, Amount, Balance, Budget), then `CONTINUED_ROWS` rows a page. Account pages include
  transfers (the page says so); over-budget rows get a light red band and "Over" in the Budget
  column. The pure pieces `account_page_chunks` and `account_table_rows` are tested directly.
  Text that can hold a `$` is drawn with `parse_math=False` (matplotlib would read `$…$` as
  math).
- `report_service.py`: `ReportService.csv(user_id, filters)` and `.pdf(user_id, filters)` build
  the files from the `BalanceService` ledgers of the chosen accounts, leaving out accounts with
  no transactions in the period. Transactions are listed by date, then account id, then id. When
  no account has any, or an account isn't the user's, they raise `ValueError`
  ("No transactions in this period." / "Unknown account: …"). The PDF's over-budget marks come
  from `BudgetFlagService.over_budget_ids` over every exported transaction. Each returns an
  `ExportFile` (content, mimetype, filename). The export's period is the chosen dates, with an
  open side filled from its first or last transaction (`_period`); it names the files
  (`transactions_<start>_to_<end>.csv`, `report_<start>_to_<end>.pdf`), is the PDF's period
  label, and is the range every account's balance chart covers. `routes/export.py` only parses
  the filters, calls the service (400 on a `ValueError`) and sends the file under its name.

**`ImportService`** (`import_service.py`) and **`import_parser`** (`import_parser.py`): file
import; see [Importing files](#importing-files).

**`vendor_match`** (`vendor_match.py`, pure functions): compares a file row's vendor and amount
with a recurring series' for the import preview. `vendor_key` is the exact rule (case and
surrounding spaces ignored, as in the database queries); `clean_vendor` reduces a name to its
lowercase words without a card processor's prefix (`SQ *`, `TST*`, `PAYPAL *`), apostrophes,
digits or punctuation; `vendor_match(vendor, names, aliases=())` returns `'exact'` (equal to a
name, or its cleaned spelling is one of the aliases), `'similar'` (one cleaned name contains the
other as whole words: "ANTHROPIC.COM CA" and "Anthropic") or `None`; and
`amount_close` accepts an amount moving money the same way within `AMOUNT_TOLERANCE_PERCENT`
(50%) of the series'.

**`scheduler`** (`scheduler.py`): background generation of recurring transactions; see
[Recurring transactions](#recurring-transactions).

---

## Data model

Models live in `backend/models/`, one per file. Amounts are integer cents with a dollar property.

| Table | Key columns |
|---|---|
| `users` | `username` (unique, ≤ 50), `email` (unique, ≤ 120), `password_hash` (≤ 255), `created_at` |
| `accounts` | `user_id`, `acct_id_str` (the bank's label, e.g. "Discover 1234"; ≤ 100), `acct_name` (≤ 100), `balance_cents`, `opening_balance_cents`, `needs_attention` |
| `transactions` | `account_id`, `date`, `vendor` (≤ 100), `category` (≤ 50), `amount_cents`, `notes`, `is_transfer`, `transfer_peer_id`, `is_reimbursement`, `recurring_id`, `recurring_index` |
| `recurring` | `account_id`, `start_date`, `next_date`, `frequency` with `frequency_unit` (`days` or `months`), `day_of_month` (monthly templates), `number` (-1 = no limit), `idx`, `vendor`, `category`, `amount_cents`, `notes` |
| `budgets` | `user_id`, `category`, `period` (`YYYY-MM`), `amount_cents`, `rollover`, `carried_over_cents`; unique per `(user_id, category, period)` |
| `recurring_dismissals` | `(recurring_id, transaction_id)` primary key: a transaction the user said isn't part of that series; deleted with either side |
| `recurring_aliases` | `(recurring_id, alias)` primary key: another vendor spelling (as `clean_vendor` leaves it, ≤ 100) the user confirmed for that series; deleted with the template |

The API calls the account fields `account_id` (`acct_id_str`) and `account_name` (`acct_name`);
the account's database id is `id`.

---

## Invariants

Every change must keep these true.

- **Sign.** `amount_cents < 0` is an expense; `> 0` is income or a reimbursement.
- **Balance = starting balance + transactions.** `balance_cents` always equals
  `opening_balance_cents` plus the sum of the account's `amount_cents`. The starting balance is
  what the account held before its earliest transaction in the app. It is a field on the account,
  not a transaction, so it never counts as income in reports, budgets, or analytics. Importing
  older history later means lowering it by that history's total.
- **Balances are maintained incrementally.** Every path that changes transactions adjusts
  `account.balance_cents` in the same commit: add, update (including moving to another account),
  delete, transfer pairing, deleting a recurring template with its generated transactions, and
  an import replacing a series transaction's amount.
  Changing the starting balance moves the balance by the difference. Import confirm resyncs each
  affected account with `recalculate_account_balance`. A new mutation path must keep the balance
  correct.
- **Balance changes are atomic.** The stored balance changes only through
  `DbService.adjust_balance(account_id, delta)` (`balance_cents = balance_cents + delta`) and
  `DbService.recompute_balance(account_id)` (starting balance plus the database's own sum), each a
  single SQL statement, so simultaneous requests can't overwrite each other's change. Never read
  `balance_cents`, add in Python, and write it back.
- **`over_budget` is computed when transactions are read** (`BudgetFlagService`). For each
  category-month with a budget, it walks the month's non-transfer expenses in date order,
  credits the month's reimbursements up front, and flags each expense from the point cumulative
  spending passes the allocation (amount + carried over). API responses always carry the
  computed value, so no change can leave a flag stale; nothing about flags is stored (the old
  `transactions.over_budget` column was dropped).
- **Transfers** are excluded from analytics, budget progress, and over-budget flags. A pair is
  linked both ways through `transfer_peer_id`; editing one side syncs the date, vendor, category,
  notes, and negated amount to the other. Unlink a pair before deleting either side (the foreign
  key is circular).
- **Accounts created by an import** start with `needs_attention = True`. Editing the account's
  name, id string, or starting balance, or sending `needs_attention: false` ("Looks good"),
  clears it.
- **Passwords** are stored only as Werkzeug hashes (scrypt by default, 162 characters, hence the
  255-character column). Plaintext is never stored or compared.
- **`MIN_PASSWORD_LENGTH`** (8) is defined in both `services/auth_service.py` and the frontend's
  `AuthScreen.js`. Keep them equal.
- **Budgets** are per user (they cover all accounts). Rollover copies for new months are created by
  the frontend (`useBudgetData`, looking back up to 12 months).

---

## Importing files

A two-step, stateless flow: **preview** parses the file and writes nothing; **confirm** writes the
rows the user approved, re-checking everything server-side.

**Parsing** (`import_parser.py`, pure functions with no database access)
- `load_file(file)` picks the parser by file extension first (browsers often report `.csv` files
  with an Excel MIME type), then MIME type. CSV is decoded as UTF-8 with BOM, UTF-8, then Latin-1;
  `.xlsx` uses openpyxl and `.xls` uses xlrd. Limits: `MAX_FILE_BYTES` (10 MB) and `MAX_ROWS`
  (10,000). Every failure becomes a `ValueError` with a message for the user; exceptions from the
  parsing libraries become "Could not parse file: ...".
- `normalize_dataframe(df)` lowercases and trims the headers, then resolves the columns:

  | Result | Accepted headers |
  |---|---|
  | `date` (required) | `date` |
  | `amount` (required) | `amount`, or `expense`/`withdrawal` together with `income`/`deposit` (income minus expense; one blank cell counts as 0) |
  | `vendor` (required) | `vendor` or `store` |
  | `category` (required) | `category` |
  | `notes` | `notes` or `description` |
  | `account` | `account`, or `bank account` (the app's own CSV export) (trimmed) |

- `parse_date` reads Excel dates and serial numbers, `MM/DD/YYYY`, `YYYY-MM-DD`, `MM-DD-YYYY`, and
  `YYYY-MM-DD HH:MM:SS`. `clean_currency` handles `$`, `€`, `£`, thousands separators, and
  `(12.34)`-style negatives. Both return `None` for blank or unreadable values instead of guessing, and the
  original text is kept in `date_raw` / `amount_raw` so the preview can show it.
- The vendor, category, notes and account columns lose the export's formula guard (an
  apostrophe in front of formula-like text; see `formula_guard`).

**Preview** (`ImportService.preview(user_id, file, unmatched='create', target_account_id=None)`)
returns `{rows, summary, unmatched_account_names}`.
- Each row's `account` value is matched to the user's accounts by name or id string,
  case-insensitively and ignoring surrounding spaces (`_account_key`).
- Rows whose account isn't found, every row of a file without an account column, and rows with a
  blank account cell follow `unmatched`:
  - `create`: the row is marked `new_account`, named after its account value (or the file name
    without its extension); the account is created on confirm.
  - `account`: the row goes into `target_account_id`, which must be one of the user's accounts.
  - `skip`: the row stays unmatched and can't be imported.
- Row flags: `new_account`, `duplicate`, `zero_amount`, `invalid_date`, `invalid_amount`,
  `is_transfer` (pre-set for the categories "transfer" and "payment"). Invalid fields carry the
  original text.
- **Recurring matches** (`_match_recurring`): an importable row on an existing account gets a
  `recurring_match` when it looks like a transaction already in a recurring series (generated
  or linked): same account, within ±`MATCH_WINDOW_DAYS` (3), a vendor exact or similar to the
  series' names (the template's vendor, the transaction's own, and the series' aliases, which
  count as exact), and an amount within 50% moving money the same way (`_match_kind`, using
  `vendor_match`). It names the series transaction (`transaction_id`, `recurring_id`, the
  template's `vendor`, `date`, `amount`) and says why it may not be the same charge
  (`similar_vendor`, `different_amount`). A series transaction with an exact copy in the file
  (a duplicate row) isn't offered. Each row and each series transaction is claimed at most once:
  an exact vendor and amount first, then the closer amount, then the nearer date (one query for
  the series transactions in the file's date span, then a lookup by account and day).
- The summary counts each flag and the rows with a `recurring_match` (`recurring_matches`), and
  lists the `new_accounts` that confirm would create. A preview
  that would create more than `MAX_NEW_ACCOUNTS` (25) accounts is rejected with a 400, since that
  usually means the wrong column was read as the account.

**Confirm** (`ImportService.confirm(user_id, rows)`) returns
`{imported, replaced, skipped, linked, created_accounts}`.
1. Validate every row before inserting any. Skip non-objects, malformed fields, zero amounts,
   accounts that aren't the user's, and rows identical to a transaction that existed before this
   import. A row with `replaces_transaction_id` (a `recurring_match` the user confirmed) is
   re-checked with the preview's rule (`_confirm_replacement`): the transaction must be in a
   series, on the row's own account (so the user's), still match by date, amount and vendor,
   and not be replaced by another row of this import; otherwise the row is skipped.
2. Reuse an account that matches a new account's name by now; enforce `MAX_NEW_ACCOUNTS`; create
   the remaining accounts, only for names with at least one accepted row, flagged
   `needs_attention`.
3. Insert the rows, or for a replacement update the series transaction in place
   (`RecurringService.replace_occurrence`): it takes the file row's date and amount, the
   balance moves by the difference, its vendor and category stay the series', its notes change
   only when the file row has some, and a transfer's peer follows. Occurrences renumber by date,
   `start_date` moves back if needed, and the template's amount stays (only that occurrence
   changes). Confirming a similar vendor saves its cleaned spelling as an alias of the series
   (`remember_alias`), so later previews treat it as exact. Then recalculate each affected
   account's balance and link new transfers to their counterparts. `imported` counts new
   transactions, `replaced` the series transactions updated.

**Duplicate key:** (account, date, vendor compared case-insensitively and trimmed, amount in cents).
It is checked only against rows that existed before the import, so identical rows within one file
(two same-day purchases) are all kept.

---

## Recurring transactions

A template fills each occurrence that is due: generation runs while `next_date <= today` and
(`number == -1` or `idx <= number`), advancing `next_date` by one repeat and `idx` by one each
time. `idx` starts at 1. If an occurrence already has an exact match (see Matching below: same
vendor and amount within 3 days, not dismissed), the nearest one is linked as that occurrence
instead of generating a second copy, which keeps a charge entered by hand or imported from the
bank from being counted twice. Otherwise a transaction is generated.

**Schedules.** A template repeats every `frequency` days (`frequency_unit = 'days'`) or every
`frequency` calendar months (`'months'`: monthly is 1, quarterly 3, yearly 12). A monthly template
falls on `day_of_month`, or on the last day of a shorter month, without drifting: a template on
the 31st runs Jan 31, Feb 28, Mar 31. `RecurringModel.shift()` does this date math, and `to_dict`
reports `last_date` (the latest occurrence generated so far) so clients don't repeat it.
`day_of_month` is set from the next date when a template is created or becomes monthly, and again
when its next date moves to a different day; re-saving an unchanged next date keeps it. The
frequency must be a whole number of at least 1.

Generation runs when a template is created, on login, on every `GET /api/auth/me` (each page load),
and in the scheduler (`services/scheduler.py`): a catch-up pass at startup, then daily at 00:05
server local time.

**Past start dates.** A template whose next date is in the past fills every missed occurrence
when it is created (adopting exact matches already in the history, generating the rest). With `skip_past`, it instead starts at its first occurrence on or
after today (that becomes its `start_date` and `next_date`, with `idx` 1), keeping its rhythm and
its day of the month, so a bill whose history was imported isn't generated again. An occurrence
that falls on today is still generated.

**Series membership.** A series is the set of transactions whose `recurring_id` points at the
template, generated or linked; `recurring_index` numbers them 1, 2, ... by date, and `idx` is
always one more than their count.
- **Matching** (`match_candidates`), the strict rule used when linking without asking: a
  transaction counts as an occurrence when it is in no series, not dismissed for this one, on the
  same account, with the same vendor (case and surrounding spaces ignored) and the exact same
  amount, within ±`MATCH_WINDOW_DAYS` (3) of the occurrence date.
- **Linking** (`link_transaction`) makes an existing transaction an occurrence without changing
  its fields or the balance; a manual link doesn't have to match. The transaction must be on the
  template's account, in no other series, and dated no later than the next occurrence plus the
  window. Near the next occurrence (within the window, while the series is still running), it
  fills it: `next_date` moves on. Older, it joins the history: a limited series' `number` grows
  by one, so the occurrences still to come stay the same, and `start_date` moves back if needed.
- **Unlinking** (`unlink_transaction`) keeps the transaction and shrinks the series the way
  deleting a generated transaction does: later occurrences renumber, a limited `number` drops by
  one, and `next_date` stays.
- **Suggestions** (`suggest_matches`) list transactions that may belong to a series, for the user
  to confirm; nothing is linked. Because a person confirms them, they use a looser rule than
  automatic matching: same account and vendor, money moving the same way (a refund never matches
  a payment), and either the same category (any amount) or the exact same amount (any category).
  Each occurrence owns the days from `MATCH_WINDOW_DAYS` after the previous occurrence up to
  `MATCH_WINDOW_DAYS` after itself: a payment up to a full period early counts, one a few days
  late counts for the occurrence before, and every transaction falls to exactly one occurrence.
  They walk the schedule back from the next occurrence, and each occurrence with candidates
  becomes one suggestion: `missing` (since the series
  started, with no transaction of the series near it), `duplicate` (the series already covers it:
  a second matching transaction is either the same charge twice or an extra payment that belongs
  to the series too, for the user to decide), or `history` (before
  `start_date`; the walk stops after `HISTORY_MISSES_TO_STOP` (2) occurrences in a row without a
  match). That lets a template created from its next date pick up the history imported before it.
- **Dismissals** (`dismiss_suggestion`, `undo_dismissal`) record that a transaction isn't part of
  a series ("Unrelated transaction"), so its suggestions skip it; only transactions on the
  series' account and outside the series can be dismissed, and repeating either call is
  harmless. Linking a dismissed transaction to that series removes its dismissal, which is how
  the app undoes a review mistake.
- **Import matches.** The import preview marks file rows that look like a transaction already
  in a series, with a looser rule again (similar names, amounts within 50%), since the user
  reviews them. On confirm, the bank's charge replaces the series transaction in place
  (`replace_occurrence`), and a confirmed similar spelling becomes an alias of the series
  (`recurring_aliases`). Aliases only affect import matching; generation and suggestions still
  compare the template's vendor. See [Importing files](#importing-files).
- **Needs attention.** Every API response that returns a template uses
  `RecurringService.template_dict`, which adds `suggestion_count` (transactions currently
  suggested), `needs_attention` (true while any are left), and `dismissed_transaction_ids`
  (transactions marked unrelated to it, which the frontend flags in the transaction list). It
  is computed, not stored, so linking or dismissing the last suggestion clears it.

**Renaming a series.** When `update_recurring` changes a template's vendor and/or category (an
actual change; the edit form sends every field on each save), every transaction in the series,
generated or linked, gets the new value, and nothing else changes: not amounts, dates, or notes.
A transfer's peer follows, as when a transaction is edited. Over-budget flags follow a category
change on their own, since they're computed when read. Matching uses
the template's current vendor, so after a rename, transactions spelled the old way are no longer
suggested or adopted.

Deleting a template with `?delete_generated=true` deletes its generated transactions and reverses
their effect on the balance; otherwise they are kept and unlinked. Deleting a single generated
transaction shrinks the series: the template's `idx` drops by one (and `number` too, when the
series has a limit), and so does each later sibling's `recurring_index`.

---

## API reference

All routes are under `/api` except the health routes. Unless noted, routes need a
`Authorization: Bearer <token>` header and act only on the token's user's data.

| Prefix | Endpoints |
|---|---|
| (none) | `GET /health` (no auth), `GET /` (no auth; its endpoint list is out of date) |
| `/auth` | `POST /register` (no auth; 400 invalid input, 409 taken), `POST /login` (no auth; also generates due recurring transactions), `GET /me` (also generates due recurring transactions) |
| `/accounts` | `GET`, `POST`, `GET /all-transactions`, `GET` / `PATCH` / `DELETE /<id>`, `GET` / `POST /<id>/transactions`, `GET /<id>/upcoming?days=`, `GET` / `POST /<id>/recurring` |
| `/transactions` | `GET` / `PUT` / `PATCH` / `DELETE /<id>`, `PATCH /<id>/transfer`, `POST` / `DELETE /<id>/transfer/pair` |
| `/recurring` | `GET` / `PUT` / `PATCH` / `DELETE /<id>` (`?delete_generated=true`), `GET /<id>/suggestions`, `POST` / `DELETE /<id>/transactions/<transaction_id>`, `POST` / `DELETE /<id>/dismissals/<transaction_id>` |
| `/budgets` | `GET ?period=`, `POST`, `GET /progress?period=`, `PATCH` / `DELETE /<id>` |
| `/analytics` | `GET /all`, `GET /<account_id>` |
| `/import` | `POST /preview`, `POST /confirm` |
| `/export` | `GET /transactions.csv`, `GET /report.pdf` |

Details worth knowing:
- `POST /accounts` takes `account_id` and optionally `account_name`; a blank, non-text, or
  over-100-character value is a 400.
- `PATCH /accounts/<id>` takes any of `account_name`, `account_id`, `opening_balance` (dollars),
  and `needs_attention: false` ("Looks good"). Any of them clears `needs_attention`. A blank,
  non-text, or over-100-character name or id string is a 400, and so is a starting balance that
  isn't a number or is beyond ±$10,000,000. Account responses include `balance` and
  `opening_balance`.
- `POST /accounts/<id>/recurring` takes `start_date`, `vendor`, `category`, `amount`, `frequency`,
  and optionally `frequency_unit` (`days`, the default, or `months`), `next_date` (defaults to
  `start_date`), `number`, `notes`, and `skip_past: true` (start at the first occurrence on or
  after today instead of generating past ones); it generates any occurrences already due.
  `PATCH /recurring/<id>` takes any of those fields; a new `vendor` or `category` is also
  applied to the series (see Renaming a series). An invalid schedule is a 400.
- `GET /recurring/<id>/suggestions` returns `{suggestions: [{date, kind, linked, candidates}]}`,
  oldest first (`kind` is `missing`, `duplicate`, or `history`; `linked` and `candidates` are
  transactions). `POST /recurring/<id>/transactions/<transaction_id>` links a transaction to the
  series and `DELETE` on the same path takes it out; both return the updated template, and an
  invalid link or unlink is a 400. `POST /recurring/<id>/dismissals/<transaction_id>` dismisses a
  suggestion and `DELETE` undoes it. Templates in every response carry `suggestion_count`,
  `needs_attention`, and `dismissed_transaction_ids`.
- `GET /accounts/<id>/transactions` filters with `start_date`, `end_date` (inclusive, `YYYY-MM-DD`),
  `category`, `over_budget=true|false` (on the computed flags; `limit` / `offset` then apply to
  the matching rows), `limit`, and `offset`.
- `PATCH /transactions/<id>/transfer` toggles the transfer flag. Turning it on links an unlinked
  counterpart automatically when `find_transfer_peer` finds one; turning it off unlinks both sides.
- `POST /transactions/<id>/transfer/pair` with `{to_account_id}` creates the counterpart in that
  account. `DELETE` on the same path breaks the link but keeps both flagged.
- `POST /import/preview` is multipart: `file`, plus optional `unmatched` (`create` | `account` |
  `skip`) and `target_account_id`; each returned row carries `recurring_match` (an object or
  null). `POST /import/confirm` takes `{transactions: [...]}`, the
  approved preview rows; each sends `account_id`, or `account_name` with `new_account: true`,
  and optionally `replaces_transaction_id` to replace a matched series transaction. The
  response adds `replaced` to the counts.
- `/export` routes take `account_ids` (comma-separated), `start_date`, and `end_date`. A
  malformed filter, an account that isn't the user's, or a period with nothing to export is a 400.
  The `Content-Disposition` filename carries the export's period, e.g.
  `transactions_2026-01-01_to_2026-06-30.csv`.
- There are no bulk endpoints; the frontend sends one request per item for bulk actions.

---

## Schema changes

`db.create_all()` creates missing tables but never alters existing ones. Changes to existing
tables go in `app._run_migrations` as idempotent statements (`ADD COLUMN IF NOT EXISTS`,
`ALTER COLUMN ... TYPE`), which run at startup on Postgres and are skipped in tests.

When adding one:
1. Change the model, and add the matching statement to `_run_migrations`.
2. Give new columns a default so existing rows stay valid (`NOT NULL DEFAULT ...`).
3. Verify it against a real Postgres database: SQLite in the tests ignores string lengths and
   never runs the migrations.

---

## Testing

```bash
cd backend && python -m pytest tests/ -q
cd backend && python -m pytest tests/test_service.py::TestRegister -v   # one class or test
```

- Tests run against in-memory SQLite with `TESTING=True`, which skips the migrations and the
  scheduler (`tests/conftest.py`). No database server is needed.
- Fixtures: `app`, `client`, `user`, `account`, `auth_headers` (a logged-in user's
  `Authorization` header), and `pin_today` (call it with a date to fix `date.today()` inside
  `RecurringService`, so recurring tests don't depend on when they run).
- Never import `wsgi` in a check script: it builds the real app, which runs the migrations and the
  scheduler's catch-up against whatever database `DATABASE_URL` points at. Use
  `create_app({'TESTING': True, ...})` instead. After each test, `clean_tables` empties every table and resets the
  session: SQLite reuses ids after a delete, and a stale cached object with a reused id breaks the
  next insert.
- Every test file must pass on its own, and the suite must pass in reverse file order.
- `backend/pytest.ini` turns SQLAlchemy's `LegacyAPIWarning` into an error, so 1.x-style calls
  (`Model.query.get()` and the like) fail the tests; use `db.session.get()` and the 2.0 APIs. A
  run prints no warnings; treat a new one as something to fix.
- **SQLite can't prove everything.** It ignores `String` lengths and some Postgres errors, so
  column limits get a guard test (see `test_hash_fits_the_column`,
  `test_columns_fit_long_bank_labels`), and migrations and length-sensitive behavior are checked
  on a real Postgres database.
- Give large `pytest.mark.parametrize` values short `ids=`: a 10 MB value inside a test id makes
  pytest error.
- Password hashing (scrypt) is deliberately slow, about 0.2 s per hash, and dominates the suite's
  running time.

| File | Covers |
|---|---|
| `test_routes.py` | HTTP behavior: auth, registration validation, accounts, transactions, recurring |
| `test_service.py` | Service logic: account review, transactions and balances, recurring generation and deletion, auth |
| `test_imports.py` | Import preview and confirm, end to end |
| `test_import_parser.py` | The pure parsing functions |
| `test_vendor_match.py` | Vendor and amount comparisons for recurring matches (pure functions) |
| `test_balance_service.py` | Account ledgers: opening, running and closing balances |
| `test_budget_flag_service.py` | Over-budget flags computed on read |
| `test_exports.py` | The CSV and PDF downloads: selection, formats, round trip, account pages |
| `test_formula_guard.py` | The CSV formula guard (pure functions) |
| `test_error_handlers.py` | Global error responses |

---

## Adding a feature

1. **Write the tests first**, and watch them fail.
2. **Model and schema**: change the model; for an existing table, add a migration
   ([Schema changes](#schema-changes)).
3. **Data access**: add plain reads and writes to `DbService`, with no rules.
4. **Business logic**: put rules in the domain's service. Raise `ValueError` for bad input, keep
   money in cents, and keep the [invariants](#invariants).
5. **Route**: parse input with `json_body()`, check ownership, call the service, map `ValueError`
   to 400, and return the standard response shape. A new blueprint is registered in `app.py`.
6. **Verify** on a real Postgres database whatever SQLite can't prove.
7. **Update this file**: services, data model, invariants, and API reference.

---

## Known limitations

Recorded so nobody builds on them by accident; each is planned to be fixed.

- **Input validation is incomplete.** Older routes still read bodies with `request.get_json()` and
  index fields directly, so a missing field or malformed date there is a generic 500 instead of a
  400. `AccountService.update_transaction` returns raw exception text as its 400 message.
- **Period math is repeated.** Turning a `YYYY-MM` period into dates is done separately in
  `budget_service.py` and `budget_flag_service.py`.
- **Recurring generation can run twice at once.** Each gunicorn worker starts its own scheduler,
  and `/me` also generates on every page load, so concurrent runs can duplicate transactions.
  Login and `/me` each loop over accounts with different error handling.
- **CORS is configured twice.** `CORS(app, supports_credentials=True)` allows every origin, so the
  manual allowlist in `create_app()` has no effect.
- **Hand-written migrations.** `_run_migrations` stands in for Alembic.
- **The CSV doesn't carry transfer or reimbursement marks.** Importing an export into empty
  accounts restores every transaction, but only rows in the `Transfer` / `Payment` categories
  come back as transfers, and no reimbursement marks come back.
- **Duplicate detection ignores counts.** If the database holds one row identical to two rows in
  a file, both file rows are skipped (only overlapping bank exports can hit this).
- **Rollover copies are created by the frontend**, not the server.
- **Other bookkeeping is still read, change, write.** Balances are atomic now, but a series'
  `idx` / `number` isn't, so two simultaneous edits of the same series could still race. The frontend sends bulk actions one request at a time, which
  keeps this from happening in practice.
- **Template responses compute their suggestions.** `needs_attention` walks each template's
  schedule (one query per occurrence) every time a template is returned, including the account
  template lists. Fine at today's scale; cache or store it if templates or history grow large.
- **`authenticate` answers faster for an unknown username** (no hash check), which leaks whether
  a username exists to someone timing requests.
