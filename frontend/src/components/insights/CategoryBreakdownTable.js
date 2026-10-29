import React from 'react';

function CategoryBreakdownTable({ rows }) {
  return (
    <div className="chart-container full-width">
      <h3>Spending Breakdown</h3>
      <div className="category-table">
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Total</th>
              <th>Average</th>
              <th>Count</th>
              <th>Percentage</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((cat, index) => (
              <tr key={index}>
                <td>{cat.category}</td>
                <td>${cat.total.toFixed(2)}</td>
                <td>${cat.average.toFixed(2)}</td>
                <td>{cat.count}</td>
                <td>{cat.percentage}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default CategoryBreakdownTable;
