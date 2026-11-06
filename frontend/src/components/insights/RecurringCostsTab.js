import RecurringCostsChart from './charts/RecurringCostsChart';
import ViewAsTable from '../ViewAsTable';
import { frequencyLabel } from '../transactions/utils';
import { todayISO, monthRangeLabel } from '../../utils/dates';
import { formatCents, formatWholeDollars } from '../../utils/money';
import { recurringCosts } from '../../utils/recurring';

// Paying beyond the schedule is worth a note from a dollar up
const BEYOND_MIN_CENTS = 100;

const TABLE_COLUMNS = ['Series', 'Account', 'Charged', 'Per month', 'Status', 'Paid beyond schedule'];

// A series' charge in words: "$87.38 biweekly", "$10.00 every 30 days"
const chargedLabel = ({ amount, frequency, frequency_unit }) =>
  `${formatCents(Math.round(Math.abs(amount) * 100))} ${frequencyLabel(frequency, frequency_unit).toLowerCase()}`;

// Insights → Recurring (Phase V, V3): what the user's recurring series cost per month. The
// headline totals the active ones at their scheduled amounts; what a series paid beyond its
// schedule is noted apart, never added in (Owen, 2026-11-05).
function RecurringCostsTab({ recurring = [], transactions = [], accounts = [] }) {
  const { series, total, activeCount, incomeCount } = recurringCosts(recurring, transactions, todayISO());
  const accountName = (id) => accounts.find(a => a.id === id)?.account_name ?? '';

  const rows = series.map(s => {
    const beyond = s.beyond && s.beyond.extra >= BEYOND_MIN_CENTS ? s.beyond : null;
    const endedIn = s.ended ? ` ${monthRangeLabel(s.ended, s.ended)}` : '';
    return {
      ...s,
      beyond,
      account:     accountName(s.template.account_id),
      charged:     chargedLabel(s.template),
      status:      s.active ? 'Active' : `Ended${endedIn}`,
      barLabel:    `${formatCents(s.monthly)}/mo${s.active ? '' : ` · ended${endedIn}`}`,
      beyondLabel: beyond && `${formatWholeDollars(beyond.extra / 100)} in ${monthRangeLabel(beyond.from, beyond.to)}`,
    };
  });

  return (
    <div className="recurring-costs">
      <section className="chart-container recurring-costs-headline">
        <h3>Recurring costs</h3>
        {activeCount > 0 ? (
          <>
            <div className="recurring-costs-total">{formatCents(total)}/mo</div>
            <p className="recurring-costs-sub">
              {`${activeCount} active series at their scheduled amounts${incomeCount > 0 ? "; income isn't counted" : ''}`}
            </p>
          </>
        ) : (
          <p className="no-data">No active recurring costs</p>
        )}
        {rows.filter(row => row.beyond).map(row => (
          <p key={row.template.id} className="recurring-costs-note">
            {`Not included: ${formatWholeDollars(row.beyond.extra / 100)} paid to ${row.template.vendor} beyond its `
              + `${formatCents(row.monthly)}/mo schedule in ${monthRangeLabel(row.beyond.from, row.beyond.to)}`}
          </p>
        ))}
      </section>

      <section className="chart-container">
        <h3>Cost per month, by series</h3>
        {rows.length > 0 ? (
          <>
            <RecurringCostsChart rows={rows} />
            <ViewAsTable
              caption="Recurring costs per month"
              columns={TABLE_COLUMNS}
              rows={rows.map(row => [
                row.template.vendor, row.account, row.charged, formatCents(row.monthly), row.status, row.beyondLabel || '—',
              ])}
            />
          </>
        ) : (
          <p className="no-data">No recurring costs yet.</p>
        )}
      </section>
    </div>
  );
}

export default RecurringCostsTab;
