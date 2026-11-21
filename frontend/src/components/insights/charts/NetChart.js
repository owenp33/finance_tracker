import { useState } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Cell, ReferenceLine, ResponsiveContainer } from 'recharts';
import { monthRangeLabel, shiftPeriod } from '../../../utils/dates';
import { formatCents, formatSignedCents, formatCompactDollars } from '../../../utils/money';
import { monthAxis } from '../../../utils/monthTicks';

const HEIGHT = 260;
const Y_AXIS_WIDTH = 52;
const MARGIN = { top: 8, right: 8, bottom: 0, left: 0 };

// A month's numbers on hover or tap, its average named by the three months it covers
export function NetTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const averaged = monthRangeLabel(shiftPeriod(row.month, -1), shiftPeriod(row.month, 1));
  return (
    <div className="chart-tooltip" role="tooltip">
      <strong>{monthRangeLabel(row.month, row.month)}{row.partial ? ', partial' : ''}</strong>
      <dl>
        <dt>Money in</dt><dd>{formatCents(row.income)}</dd>
        <dt>Money out</dt><dd>{formatCents(row.expenses)}</dd>
        <dt>Net</dt><dd>{formatSignedCents(row.net)}</dd>
        {row.average !== null && <><dt>Average of {averaged}</dt><dd>{formatSignedCents(row.average)}</dd></>}
      </dl>
    </div>
  );
}

// Net per month as bars around $0 (aqua above, orange below; a month only partly in the period
// lighter), with the 3-month average as a line on the same axis, each point on the middle month
// of the three; as many month labels as its width fits. `rows` are monthlyNet's.
function NetChart({ rows }) {
  const [width, setWidth] = useState(null);     // measured by the container
  const data = rows.map(row => ({
    ...row,
    netDollars: row.net / 100,
    averageDollars: row.average === null ? null : row.average / 100,
  }));
  const axis = monthAxis(data.map(row => row.month), width === null ? null : width - Y_AXIS_WIDTH - MARGIN.right);
  return (
    <ResponsiveContainer width="100%" height={HEIGHT} onResize={setWidth}>
      <ComposedChart data={data} margin={MARGIN}>
        <XAxis
          dataKey="month" ticks={axis.ticks} tickFormatter={axis.format} interval={0}
          tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#6b7280' }}
        />
        <YAxis
          width={Y_AXIS_WIDTH} tickFormatter={formatCompactDollars}
          tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#6b7280' }}
        />
        <Tooltip content={<NetTip />} cursor={{ fill: 'rgba(0, 0, 0, 0.04)' }} />
        <ReferenceLine y={0} className="net-zero-line" stroke="#9ca3af" />
        <Bar dataKey="netDollars" radius={2} maxBarSize={48} isAnimationActive={false}>
          {data.map(row => (
            <Cell key={row.month} className={`net-bar ${row.net < 0 ? 'negative' : 'positive'}${row.partial ? ' partial' : ''}`} />
          ))}
        </Bar>
        <Line
          dataKey="averageDollars" className="net-average" stroke="#1a1a2e" strokeWidth={2}
          dot={{ r: 2.5, fill: '#1a1a2e' }} connectNulls={false} isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export default NetChart;
