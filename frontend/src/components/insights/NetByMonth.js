import NetChart from './charts/NetChart';
import ViewAsTable from '../ViewAsTable';
import { monthRangeLabel } from '../../utils/dates';
import { formatCents, formatSignedCents } from '../../utils/money';

// Insights → Overview's net per month (Phase V, V5c), replacing the income / expenses / net line
// chart: bars around $0 and a 3-month average on each middle month. `rows` are monthlyNet's.
function NetByMonth({ rows }) {
  return (
    <section className="chart-container full-width net-by-month">
      <h3>Net per month</h3>
      <p className="chart-note">
        Money in - money out, transfers left out
      </p>
      <NetChart rows={rows} />
      <ul className="timeline-legend">
        <li><span className="net-key positive" aria-hidden="true" />More in than out</li>
        <li><span className="net-key negative" aria-hidden="true" />More out than in</li>
        <li><span className="net-key average" aria-hidden="true" />3-month average</li>
      </ul>
      <ViewAsTable
        caption="Net per month"
        columns={['Month', 'Money in', 'Money out', 'Net', '3-month average']}
        rows={rows.map(row => [
          `${monthRangeLabel(row.month, row.month)}${row.partial ? ' (partial)' : ''}`,
          formatCents(row.income), formatCents(row.expenses), formatSignedCents(row.net),
          row.average === null ? '—' : formatSignedCents(row.average),
        ])}
      />
    </section>
  );
}

export default NetByMonth;
