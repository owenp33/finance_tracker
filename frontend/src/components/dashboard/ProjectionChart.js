import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { formatCents, formatCompactDollars } from '../../utils/money';
import { dayNumber } from '../../utils/dates';
import { formatDate } from '../transactions/utils';
import { monthTick } from '../../utils/monthTicks';

const LINE_COLOR = '#2a78d6';   // --chart-blue

// The first of each month after `from` through `to`, as 'YYYY-MM'
const monthStarts = (from, to) => {
  const months = [];
  let [year, month] = from.split('-').map(Number);
  for (;;) {
    month += 1;
    if (month > 12) { month = 1; year += 1; }
    const first = `${year}-${String(month).padStart(2, '0')}`;
    if (`${first}-01` > to) return months;
    months.push(first);
  }
};

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
// months marked and a $0 line when it crosses zero
function ProjectionChart({ start, points }) {
  const data = [start, ...points].map(p => ({ day: dayNumber(p.date), date: p.date, cents: p.cents }));
  const months = monthStarts(start.date, points[points.length - 1]?.date ?? start.date);
  const monthOf = Object.fromEntries(months.map(m => [dayNumber(`${m}-01`), m]));
  const crossesZero = data.some(p => p.cents < 0) && data.some(p => p.cents > 0);
  return (
    <div className="projection-chart">
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="#eef0f3" />
          <XAxis
            type="number" dataKey="day" domain={['dataMin', 'dataMax']} ticks={Object.keys(monthOf).map(Number)} interval={0}
            tickFormatter={(day, index) => monthTick(monthOf[day], index)} tick={{ fontSize: 11, fill: '#6b7280' }}
          />
          <YAxis
            domain={['auto', 'auto']} tickCount={3} width={52} tickFormatter={formatCompactDollars}
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
