import { useState, useCallback } from 'react';
import BalanceChart from './charts/BalanceChart';
import ForecastAssumptions from './ForecastAssumptions';
import ViewAsTable from '../ViewAsTable';
import { formatDate } from '../transactions/utils';
import { useBalances } from '../../hooks/useBalances';
import { useProjection } from '../../hooks/useProjection';
import { useGoals } from '../../hooks/useGoals';
import { forecastAgainstGoal } from '../../utils/goals';
import { todayISO, shiftDays } from '../../utils/dates';
import { formatCents, formatSignedCents } from '../../utils/money';
import { RANGES, netPosition, rangeStart, rangePoints } from '../../utils/balances';
import { FORECAST_DAYS, forecastFor } from '../../utils/forecast';

const NET = 'net';

// A stable stand-in when no one listens for errors (useBalances refetches when it changes)
const IGNORE_ERROR = () => {};

// What the forecast does to a goal on the account shown (Phase F, F2e), in a few words, and whether
// it's a warning (a held goal the forecast dips under)
const goalNote = (goal, forecast, forecastEnd) => {
  const { reachesOn, dipsOn } = forecastAgainstGoal(goal, forecast);
  const target = `Goal ${formatCents(goal.target_cents)}`;
  const paidOff = goal.account_kind === 'loan' && goal.target_cents === 0;
  if (goal.reached) {
    return dipsOn
      ? { text: `${target}: dips under ${formatDate(dipsOn, true)}`, warning: true }
      : { text: `${target}: holds through ${formatDate(forecastEnd, true)}`, warning: false };
  }
  if (reachesOn) {
    return { text: paidOff ? `Paid off ${formatDate(reachesOn, true)}` : `${target}: reached ${formatDate(reachesOn, true)}`,
             warning: false };
  }
  return { text: paidOff ? 'Not paid off in 90 days' : `${target}: not reached in 90 days`, warning: false };
};

// How far a balance moved over the range, in words
const changeLabel = (change, from) => {
  const since = formatDate(from, true);
  if (change === 0) return `No change since ${since}`;
  return `${change > 0 ? 'Up' : 'Down'} ${formatCents(Math.abs(change))} since ${since}`;
};

// Insights → Accounts (Phase V, V4): is each account growing or shrinking, and what's the net
// position? Net position or one account (a choice above), over 3M / 6M / 1Y / All: the current
// balance and its change over the range, a step line with a brush, a 90-day forecast (Phase F,
// F1: utils/forecast.js) with what it assumes (F1b), and a table. `accounts` (GET
// /api/accounts) give the current balances each history should end at (the plan's check), which
// accounts are loans (F2a), and each account's interest rate and how often it hits; `recurring`
// (every template) tells the forecast which series have ended, and which pay down a loan. An
// account's goals (F2e) are dashed lines, with a note on where the forecast takes them.
function AccountsTab({ accounts = [], transactions = [], recurring = [], onError = IGNORE_ERROR }) {
  const balances = useBalances(onError);
  const [view, setView] = useState(NET);
  const [range, setRange] = useState('1Y');

  // The recurring items scheduled in the forecast's window; a failed load shows no forecast
  const [forecastFailed, setForecastFailed] = useState(false);
  const reportProjectionError = useCallback((message) => {
    setForecastFailed(true);
    onError(message);
  }, [onError]);
  const occurrences = useProjection(FORECAST_DAYS, reportProjectionError);
  const { goals } = useGoals(onError, accounts);

  if (balances === null) return <p className="no-data">Loading balances…</p>;
  if (balances.length === 0) return <p className="no-data">No balances to show.</p>;

  const selected = balances.find(b => b.id === view);
  const shown = selected ? [selected] : balances;
  const series = selected ?? netPosition(balances);
  const label = selected ? selected.account_name : 'Net position';

  const today = todayISO();
  const from = rangeStart(range, today, series.days[0]?.date ?? today);
  const points = rangePoints(series, from, today);
  const change = points[points.length - 1].cents - points[0].cents;

  // The forecast: from today's balance, the shown accounts' scheduled items and average spending,
  // the loans' payments, and the interest of every account shown with a rate, each on its own balance
  const shownIds = shown.map(b => b.id);
  const forecastEnd = shiftDays(today, FORECAST_DAYS);
  const { points: forecastAll, interestAccounts } = forecastFor({
    accounts, accountIds: shownIds, startCents: series.closing_cents,
    startOf: a => balances.find(b => b.id === a.id).closing_cents, transactions, recurring, occurrences, today,
  });
  const forecast = forecastFailed ? [] : forecastAll;
  // The goals on the account shown (net position spans every account, so it shows none)
  const accountGoals = selected && forecast.length > 0 ? (goals ?? []).filter(goal => goal.account_id === selected.id) : [];

  const allPoints = [...points, ...forecast];
  const days = allPoints
    .map((point, i) => ({ ...point, change: i > 0 ? point.cents - allPoints[i - 1].cents : 0 }))
    .filter(point => point.kind === 'day' || point.kind === 'forecast');

  // The history should end at the current balance; say so if it doesn't
  const current = shown.map(b => accounts.find(a => a.id === b.id)?.balance);
  const currentCents = current.reduce((sum, dollars) => sum + Math.round((dollars ?? 0) * 100), 0);
  const mismatch = current.every(dollars => typeof dollars === 'number') && currentCents !== series.closing_cents;

  const views = [{ key: NET, label: 'Net position' }, ...balances.map(b => ({ key: b.id, label: b.account_name }))];

  return (
    <section className="chart-container balance-over-time">
      <div className="balance-header">
        <h3>Balance over time</h3>
        <div className="timeline-toggle" role="group" aria-label="Range">
          {RANGES.map(key => (
            <button
              key={key} type="button" aria-pressed={range === key}
              className={`timeline-toggle-btn${range === key ? ' active' : ''}`} onClick={() => setRange(key)}
            >
              {key}
            </button>
          ))}
        </div>
      </div>
      <div className="timeline-toggle balance-views" role="group" aria-label="Account">
        {views.map(({ key, label: name }) => (
          <button
            key={key} type="button" aria-pressed={view === key || (key === NET && !selected)}
            className={`timeline-toggle-btn${view === key || (key === NET && !selected) ? ' active' : ''}`}
            onClick={() => setView(key)}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="balance-now">{formatCents(series.closing_cents)}</div>
      <div className="balance-change">{changeLabel(change, from)}</div>
      {forecast.length > 0 && (
        <p className="balance-forecast-line">
          {`Forecast for ${formatDate(forecastEnd, true)}: ${formatCents(forecast[forecast.length - 1].cents)}`}
        </p>
      )}
      {accountGoals.map(goal => {
        const { text, warning } = goalNote(goal, forecast, forecastEnd);
        return <p key={goal.id} className={`balance-goal-note${warning ? ' warning' : ''}`}>{text}</p>;
      })}
      {mismatch && (
        <p className="balance-mismatch">
          {`This history ends at ${formatCents(series.closing_cents)}, but `
            + `${selected ? "the account's balance is" : 'your accounts add up to'} ${formatCents(currentCents)}.`}
        </p>
      )}

      <BalanceChart
        key={`${view}-${range}`} points={points} forecast={forecast} today={today}
        transactions={transactions} accountIds={shownIds} goals={accountGoals}
      />
      {forecast.length > 0 && (
        <ul className="timeline-legend">
          <li><span className="balance-key" aria-hidden="true" />Balance</li>
          <li>
            <span className="balance-key forecast" aria-hidden="true" />
            Forecast: scheduled items, average spending (over the last 90 days), and any interest
          </li>
        </ul>
      )}
      {forecast.length > 0 && (
        <ForecastAssumptions
          transactions={transactions} recurring={recurring} occurrences={occurrences}
          accountIds={shownIds} today={today} label={label} accounts={interestAccounts}
        />
      )}
      <ViewAsTable
        caption={`Balance by day, ${label}`}
        columns={['Date', 'End-of-day balance', 'Change that day']}
        rows={days.map(day => [
          `${formatDate(day.date, true)}${day.kind === 'forecast' ? ' (forecast)' : ''}`,
          formatCents(day.cents), formatSignedCents(day.change),
        ])}
      />
    </section>
  );
}

export default AccountsTab;
