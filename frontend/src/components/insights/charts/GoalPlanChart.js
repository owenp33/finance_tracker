import { useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { formatCents, formatCompactDollars } from '../../../utils/money';
import { monthRangeLabel } from '../../../utils/dates';
import { monthAxis } from '../../../utils/monthTicks';

const LINE_COLOR = '#2a78d6';      // --chart-blue
const GOAL_COLOR = '#12795a';      // the goal lines' green, as on the payoff chart
const HANDOFF_COLOR = '#9ca3af';
const Y_AXIS_WIDTH = 56;
const MARGIN = { top: 16, right: 28, bottom: 0, left: 0 };   // right: room for a label on the last month

// The tooltip: the month, the goal's balance (what's owed, for a loan), and what goes toward it that
// month, or that it's reached (paid off, for a loan whose goal is $0 owed) once its month has come
export function GoalPlanTip({ active, payload, owed, target, reachMonth }) {
  if (!active || !payload?.length) return null;
  const { month, cents, funded } = payload[0].payload;
  let after = null;
  if (funded > 0) after = `${formatCents(funded)} ${owed ? 'extra' : 'toward it'} this month`;
  else if (reachMonth && month >= reachMonth) after = owed && !target ? 'Paid off' : 'Reached';
  return (
    <div className="chart-tooltip goal-plan-tip">
      <strong>{monthRangeLabel(month, month)}</strong>
      <div>{owed ? `${formatCents(cents)} owed` : formatCents(cents)}</div>
      {after && <div>{after}</div>}
    </div>
  );
}

// One goal's panel in Insights → Accounts' goal plan: its path month by month over its own `months`
// (utils/goals.js goalTimeline `line`: a balance, or what a loan owes; `months` start this month, so
// `funding` lines up by index), a dashed goal line (none for a loan whose goal is $0 owed), and a
// dashed line at each hand-off it's given (`handoffs`). Months are labelled as its measured width fits.
function GoalPlanChart({ line, months, funding, handoffs, reachMonth }) {
  const [width, setWidth] = useState(null);     // measured by the container
  const axis = monthAxis(months, width === null ? null : width - Y_AXIS_WIDTH - MARGIN.right);
  const data = months.map((month, i) => ({
    month, cents: line.path[i], funded: funding[i]?.id === line.id ? funding[i].cents : 0,
  }));
  return (
    <div className="goal-plan-chart">
      <ResponsiveContainer width="100%" height={130} onResize={setWidth}>
        <LineChart data={data} margin={MARGIN}>
          <CartesianGrid vertical={false} stroke="#eef0f3" />
          <XAxis
            dataKey="month" ticks={axis.ticks} interval={0}
            tickFormatter={axis.format} tick={{ fontSize: 11, fill: '#6b7280' }}
          />
          <YAxis
            domain={[0, 'auto']} tickCount={3} width={Y_AXIS_WIDTH} tickFormatter={formatCompactDollars}
            tick={{ fontSize: 11, fill: '#6b7280' }}
          />
          <Tooltip
            content={<GoalPlanTip owed={line.owed} target={line.target} reachMonth={reachMonth} />}
            cursor={{ stroke: '#9ca3af', strokeWidth: 1 }} isAnimationActive={false}
          />
          {handoffs.map(handoff => (
            <ReferenceLine
              key={handoff.month} x={handoff.month} className="goal-plan-handoff-line"
              stroke={HANDOFF_COLOR} strokeDasharray="4 4"
            />
          ))}
          {line.target > 0 && (
            <ReferenceLine
              y={line.target / 100} ifOverflow="extendDomain" className="goal-plan-target" stroke={GOAL_COLOR} strokeDasharray="6 4"
              label={{ value: `Goal ${formatCompactDollars(line.target / 100)}${line.owed ? ' owed' : ''}`,
                       position: 'insideTopLeft', fill: GOAL_COLOR, fontSize: 11 }}
            />
          )}
          <Line
            dataKey={point => point.cents / 100} className="goal-plan-line" stroke={LINE_COLOR} strokeWidth={2}
            dot={false} activeDot={{ r: 4 }} isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default GoalPlanChart;
