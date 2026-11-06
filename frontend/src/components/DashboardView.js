import TransactionList from './TransactionList';
import BudgetProgressBar from './BudgetProgressBar';
import UpcomingList from './UpcomingList';
import { todayISO, sameDayLastMonth, dayRangeLabel } from '../utils/dates';
import { formatCents, formatWholeDollars } from '../utils/money';
import { cashFlow } from '../utils/moneyRules';

const RECENT_LIMIT = 5;

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

function DashboardView({ transactions, budgetData = [], upcoming, onNavigate }) {
  // This month so far, against the same days of last month (a partial month never against a whole one)
  const today = todayISO();
  const lastMonthDay = sameDayLastMonth(today);
  const lastMonthStart = `${lastMonthDay.slice(0, 7)}-01`;
  const thisMonth = cashFlow(transactions, `${today.slice(0, 7)}-01`, today);
  const lastMonth = cashFlow(transactions, lastMonthStart, lastMonthDay);
  const comparedWith = dayRangeLabel(lastMonthStart, lastMonthDay);

  // What this month's budgets have left: their total (allocations plus carry-over) less their
  // spending, which reimbursements lower (budget progress)
  const budgeted = budgetData.reduce((sum, b) => sum + b.allocated_cents + b.carried_over_cents, 0);
  const left = budgeted - budgetData.reduce((sum, b) => sum + b.spent_cents, 0);

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

      {/* Two-column section: spending vs budget + recent transactions */}
      <div className="dashboard-columns">
        <div className="dashboard-col">
          <div className="section-header">
            <h3>Spending vs Budget</h3>
            <button className="link-btn" onClick={() => onNavigate('budgeting')}>
              Manage →
            </button>
          </div>
          {budgetData.length > 0 ? (
            <div className="budget-progress-list">
              {budgetData.map(item => (
                <BudgetProgressBar key={item.id} item={item} />
              ))}
            </div>
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
