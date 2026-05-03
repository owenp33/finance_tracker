function UpcomingList({ items }) {
  if (!items || items.length === 0) {
    return <p className="no-data">No recurring transactions due in the next 7 days.</p>;
  }

  return (
    <div className="upcoming-list">
      {items.map(r => (
        <div key={r.id} className="upcoming-item">
          <div className="upcoming-info">
            <strong>{r.vendor}</strong>
            <span>{r.category} &bull; {r.next_date}</span>
          </div>
          <span className={`upcoming-amount ${r.amount >= 0 ? 'green' : 'red'}`}>
            {r.amount >= 0 ? '+' : ''}${Math.abs(r.amount).toFixed(2)}
          </span>
        </div>
      ))}
    </div>
  );
}

export default UpcomingList;
