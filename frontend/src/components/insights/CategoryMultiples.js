import CategoryPanelChart from './charts/CategoryPanelChart';
import ViewAsTable from '../ViewAsTable';
import { monthRangeLabel } from '../../utils/dates';
import { formatCents, formatWholeDollars } from '../../utils/money';

// A panel's last full month against its average, in whole dollars: "Oct: $350, 8% above its $325
// average" ("about its … average" within 5%)
const panelLabel = ({ average, last }) => {
  if (!last || average === null) return 'No full month yet';
  const [year, m] = last.month.split('-').map(Number);
  const month = new Date(year, m - 1, 1).toLocaleDateString('en-US', { month: 'short' });
  const amount = formatWholeDollars(last.cents / 100);
  if (average === 0) return `${month}: ${amount}`;
  const typical = formatWholeDollars(average / 100);
  const percent = Math.round(((last.cents - average) / average) * 100);
  if (Math.abs(percent) < 5) return `${month}: ${amount}, about its ${typical} average`;
  return `${month}: ${amount}, ${Math.abs(percent)}% ${percent > 0 ? 'above' : 'below'} its ${typical} average`;
};

// Insights → Overview's spending by category (Phase V, V5b): small multiples, one per category in
// `panels` (categoryPanels), each on its own scale, with how far reimbursements put their total
// below `totalExpenses` (cents) and the numbers as a table
function CategoryMultiples({ panels, totalExpenses }) {
  const sum = panels.reduce((total, p) => total + p.total, 0);
  const lowered = totalExpenses - sum;
  const lastMonth = panels.find(p => p.last)?.last.month;

  return (
    <section className="chart-container full-width category-multiples">
      <h3>Spending by category</h3>
      {panels.length === 0 ? (
        <p className="no-data">No spending in this period.</p>
      ) : (
        <>
          <p className="category-multiples-note">
            Per month, each on its own scale; the dashed line is its monthly average, and a month only partly in the period is lighter.
          </p>
          <div className="category-panels">
            {panels.map(panel => (
              <figure key={panel.category} className="category-panel">
                <figcaption>
                  <strong>{panel.category}</strong>
                  <span className="category-panel-label">{panelLabel(panel)}</span>
                  {panel.others && <span className="category-panel-others">{panel.others.join(', ')}</span>}
                </figcaption>
                <CategoryPanelChart panel={panel} />
              </figure>
            ))}
          </div>
          {lowered > 0 && (
            <p className="category-multiples-note">
              {`Reimbursements are taken off their categories, so these add up to ${formatCents(sum)}, `
                + `${formatCents(lowered)} less than Total Expenses.`}
            </p>
          )}
          <ViewAsTable
            caption="Spending by category"
            columns={['Category', 'Total', 'Monthly average', lastMonth ? `Last full month (${monthRangeLabel(lastMonth, lastMonth)})` : 'Last full month', 'Transactions']}
            rows={panels.map(p => [
              p.category, formatCents(p.total), p.average === null ? '—' : formatCents(p.average),
              p.last ? formatCents(p.last.cents) : '—', p.count,
            ])}
          />
        </>
      )}
    </section>
  );
}

export default CategoryMultiples;
