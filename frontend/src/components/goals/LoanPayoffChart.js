import { useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { formatCents, formatCompactDollars } from '../../utils/money';
import { monthRangeLabel } from '../../utils/dates';
import { monthAxis } from '../../utils/monthTicks';

const EXTRA_COLOR = '#2a78d6';     // --chart-blue
const REGULAR_COLOR = '#6b7280';   // muted ink: the path to compare against
const Y_AXIS_WIDTH = 56;
const MARGIN = { top: 18, right: 16, bottom: 0, left: 0 };

// The tooltip: the month and what's owed on each path (`labels.extra` null: one path)
export function PayoffTip({ active, payload, labels }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="chart-tooltip payoff-tip">
      <strong>{monthRangeLabel(point.month, point.month)}</strong>
      {labels.extra ? (
        <>
          <div>{`${labels.extra}: ${formatCents(point.withExtra)} owed`}</div>
          <div>{`${labels.regular}: ${formatCents(point.without)} owed`}</div>
        </>
      ) : (
        <div>{`${formatCents(point.without)} owed`}</div>
      )}
    </div>
  );
}

// The regular payments' last value, at the end of its line
const EndLabel = ({ x, y, index, value, last }) => (index === last && value > 0 ? (
  <text x={x} y={y} dy={-8} textAnchor="end" className="payoff-end-label">{formatCompactDollars(value)}</text>
) : null);

// What's owed on a loan month by month (Phase F, F2g): with the goal's extra (solid) and with the
// regular payments only (dashed, its end labelled); one solid line when nothing extra goes toward it.
// `months` are utils/goals.js loanPayoff's (cents); `labels` name the paths for the tooltip;
// `targetOwed` (cents) draws a dashed goal line when the goal isn't $0 owed. As many month labels as
// its width fits.
function LoanPayoffChart({ months, labels, targetOwed }) {
  const [width, setWidth] = useState(null);     // measured by the container
  const axis = monthAxis(months.map(m => m.month), width === null ? null : width - Y_AXIS_WIDTH - MARGIN.right);
  const last = months.length - 1;
  return (
    <div className="payoff-chart">
      <ResponsiveContainer width="100%" height={180} onResize={setWidth}>
        <LineChart data={months} margin={MARGIN}>
          <CartesianGrid vertical={false} stroke="#eef0f3" />
          <XAxis
            dataKey="month" ticks={axis.ticks} interval={0}
            tickFormatter={axis.format} tick={{ fontSize: 11, fill: '#6b7280' }}
          />
          <YAxis
            domain={[0, 'auto']} tickCount={4} width={Y_AXIS_WIDTH} tickFormatter={formatCompactDollars}
            tick={{ fontSize: 11, fill: '#6b7280' }}
          />
          <Tooltip content={<PayoffTip labels={labels} />} cursor={{ stroke: '#9ca3af', strokeWidth: 1 }} isAnimationActive={false} />
          {targetOwed > 0 && (
            <ReferenceLine
              y={targetOwed / 100} className="payoff-goal-line" stroke="#12795a" strokeDasharray="6 4"
              label={{ value: `Goal ${formatCompactDollars(targetOwed / 100)} owed`, position: 'insideTopLeft', fill: '#12795a', fontSize: 11 }}
            />
          )}
          {labels.extra && (
            <Line
              dataKey={point => point.withExtra / 100} name={labels.extra} className="payoff-line-extra"
              stroke={EXTRA_COLOR} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false}
            />
          )}
          <Line
            dataKey={point => point.without / 100} name={labels.regular}
            className={labels.extra ? 'payoff-line-regular' : 'payoff-line-only'}
            stroke={labels.extra ? REGULAR_COLOR : EXTRA_COLOR} strokeWidth={2} strokeDasharray={labels.extra ? '5 4' : undefined}
            dot={false} activeDot={{ r: 4 }} isAnimationActive={false} label={<EndLabel last={last} />}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default LoanPayoffChart;
