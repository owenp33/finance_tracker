import ProjectionChart from './ProjectionChart';
import { forecastFor } from '../../utils/forecast';
import { formatWholeDollars } from '../../utils/money';
import { todayISO } from '../../utils/dates';
import { formatDate } from '../transactions/utils';

const cents = (account) => Math.round(account.balance * 100);

// The Dashboard's 90-day projection (2026-11-17), beside the goal card: net position (every account
// together) at the end of the next 90 days, by the forecast Insights → Accounts draws (utils/forecast.js
// forecastFor: scheduled items, average spending, interest), today's for comparison, and a small chart.
// `occurrences` are the next 90 days' projection (hooks/useGoalPlan already loads it).
function ProjectionCard({ accounts, transactions, recurring, occurrences, onNavigate }) {
  const header = (
    <div className="section-header">
      <h3>90-day projection</h3>
      <button className="link-btn" onClick={() => onNavigate('insights')}>Insights →</button>
    </div>
  );
  if (accounts.length === 0) {
    return (
      <div className="stat-card projection-card">
        {header}
        <div className="value">—</div>
        <div className="stat-sub">No accounts yet</div>
      </div>
    );
  }
  const today = todayISO();
  const startCents = accounts.reduce((sum, account) => sum + cents(account), 0);
  const { points } = forecastFor({
    accounts, accountIds: accounts.map(a => a.id), startCents, startOf: cents, transactions, recurring, occurrences, today,
  });
  const end = points[points.length - 1];
  return (
    <div className="stat-card projection-card">
      {header}
      <div className="value">{formatWholeDollars(end.cents / 100)}</div>
      <div className="stat-sub">{`Net position by ${formatDate(end.date)} · now ${formatWholeDollars(startCents / 100)}`}</div>
      <ProjectionChart start={{ date: today, cents: startCents }} points={points} />
    </div>
  );
}

export default ProjectionCard;
