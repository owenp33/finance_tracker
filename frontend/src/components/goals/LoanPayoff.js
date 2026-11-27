import LoanPayoffChart from './LoanPayoffChart';
import ViewAsTable from '../ViewAsTable';
import { formatCents, formatWholeDollars } from '../../utils/money';
import { monthRangeLabel } from '../../utils/dates';

const monthLabel = (month) => monthRangeLabel(month, month);

// A monthly amount: whole dollars when it has no cents ("$75/mo"), else to the cent ("$87.38/mo")
const perMonth = (cents) => `${cents % 100 === 0 ? formatWholeDollars(cents / 100) : formatCents(cents)}/mo`;

// With the extra: when the goal is reached, or what's still owed where the chart ends
const extraNote = (payoff, verb) => {
  const last = payoff.months[payoff.months.length - 1];
  const outcome = payoff.reachMonth
    ? `${verb} by ${monthLabel(payoff.reachMonth)}, ${formatCents(payoff.interestWith)} in interest.`
    : `${formatCents(last.withExtra)} still owed in ${monthLabel(last.month)}, ${formatCents(payoff.interestWith)} in interest.`;
  return `With ${formatCents(payoff.extraCents)} extra, from ${monthLabel(payoff.extraFrom)}: ${outcome}`;
};

// With the current (regular) payments only: the goal reached within the chart, or what's owed where it
// ends and whether that's reached later, keeps growing, or isn't reached at this pace
const regularNote = (payoff, verb) => {
  const last = payoff.months[payoff.months.length - 1];
  const how = payoff.regularCents > 0
    ? `Current payments only (${perMonth(payoff.regularCents)})`
    : 'No payments';
  if (payoff.withoutReachMonth && payoff.withoutReachMonth <= last.month) {
    return `${how}: ${verb} by ${monthLabel(payoff.withoutReachMonth)}, ${formatCents(payoff.interestWithout)} in interest.`;
  }
  const after = payoff.withoutReachMonth ? `; ${verb} by ${monthLabel(payoff.withoutReachMonth)}.`
    : payoff.growing ? '; interest outpaces the payments.'
    : `; not ${verb} at this pace.`;
  return `${how}: ${formatCents(last.without)} owed in ${monthLabel(last.month)}, `
    + `${formatCents(payoff.interestWithout)} in interest${after}`;
};

// A loan goal's payoff, under its row in the Goals section (Phase F, F2g): what's owed month by month
// with the goal's monthly amount on top of the regular payments, and with the regular payments only
// (one line when nothing extra goes toward it), a note for each, and the table. `payoff` is
// utils/goals.js loanPayoff's.
function LoanPayoff({ goal, payoff }) {
  const verb = goal.target_cents === 0 ? 'paid off' : 'reached';
  const extra = payoff.extraCents > 0;
  const regular = payoff.regularCents > 0 ? 'Current payments only' : 'No payments';
  const labels = { extra: extra ? 'With the extra' : null, regular };
  return (
    <div className="loan-payoff">
      {extra && (
        <ul className="payoff-legend">
          <li><span className="payoff-key" aria-hidden="true" />{`With ${formatCents(payoff.extraCents)} extra a month`}</li>
          <li>
            <span className="payoff-key regular" aria-hidden="true" />
            {payoff.regularCents > 0 ? `${regular} (${perMonth(payoff.regularCents)})` : regular}
          </li>
        </ul>
      )}
      <LoanPayoffChart months={payoff.months} labels={labels} targetOwed={Math.max(-goal.target_cents, 0)} />
      {extra && <p className="payoff-note">{extraNote(payoff, verb)}</p>}
      <p className="payoff-note">{regularNote(payoff, verb)}</p>
      <ViewAsTable
        caption={`What's owed on ${goal.account_name}, month by month`}
        columns={extra ? ['Month', labels.extra, regular] : ['Month', 'Owed']}
        rows={payoff.months.map((m, i) => [
          `${monthLabel(m.month)}${i === 0 ? ' (now)' : ''}`,
          ...(extra ? [formatCents(m.withExtra), formatCents(m.without)] : [formatCents(m.without)]),
        ])}
      />
    </div>
  );
}

export default LoanPayoff;
