import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ReferenceLine, ResponsiveContainer } from 'recharts';
import { monthRangeLabel } from '../../../utils/dates';
import { formatCents, formatCompactDollars } from '../../../utils/money';

const HEIGHT = 110;
const ALL_TICKS_UP_TO = 8;    // months; a longer run labels only its first month, Januaries and Julys

// "Oct", or with the year for a January or the first tick: "Jan 2026"
const monthTick = (month, index) => {
  const [year, m] = month.split('-').map(Number);
  const withYear = m === 1 || index === 0;
  return new Date(year, m - 1, 1).toLocaleDateString('en-US', withYear ? { month: 'short', year: 'numeric' } : { month: 'short' });
};

// The months to label: all of a short run; of a long one, the first, Januaries and Julys
const tickMonths = (months) => (months.length <= ALL_TICKS_UP_TO ? months
  : months.filter((month, i) => i === 0 || month.endsWith('-01') || month.endsWith('-07')));

// A month's spending on hover or tap
function MonthTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const { month, cents, partial } = payload[0].payload;
  return (
    <div className="chart-tooltip" role="tooltip">
      <strong>{monthRangeLabel(month, month)}{partial ? ', so far' : ''}</strong>
      <div>{formatCents(cents)}</div>
    </div>
  );
}

// One category's small chart: a bar per month (a month the period only partly covers lighter)
// on its own scale, and a dashed line at its monthly average
function CategoryPanelChart({ panel }) {
  const data = panel.months.map(m => ({ ...m, dollars: m.cents / 100 }));
  return (
    <ResponsiveContainer width="100%" height={HEIGHT}>
      <BarChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barCategoryGap="20%">
        <XAxis
          dataKey="month" ticks={tickMonths(data.map(m => m.month))} tickFormatter={monthTick} interval={0}
          tickLine={false} axisLine={{ stroke: '#d1d5db' }} tick={{ fontSize: 11, fill: '#6b7280' }}
        />
        <YAxis
          width={40} tickCount={3} tickFormatter={formatCompactDollars}
          tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#6b7280' }}
        />
        <Tooltip content={<MonthTip />} cursor={{ fill: 'rgba(0, 0, 0, 0.04)' }} />
        <Bar dataKey="dollars" radius={[3, 3, 0, 0]} isAnimationActive={false}>
          {data.map(m => <Cell key={m.month} className={`category-bar${m.partial ? ' partial' : ''}`} />)}
        </Bar>
        {panel.average !== null && (
          <ReferenceLine
            y={panel.average / 100} className="category-average" stroke="#1a1a2e" strokeDasharray="4 3"
            ifOverflow="extendDomain"
          />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}

export default CategoryPanelChart;
