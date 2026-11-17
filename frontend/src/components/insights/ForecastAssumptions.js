import ViewAsTable from '../ViewAsTable';
import { formatCents, formatSignedCents } from '../../utils/money';
import { FORECAST_DAYS, forecastAssumptions } from '../../utils/forecast';

const NOTE = 'A category is forecast by its recurring charges when at least 90% of its spending over the last 90 days, '
  + 'less reimbursements, in every account, was in recurring series; every other category by its average over the '
  + 'last 90 days, less reimbursements. Income is scheduled income only, and series that have ended are left out.';
const ACCOUNT_NOTE = ' An account with an interest rate gets its interest on the 1st of each period, on its own balance '
  + 'the day before; a loan also gets the payments of the series that pay it down.';

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// How a category is forecast, in words
const basisLabel = (c) => {
  if (c.basis === 'scheduled') return `Its recurring charges, ${c.count ? `${c.count} due` : 'none due'}`;
  if (c.basis === 'no-history') return `Its recurring charges, ${c.count} due (no spending over the last 90 days)`;
  const daily = `${formatCents(Math.round(c.average / FORECAST_DAYS))} a day, its average over the last 90 days`;
  return c.count
    ? `${daily}, plus ${plural(c.count, 'charge')} due from a series with no spending over the last 90 days`
    : daily;
};

// "What the forecast assumes" (Phase F, F1b), collapsed under the balance chart: the scheduled
// income, then each category of the accounts `accountIds` with what it spent over the last 90
// days and the reimbursements taken off, its share in a series, how it's forecast and what it adds
// over the next 90 days (utils/forecast.js forecastAssumptions), each loan's payments and each
// account's interest (`accounts`: accountInputs), and a total, the forecast's change from today
function ForecastAssumptions({ transactions, recurring, occurrences, accountIds, today, label, accounts = [] }) {
  const { categories, income, accounts: accountRows } = forecastAssumptions(transactions, recurring, occurrences, accountIds, today, accounts);
  const reimbursed = (cents) => (cents ? formatCents(cents) : '—');
  const rows = [];
  if (income.count) {
    rows.push(['Scheduled income', '—', '—', '—', `${plural(income.count, 'payment')} from ${income.series} series`, formatSignedCents(income.cents)]);
  }
  accountRows.forEach(account => {
    if (account.kind === 'loan') {
      rows.push([
        `${account.name}: payments`, '—', '—', '—',
        account.payments.count ? `${plural(account.payments.count, 'payment')} from its paying series` : 'No payments due',
        formatSignedCents(account.payments.cents),
      ]);
    }
    rows.push([
      `${account.name}: interest`, '—', '—', '—',
      account.apr
        ? `${account.apr.toFixed(2)}% a year, ${account.kind === 'loan' ? 'charged' : 'paid'} ${account.frequency}`
        : 'No APR set, so no interest',
      formatSignedCents(account.interest),
    ]);
  });
  categories.forEach(c => rows.push([
    c.category,
    c.basis === 'no-history' ? '—' : formatCents(c.spent),
    reimbursed(c.reimbursed),
    c.share === null ? '—' : `${c.share}%`,
    basisLabel(c),
    formatSignedCents(c.forecast),
  ]));
  rows.push([
    'Total',
    formatCents(categories.reduce((sum, c) => sum + c.spent, 0)),
    reimbursed(categories.reduce((sum, c) => sum + c.reimbursed, 0)),
    '', '',
    formatSignedCents(categories.reduce((sum, c) => sum + c.forecast,
      accountRows.reduce((sum, account) => sum + account.payments.cents + account.interest, income.cents))),
  ]);

  return (
    <ViewAsTable
      summary="What the forecast assumes" note={accountRows.length ? NOTE + ACCOUNT_NOTE : NOTE}
      caption={`What the forecast assumes, ${label}`}
      columns={['Category', 'Spent over the last 90 days', 'Reimbursed', 'Share in a series, all accounts', 'Forecast from', 'Next 90 days']}
      rows={rows}
    />
  );
}

export default ForecastAssumptions;
