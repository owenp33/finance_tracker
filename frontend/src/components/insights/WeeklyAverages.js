import React from 'react';

function WeeklyAverages({ trends }) {
  return (
    <div className="chart-container">
      <h3>Weekly Averages</h3>
      <div className="trends-summary">
        <div className="trend-item">
          <span className="trend-label">Avg Weekly Income:</span>
          <span className="trend-value income">${trends.weekly_avg_income.toFixed(2)}</span>
        </div>
        <div className="trend-item">
          <span className="trend-label">Avg Weekly Expenses:</span>
          <span className="trend-value expenses">${trends.weekly_avg_expenses.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}

export default WeeklyAverages;
