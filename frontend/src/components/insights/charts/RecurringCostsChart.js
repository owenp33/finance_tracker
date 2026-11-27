import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, LabelList, ResponsiveContainer, usePlotArea } from 'recharts';
import { formatCents } from '../../../utils/money';

const ROW_HEIGHT = 46;
const LABEL_GAP = 7;   // between a row's text and its bar

// The numbers behind a bar on hover or tap
function CostTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <strong>{row.name}</strong>
      <dl>
        <dt>Account</dt><dd>{row.account}</dd>
        <dt>Category</dt><dd>{row.template.category}</dd>
        <dt>Charged</dt><dd>{row.charged}</dd>
        <dt>Per month</dt><dd>{formatCents(row.monthly)}</dd>
        {!row.active && <><dt>Status</dt><dd>{row.status}</dd></>}
        {row.beyondLabel && <><dt>Paid beyond schedule</dt><dd>{row.beyondLabel}</dd></>}
      </dl>
    </div>
  );
}

// A row's text above its bar, the series then its cost per month, so the bars keep the chart's
// whole width however narrow it gets
function RowLabel({ y, index, data }) {
  const plot = usePlotArea();
  const row = data[index];
  if (!plot || !row) return null;
  return (
    <text x={plot.x} y={y - LABEL_GAP}>
      <tspan className="recurring-cost-name">{row.name}</tspan>
      <tspan className="recurring-cost-label" dx={8}>{row.barLabel}</tspan>
    </text>
  );
}

// One horizontal bar per series, its cost per month: active ones in the chart blue, ended ones a
// lighter step of it, each labelled "$75.00/mo" (ended: "· ended Sep 2026"). `rows` are
// RecurringCostsTab's: recurringCosts' series plus their account, charge and labels.
function RecurringCostsChart({ rows }) {
  const data = rows.map(row => ({ ...row, name: row.template.vendor }));
  return (
    <ResponsiveContainer width="100%" height={data.length * ROW_HEIGHT + 8}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
        <XAxis type="number" dataKey="monthly" hide domain={[0, 'dataMax']} />
        <YAxis type="category" dataKey="name" hide />
        <Tooltip cursor={{ fill: 'rgba(0, 0, 0, 0.04)' }} content={<CostTooltip />} />
        <Bar dataKey="monthly" barSize={12} radius={[0, 4, 4, 0]} isAnimationActive={false}>
          {data.map(row => (
            <Cell key={row.template.id} className={`recurring-cost-bar${row.active ? '' : ' ended'}`} />
          ))}
          <LabelList dataKey="barLabel" content={<RowLabel data={data} />} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default RecurringCostsChart;
