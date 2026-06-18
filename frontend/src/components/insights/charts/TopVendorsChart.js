import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';

function TopVendorsChart({ data }) {
  return (
    <div className="chart-container full-width">
      <h3>Top 10 Vendors by Spending</h3>
      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="vendor" angle={-45} textAnchor="end" height={100} />
            <YAxis />
            <Tooltip formatter={(value) => `$${value.toFixed(2)}`} />
            <Bar dataKey="amount" fill="#FF8042" />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <p className="no-data">No vendor data available</p>
      )}
    </div>
  );
}

export default TopVendorsChart;
