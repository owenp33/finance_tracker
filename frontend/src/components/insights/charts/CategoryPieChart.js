import React from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import PieLegend from '../PieLegend';

// Generic category pie chart, used for both "Spending by Category" and
// "Income by Category" (previously duplicated blocks in InsightsView).
function CategoryPieChart({ title, data, getColor, emptyLabel }) {
  return (
    <div className="chart-container">
      <h3>{title}</h3>
      {data.length > 0 ? (
        <div className="pie-chart-row">
          <ResponsiveContainer width={220} height={220}>
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" outerRadius={90} dataKey="value" labelLine={false}>
                {data.map((entry) => (
                  <Cell key={entry.name} fill={getColor(entry.name)} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => `$${value.toFixed(2)}`} />
            </PieChart>
          </ResponsiveContainer>
          <PieLegend data={data} getColor={getColor} />
        </div>
      ) : (
        <p className="no-data">{emptyLabel}</p>
      )}
    </div>
  );
}

export default CategoryPieChart;
