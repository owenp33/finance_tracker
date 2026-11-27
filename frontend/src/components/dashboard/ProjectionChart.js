import { useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { formatCents, formatCompactDollars } from '../../utils/money';
import { dayNumber } from '../../utils/dates';
import { formatDate } from '../transactions/utils';
import { dayAxis, monthStartsAfter } from '../../utils/monthTicks';

const LINE_COLOR = '#2a78d6';   // --chart-blue
const Y_AXIS_WIDTH = 52;
const MARGIN = { top: 8, right: 8, bottom: 0, left: 0 };

// The tooltip: the day and net position then
export function ProjectionTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <strong>{formatDate(point.date, true)}</strong>
      <div>{formatCents(point.cents)}</div>
    </div>
  );
}

// Net position over the next 90 days on the Dashboard (2026-11-17): a dashed step line (a forecast)
// from `start` ({date, cents}, today) through `points` (utils/forecast.js forecastPoints), with the
// months marked (as many as its width fits) and a $0 line when it crosses zero
function ProjectionChart({ start, points }) {
  const [width, setWidth] = useState(null);     // measured by the container
  const data = [start, ...points].map(p => ({ day: dayNumber(p.date), date: p.date, cents: p.cents }));
  const axis = dayAxis(
    monthStartsAfter(start.date, points[points.length - 1]?.date ?? start.date),
    width === null ? null : width - Y_AXIS_WIDTH - MARGIN.right,
  );
  const crossesZero = data.some(p => p.cents < 0) && data.some(p => p.cents > 0);
  return (
    <div className="projection-chart">
      <ResponsiveContainer width="100%" height={140} onResize={setWidth}>
        <LineChart data={data} margin={MARGIN}>
          <CartesianGrid vertical={false} stroke="#eef0f3" />
          <XAxis
            type="number" dataKey="day" domain={['dataMin', 'dataMax']} ticks={axis.ticks} interval={0}
            tickFormatter={axis.format} tick={{ fontSize: 11, fill: '#6b7280' }}
          />
          <YAxis
            domain={['auto', 'auto']} tickCount={3} width={Y_AXIS_WIDTH} tickFormatter={formatCompactDollars}
            tick={{ fontSize: 11, fill: '#6b7280' }}
          />
          <Tooltip content={<ProjectionTip />} cursor={{ stroke: '#9ca3af', strokeWidth: 1 }} isAnimationActive={false} />
          {crossesZero && <ReferenceLine y={0} stroke="#6b7280" />}
          <Line
            type="stepAfter" dataKey={p => p.cents / 100} className="projection-line" stroke={LINE_COLOR} strokeWidth={2}
            strokeDasharray="5 4" dot={false} activeDot={{ r: 4 }} isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default ProjectionChart;
