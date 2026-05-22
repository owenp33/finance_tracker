const formatDate = (dateStr) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const formatAmount = (amount) =>
  `${amount >= 0 ? '+' : '-'}$${Math.abs(amount).toFixed(2)}`;

function UpcomingList({ items }) {
  if (!items || items.length === 0) {
    return <p className="no-data">No recurring transactions due in the next 7 days.</p>;
  }

  return (
    <div className="upcoming-chips">
      {items.map(r => (
        <div key={r.id} className="upcoming-chip">
          <span className="chip-date">{formatDate(r.next_date)}</span>
          <span className="chip-vendor">{r.vendor}</span>
          <span className={`chip-amount ${r.amount >= 0 ? 'green' : 'red'}`}>
            {formatAmount(r.amount)}
          </span>
        </div>
      ))}
    </div>
  );
}

export default UpcomingList;
