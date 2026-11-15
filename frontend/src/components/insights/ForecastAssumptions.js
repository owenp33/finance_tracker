import ViewAsTable from '../ViewAsTable';
import { formatCents, formatSignedCents } from '../../utils/money';
import { FORECAST_DAYS, forecastAssumptions } from '../../utils/forecast';

const NOTE = 'A category is forecast by its recurring charges when at least 90% of its spending over the last 90 days, '
  + 'in every account, was in recurring series; every other category by its average over the last 90 days. '
  + 'Income is scheduled income only, and series that have ended are left out.';

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
// days, its share in a series, how it's forecast and what it adds over the next 90 days
// (utils/forecast.js forecastAssumptions), and a total, the forecast's change from today
function ForecastAssumptions({ transactions, recurring, occurrences, accountIds, today, label }) {
  const { categories, income } = forecastAssumptions(transactions, recurring, occurrences, accountIds, today);
  const rows = [];
  if (income.count) {
    rows.push(['Scheduled income', '—', '—', `${plural(income.count, 'payment')} from ${income.series} series`, formatSignedCents(income.cents)]);
  }
  categories.forEach(c => rows.push([
    c.category,
    c.share === null ? '—' : formatCents(c.spent),
    c.share === null ? '—' : `${c.share}%`,
    basisLabel(c),
    formatSignedCents(c.forecast),
  ]));
  rows.push([
    'Total',
    formatCents(categories.reduce((sum, c) => sum + c.spent, 0)),
    '', '',
    formatSignedCents(categories.reduce((sum, c) => sum + c.forecast, income.cents)),
  ]);

  return (
    <ViewAsTable
      summary="What the forecast assumes" note={NOTE} caption={`What the forecast assumes, ${label}`}
      columns={['Category', 'Spent over the last 90 days', 'Share in a series, all accounts', 'Forecast from', 'Next 90 days']}
      rows={rows}
    />
  );
}

export default ForecastAssumptions;
