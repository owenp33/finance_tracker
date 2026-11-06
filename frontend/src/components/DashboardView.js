import TransactionList from './TransactionList';
import BudgetPace from './BudgetPace';
import UpcomingList from './UpcomingList';
import { useMonthProjection } from '../hooks/useProjection';
import { todayISO, sameDayLastMonth, dayRangeLabel, monthEndLabel } from '../utils/dates';
import { formatCents, formatWholeDollars } from '../utils/money';
import { cashFlow } from '../utils/moneyRules';
import { rowPace, furthestAheadFirst } from '../utils/budgetPace';

// As many budgets as recent transactions, so the two columns line up
const RECENT_LIMIT = 5;
const PACE_LIMIT = RECENT_LIMIT;

// How this month's amount compares with last month's over the days in `label`, in whole dollars
const changeFrom = (nowCents, beforeCents, label) => {
  const dollars = Math.round((nowCents - beforeCents) / 100);
  if (dollars === 0) return `About the same as ${label}`;
  return `${formatWholeDollars(Math.abs(dollars))} ${dollars > 0 ? 'more' : 'less'} than ${label}`;
};

function StatCard({ title, value, valueClass, sub }) {
  return (
    <div className="stat-card">
      <h3>{title}</h3>
      <div className={valueClass ? `value ${valueClass}` : 'value'}>{value}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  );
}

// `onError` reports a failed request (this month's projection)
function DashboardView({ transactions, budgetData = [], upcoming, onNavigate, onError }) {
  const today = todayISO();
  const period = today.slice(0, 7);
  const occurrences = useMonthProjection(today, onError);

  // This month so far, against the same days of last month (a partial month never against a whole one)
  const lastMonthDay = sameDayLastMonth(today);
  const lastMonthStart = `${lastMonthDay.slice(0, 7)}-01`;
  const thisMonth = cashFlow(transactions, `${period}-01`, today);
  const lastMonth = cashFlow(transactions, lastMonthStart, lastMonthDay);
  const comparedWith = dayRangeLabel(lastMonthStart, lastMonthDay);

  // What this month's budgets have left: their total (allocations plus carry-over) less their
  // spending, which reimbursements lower (budget progress)
  const budgeted = budgetData.reduce((sum, b) => sum + b.allocated_cents + b.carried_over_cents, 0);
  const left = budgeted - budgetData.reduce((sum, b) => sum + b.spent_cents, 0);

  // The budgets furthest ahead of pace, each paced as the Budgeting view paces it
  const watched = budgetData
    .map(row => ({ row, pace: rowPace(row, { period, today, transactions, occurrences }) }))
    .sort((a, b) => furthestAheadFirst(a.pace, b.pace))
    .slice(0, PACE_LIMIT);

  const recentTransactions = transactions.slice(0, RECENT_LIMIT);

  return (
    <div className="dashboard-view">

      {/* This month's summary */}
      <div className="stats-grid">
        {budgetData.length > 0 ? (
          <StatCard
            title="Left to spend this month"
            value={formatCents(left)}
            valueClass={left < 0 ? 'over' : undefined}
            sub={`of ${formatCents(budgeted)} budgeted`}
          />
        ) : (
          <StatCard title="Left to spend this month" value="—" sub="No budgets this month" />
        )}
        <StatCard
          title="Income this month"
          value={formatCents(thisMonth.income)}
          valueClass="green"
          sub={changeFrom(thisMonth.income, lastMonth.income, comparedWith)}
        />
        <StatCard
          title="Expenses this month"
          value={formatCents(thisMonth.expenses)}
          valueClass="red"
          sub={changeFrom(thisMonth.expenses, lastMonth.expenses, comparedWith)}
        />
        <StatCard
          title="Net this month"
          value={formatCents(thisMonth.net)}
          sub={changeFrom(thisMonth.net, lastMonth.net, comparedWith)}
        />
      </div>

      {/* Two-column section: the budgets furthest ahead of pace + recent transactions */}
      <div className="dashboard-columns">
        <div className="dashboard-col">
          <div className="section-header">
            <h3>Budget Pace</h3>
            <button className="link-btn" onClick={() => onNavigate('budgeting')}>
              Manage →
            </button>
          </div>
          {watched.length > 0 ? (
            <ul className="dashboard-pace-list">
              {watched.map(({ row, pace }) => (
                <li key={row.id}>
                  <span className="dashboard-pace-category">{row.category}</span>
                  <BudgetPace category={row.category} pace={pace} monthEnd={monthEndLabel(period)} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="no-data">No budgets set for this period.</p>
          )}
        </div>

        <div className="dashboard-col">
          <div className="section-header">
            <h3>Recent Transactions</h3>
            <button className="link-btn" onClick={() => onNavigate('transactions')}>
              View all →
            </button>
          </div>
          <TransactionList transactions={recentTransactions} compact />
        </div>
      </div>

      {/* Upcoming recurring transactions */}
      <div className="upcoming-section">
        <h3>Due This Week</h3>
        <UpcomingList items={upcoming} />
      </div>

    </div>
  );
}

export default DashboardView;
