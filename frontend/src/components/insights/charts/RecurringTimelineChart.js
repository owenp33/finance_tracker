import { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, ReferenceLine, ResponsiveContainer, ZIndexLayer, DefaultZIndexes, usePlotArea,
} from 'recharts';
import { formatDate } from '../../transactions/utils';
import { dayNumber, shiftPeriod } from '../../../utils/dates';
import { formatCents } from '../../../utils/money';
import { paymentComparison, paymentComparisonLines } from '../../../utils/recurring';

const ROW_HEIGHT = 44;
const BAR_SIZE = 8;
const TOP = 26;          // room for the "Today" label above the first row
const AXIS_HEIGHT = 24;
const LABEL_GAP = 9;     // between a row's text and its bar, clear of its marks
const HIT_HALF = 8;      // a payment's hover target reaches this far either side, less where payments crowd
const TIP_HALF = 130;    // about half a payment tip's width, to keep it inside the chart
const TIP_HEIGHT = 110;  // about a payment tip's height: nearer the chart's top, it opens below the payment

// The quarter starts (Jan, Apr, Jul, Oct) from `startPeriod` through `endPeriod`, each named with
// its year when it's January or the first
const quarterTicks = (startPeriod, endPeriod) => {
  const ticks = [];
  for (let period = startPeriod; period <= endPeriod; period = shiftPeriod(period, 1)) {
    const [year, month] = period.split('-').map(Number);
    if ((month - 1) % 3 !== 0) continue;
    const withYear = month === 1 || ticks.length === 0;
    const label = new Date(year, month - 1, 1).toLocaleDateString('en-US', withYear ? { month: 'short', year: 'numeric' } : { month: 'short' });
    ticks.push({ day: `${period}-01`, label });
  }
  return ticks;
};

// A row's spans: posted solid, still scheduled light and dashed; ended rows lighter, income in aqua
const PostedSpan = ({ x, y, width, height, payload }) => (payload.payments.length === 0 ? null : (
  <rect x={x} y={y} width={Math.max(width, 3)} height={height} rx={3}
    className={`timeline-posted ${payload.kind}${payload.active ? '' : ' ended'}`} />
));
const ScheduledSpan = ({ x, y, width, height, payload }) => (!payload.scheduled ? null : (
  <rect x={x} y={y + 0.5} width={Math.max(width, 3)} height={height - 1} rx={3} className={`timeline-scheduled ${payload.kind}`} />
));
const Hidden = () => null;

// Each row's text above its bar, and on the bar a white tick per payment, a ring where the amount
// changed, a dot for an extra payment (both: a dot inside a ring), and over each payment an
// invisible hover (or tap) target that reports it through `onHover`. Drawn in Recharts' scatter
// layer, above the bars and the "Today" line (SVG has no z-index; Recharts 3 orders its own layers).
function RowMarks({ data, origin, span, onHover }) {
  const plot = usePlotArea();
  if (!plot) return null;
  const band = plot.height / data.length;
  const x = (day) => plot.x + ((dayNumber(day) - origin) / span) * plot.width;
  return (
    <ZIndexLayer zIndex={DefaultZIndexes.scatter}>
      <g className="timeline-marks">
        {data.map((row, i) => {
          const cy = plot.y + band * (i + 0.5);
          return (
            <g key={row.template.id}>
              <text x={plot.x} y={cy - BAR_SIZE / 2 - LABEL_GAP} className="timeline-row-label">{row.name}</text>
              {row.payments.map((payment, j) => {
                const px = x(payment.date);
                const before = j > 0 ? x(row.payments[j - 1].date) : -Infinity;
                const after = j < row.payments.length - 1 ? x(row.payments[j + 1].date) : Infinity;
                const left = Math.max(px - HIT_HALF, (before + px) / 2);
                const right = Math.min(px + HIT_HALF, (px + after) / 2);
                const show = () => onHover({ row, payment, x: px, y: cy - HIT_HALF, plotLeft: plot.x, plotRight: plot.x + plot.width });
                return (
                  <g key={j}>
                    <line x1={px} x2={px} y1={cy - BAR_SIZE / 2} y2={cy + BAR_SIZE / 2} className="timeline-tick" />
                    {payment.changed && <circle cx={px} cy={cy} r={4.5} className="timeline-ring" />}
                    {payment.extra && <circle cx={px} cy={cy} r={payment.changed ? 2 : 3.5} className="timeline-dot" />}
                    <rect
                      x={left} y={cy - HIT_HALF} width={Math.max(right - left, 1)} height={HIT_HALF * 2}
                      className="timeline-hit" role="img"
                      aria-label={`${row.template.vendor}, ${formatDate(payment.date, true)}: ${formatCents(Math.abs(payment.amount_cents))}`}
                      onMouseEnter={show} onMouseLeave={() => onHover(null)} onClick={show}
                    />
                  </g>
                );
              })}
            </g>
          );
        })}
      </g>
    </ZIndexLayer>
  );
}

// One payment's details above it: its amount, then how it compares with its series' typical
// payment, its rank in the series, and its share of that month's spending
function PaymentTip({ tip, byMonth, today }) {
  const { row, payment } = tip;
  const lines = paymentComparisonLines(paymentComparison(payment, row.payments, byMonth), today);
  const roomy = tip.plotRight - tip.plotLeft > TIP_HALF * 2;
  const left = roomy ? Math.min(Math.max(tip.x, tip.plotLeft + TIP_HALF), tip.plotRight - TIP_HALF) : tip.x;
  const below = tip.y < TIP_HEIGHT;
  return (
    <div
      className={`chart-tooltip timeline-payment-tip${below ? ' below' : ''}`} role="tooltip"
      style={{ left, top: below ? tip.y + HIT_HALF * 2 : tip.y }}
    >
      <strong>{row.template.vendor} · {formatDate(payment.date, true)}</strong>
      <div className="tip-amount">{formatCents(Math.abs(payment.amount_cents))}</div>
      <ul>{lines.map(line => <li key={line}>{line}</li>)}</ul>
    </div>
  );
}

// One row per series on a time axis, as a stacked bar: a transparent offset to its first payment,
// the posted span, a transparent gap to today, and what's still scheduled through `windowEnd`;
// payment marks drawn over it and a dashed "Today" line. Only a payment responds to hover (Owen,
// 2026-11-08: no tooltip for the whole row). `rows` are RecurringTimeline's: seriesTimeline's rows
// plus their label (`name`), account, counts and scheduled label; `byMonth` is moneyRules
// cashFlowByMonth of every transaction.
function RecurringTimelineChart({ rows, today, windowEnd, byMonth }) {
  const [tip, setTip] = useState(null);
  const starts = rows.map(row => row.posted?.from ?? row.scheduled?.from).filter(Boolean).sort();
  const startPeriod = (starts[0] ?? today).slice(0, 7);
  const origin = dayNumber(`${startPeriod}-01`);
  const at = (day) => dayNumber(day) - origin;
  const span = at(windowEnd);
  const ticks = quarterTicks(startPeriod, windowEnd.slice(0, 7));
  const tickLabels = Object.fromEntries(ticks.map(tick => [at(tick.day), tick.label]));

  const data = rows.map(row => {
    const postedTo = row.posted ? at(row.posted.to) : null;
    const scheduledFrom = row.scheduled ? Math.max(at(row.scheduled.from), postedTo ?? 0) : null;
    return {
      ...row,
      offset:    row.posted ? at(row.posted.from) : (scheduledFrom ?? 0),
      postedSpan: row.posted ? postedTo - at(row.posted.from) : 0,
      gap:       row.posted && row.scheduled ? scheduledFrom - postedTo : 0,
      scheduledSpan: row.scheduled ? at(row.scheduled.to) - scheduledFrom : 0,
    };
  });

  return (
    <div className="timeline-chart">
    <ResponsiveContainer width="100%" height={data.length * ROW_HEIGHT + TOP + AXIS_HEIGHT}>
      <BarChart data={data} layout="vertical" margin={{ top: TOP, right: 0, bottom: 0, left: 0 }}>
        <XAxis
          type="number" domain={[0, span]} allowDataOverflow ticks={ticks.map(tick => at(tick.day))}
          tickFormatter={value => tickLabels[value] ?? ''} height={AXIS_HEIGHT} interval="preserveStartEnd"
          tickLine={false} axisLine={{ stroke: '#d1d5db' }} tick={{ fontSize: 12, fill: '#6b7280' }}
        />
        <YAxis type="category" dataKey="name" hide />
        <Bar dataKey="offset" stackId="life" barSize={BAR_SIZE} isAnimationActive={false} shape={Hidden} />
        <Bar dataKey="postedSpan" stackId="life" barSize={BAR_SIZE} isAnimationActive={false} shape={PostedSpan} />
        <Bar dataKey="gap" stackId="life" barSize={BAR_SIZE} isAnimationActive={false} shape={Hidden} />
        <Bar dataKey="scheduledSpan" stackId="life" barSize={BAR_SIZE} isAnimationActive={false} shape={ScheduledSpan} />
        <ReferenceLine
          x={at(today)} stroke="#1a1a2e" strokeDasharray="3 3"
          label={{ value: 'Today', position: 'top', fill: '#374151', fontSize: 12 }}
        />
        <RowMarks data={data} origin={origin} span={span} onHover={setTip} />
      </BarChart>
    </ResponsiveContainer>
    {tip && <PaymentTip tip={tip} byMonth={byMonth} today={today} />}
    </div>
  );
}

// What the timeline's marks mean
export function TimelineLegend() {
  return (
    <ul className="timeline-legend">
      <li>
        <svg width="22" height="10" aria-hidden="true">
          <rect y="1" width="22" height="8" rx="3" className="timeline-posted cost" />
          <line x1="7" x2="7" y1="1" y2="9" className="timeline-key-tick" />
          <line x1="15" x2="15" y1="1" y2="9" className="timeline-key-tick" />
        </svg>
        Posted, a tick per payment
      </li>
      <li><svg width="22" height="10" aria-hidden="true"><rect y="1.5" width="22" height="7" rx="3" className="timeline-scheduled cost" /></svg>Still scheduled</li>
      <li><svg width="22" height="10" aria-hidden="true"><rect y="1" width="22" height="8" rx="3" className="timeline-posted income" /></svg>Income</li>
      <li><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" className="timeline-key-ring" /></svg>Amount changed</li>
      <li><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="3.5" className="timeline-key-dot" /></svg>Extra payment</li>
    </ul>
  );
}

export default RecurringTimelineChart;
