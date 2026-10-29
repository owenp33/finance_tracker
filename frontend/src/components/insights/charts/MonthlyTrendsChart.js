import React from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

function MonthlyTrendsChart({ data }) {
  return (
    <div className="chart-container full-width">
      <h3>Monthly Trends</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" />
          <YAxis />
          <Tooltip formatter={(value) => `$${value.toFixed(2)}`} />
          <Legend />
          <Line type="monotone" dataKey="income"   stroke="#00C49F" strokeWidth={2} name="Income" />
          <Line type="monotone" dataKey="expenses" stroke="#FF8042" strokeWidth={2} name="Expenses" />
          <Line type="monotone" dataKey="net"      stroke="#0088FE" strokeWidth={2} name="Net" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default MonthlyTrendsChart;
