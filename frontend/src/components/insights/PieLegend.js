import React from 'react';

function PieLegend({ data, getColor }) {
  const total = data.reduce((sum, e) => sum + e.value, 0);
  return (
    <div className="pie-legend">
      {data.map((entry) => (
        <div key={entry.name} className="pie-legend-item">
          <span className="pie-legend-dot" style={{ background: getColor(entry.name) }} />
          <span className="pie-legend-name">{entry.name}</span>
          <span className="pie-legend-value">
            ${entry.value.toFixed(2)}
            <span className="pie-legend-pct"> ({((entry.value / total) * 100).toFixed(1)}%)</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export default PieLegend;
