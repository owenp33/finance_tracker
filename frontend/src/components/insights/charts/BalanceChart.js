import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, Brush, ResponsiveContainer } from 'recharts';
import { formatDate } from '../../transactions/utils';
import { dayNumber, shiftPeriod } from '../../../utils/dates';
import { formatCents, formatSignedCents, formatCompactDollars } from '../../../utils/money';

const HEIGHT = 300;
const MAX_LISTED = 6;    // transactions listed in a day's tooltip before "+N more"

// Month starts from `from` through `to` (YYYY-MM-DD): every month over half a year or less, else
// quarter starts; each named with its year when it's January or the first
const monthTicks = (from, to) => {
  const quarterly = shiftPeriod(from.slice(0, 7), 7) <= to.slice(0, 7);
  const ticks = [];
  for (let period = shiftPeriod(from.slice(0, 7), 1); period <= to.slice(0, 7); period = shiftPeriod(period, 1)) {
    const [year, month] = period.split('-').map(Number);
    if (quarterly && (month - 1) % 3 !== 0) continue;
    const withYear = month === 1 || ticks.length === 0;
    const label = new Date(year, month - 1, 1).toLocaleDateString('en-US', withYear ? { month: 'short', year: 'numeric' } : { month: 'short' });
    ticks.push({ day: dayNumber(`${period}-01`), label });
  }
  return ticks;
};

// A point's details on hover or tap: its date and balance, and for a day with changes, that day's
// transactions in the accounts shown (`accountIds`), or for a forecast day, the items scheduled
// and its share of the average spending (utils/forecast.js forecastPoints)
export function BalanceTooltip({ active, payload, transactions, accountIds }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const forecast = point.kind === 'forecast' || point.kind === 'forecast-end';
  const onDay = point.kind === 'day'
    ? transactions.filter(t => t.date === point.date && accountIds.includes(t.account_id))
    : forecast
      ? [
        ...point.items.map((o, i) => ({ id: `${o.recurring_id}-${i}`, vendor: o.vendor, amount_cents: Math.round(o.amount * 100) })),
        ...(point.average > 0 ? [{ id: 'average', vendor: 'Average spending over the last 90 days', amount_cents: -point.average }] : []),
        ...(point.interest ? [{ id: 'interest', vendor: 'Interest', amount_cents: point.interest }] : []),
      ]
      : [];
  const title = point.kind === 'start' ? `${formatDate(point.date, true)}, start of range`
    : point.kind === 'end' ? `${formatDate(point.date, true)}, today`
      : forecast ? `${formatDate(point.date, true)}, forecast`
        : formatDate(point.date, true);
  return (
    <div className="chart-tooltip balance-tip" role="tooltip">
      <strong>{title}</strong>
      <div className="tip-amount">{formatCents(point.cents)}</div>
      {onDay.length > 0 && (
        <ul>
          {onDay.slice(0, MAX_LISTED).map(t => (
            <li key={t.id}><span>{t.vendor}</span><span>{formatSignedCents(t.amount_cents)}</span></li>
          ))}
        </ul>
      )}
      {onDay.length > MAX_LISTED && <div className="tip-more">+{onDay.length - MAX_LISTED} more</div>}
    </div>
  );
}

// A step line of a balance over a range (`points`: utils/balances.js rangePoints), on a time axis,
// with a $0 line when it crosses zero and a brush underneath to zoom; then, dashed from today's
// balance, the `forecast` (utils/forecast.js forecastPoints) with a "Today" line between them
function BalanceChart({ points, forecast = [], today, transactions, accountIds }) {
  const last = points.length - 1;
  const data = [
    ...points.map((p, i) => ({
      ...p, day: dayNumber(p.date), dollars: p.cents / 100,
      ...(i === last && forecast.length > 0 && { forecastDollars: p.cents / 100 }),    // where the forecast starts
    })),
    ...forecast.map(p => ({ ...p, day: dayNumber(p.date), forecastDollars: p.cents / 100 })),
  ];
  const values = data.map(d => d.dollars ?? d.forecastDollars);
  const crossesZero = Math.min(...values) < 0 && Math.max(...values) > 0;
  const ticks = monthTicks(data[0].date, data[data.length - 1].date);
  const tickLabels = Object.fromEntries(ticks.map(tick => [tick.day, tick.label]));

  return (
    <ResponsiveContainer width="100%" height={HEIGHT}>
      <LineChart data={data} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
        <XAxis
          type="number" dataKey="day" domain={['dataMin', 'dataMax']} ticks={ticks.map(tick => tick.day)}
          tickFormatter={value => tickLabels[value] ?? ''} interval="preserveStartEnd"
          tickLine={false} axisLine={{ stroke: '#d1d5db' }} tick={{ fontSize: 12, fill: '#6b7280' }}
        />
        <YAxis
          domain={['auto', 'auto']} tickFormatter={formatCompactDollars} width={56}
          tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#6b7280' }}
        />
        <Tooltip
          content={<BalanceTooltip transactions={transactions} accountIds={accountIds} />}
          cursor={{ stroke: '#9ca3af', strokeDasharray: '3 3' }}
        />
        {crossesZero && (
          <ReferenceLine
            y={0} className="balance-zero-line" stroke="#6b7280"
            label={{ value: '$0', position: 'insideTopRight', fill: '#6b7280', fontSize: 12 }}
          />
        )}
        {forecast.length > 0 && (
          <ReferenceLine x={dayNumber(today)} stroke="#9ca3af" strokeDasharray="2 3" label={{ value: 'Today', position: 'top', fill: '#6b7280', fontSize: 11 }} />
        )}
        <Line type="stepAfter" dataKey="dollars" className="balance-line" dot={false} connectNulls={false} isAnimationActive={false} />
        {forecast.length > 0 && (
          <Line
            type="stepAfter" dataKey="forecastDollars" className="balance-forecast" dot={false}
            connectNulls={false} isAnimationActive={false}
          />
        )}
        <Brush dataKey="date" height={24} stroke="#9ca3af" travellerWidth={8} tickFormatter={date => formatDate(date)} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export default BalanceChart;
