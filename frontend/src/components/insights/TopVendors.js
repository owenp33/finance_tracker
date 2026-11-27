import { useState } from 'react';
import CategoryPanelChart from './charts/CategoryPanelChart';
import TransactionList from '../TransactionList';
import ViewAsTable from '../ViewAsTable';
import { formatCents } from '../../utils/money';
import { topVendors, vendorDetail } from './vendorSpending';

const LATEST_SHOWN = 5;     // a vendor's latest charges listed in its detail, as many as the Dashboard's recent ones

// What clicking a vendor shows: its charges, average and total, its spending per month (dashed:
// the full months' average), and its latest charges
function VendorDetail({ detail }) {
  return (
    <div className="vendor-detail">
      <p className="vendor-detail-stats">
        {`${detail.count} charge${detail.count === 1 ? '' : 's'} · average ${formatCents(detail.average)} · `
          + `${formatCents(detail.total)} in total`}
      </p>
      <CategoryPanelChart panel={{ months: detail.months, average: detail.monthlyAverage }} />
      <TransactionList transactions={detail.transactions.slice(0, LATEST_SHOWN)} compact />
      {detail.count > LATEST_SHOWN && <p className="vendor-detail-more">{`The ${LATEST_SHOWN} latest of ${detail.count}.`}</p>}
    </div>
  );
}

// Insights → Overview's top vendors (Phase V, V5d): a bar per vendor (a button: click for its
// detail, again to close), the amounts in a column at the end, and a toggle that leaves out
// recurring charges. `months` / `partial` are the period's (categoryPanels periodMonths).
function TopVendors({ transactions, months, partial }) {
  const [leaveOutRecurring, setLeaveOutRecurring] = useState(false);
  const [selected, setSelected] = useState(null);
  const vendors = topVendors(transactions, { leaveOutRecurring });
  const largest = vendors[0]?.total ?? 0;

  return (
    <section className="chart-container full-width top-vendors">
      <div className="top-vendors-header">
        <h3>Top vendors</h3>
        <label className="bri-toggle">
          <input type="checkbox" checked={leaveOutRecurring} onChange={() => setLeaveOutRecurring(on => !on)} />
          Leave out recurring charges
        </label>
      </div>
      {vendors.length === 0 ? (
        <p className="no-data">No spending in this period.</p>
      ) : (
        <>
          <p className="chart-note">Click a vendor for details.</p>
          <ol className="vendor-bars">
            {vendors.map(v => {
              const open = selected === v.vendor;
              return (
                <li key={v.vendor}>
                  <button
                    type="button" className={`vendor-bar${open ? ' selected' : ''}`} aria-expanded={open}
                    onClick={() => setSelected(open ? null : v.vendor)}
                  >
                    <span className="vendor-name">{v.vendor}</span>
                    <span className="vendor-track">
                      <span className="vendor-fill" style={{ width: `${(v.total / largest) * 100}%` }} />
                    </span>
                    <span className="vendor-value">{formatCents(v.total)}</span>
                  </button>
                  {open && <VendorDetail detail={vendorDetail(transactions, v.vendor, months, partial, { leaveOutRecurring })} />}
                </li>
              );
            })}
          </ol>
          <ViewAsTable
            caption="Top vendors"
            columns={['Vendor', 'Total', 'Charges', 'Average charge']}
            rows={vendors.map(v => [v.vendor, formatCents(v.total), v.count, formatCents(v.average)])}
          />
        </>
      )}
    </section>
  );
}

export default TopVendors;
