import { agendaWeeks, AGENDA_DAYS } from '../utils/agenda';
import { formatSignedCents } from '../utils/money';

// "Today", or "Mon, Nov 9"
const dayLabel = (day, today) => {
  if (day === today) return 'Today';
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

// The Dashboard's next 30 days (Phase V, V6a), replacing "Due This Week": the recurring charges and
// income scheduled (`occurrences`, from the projection) by week, each marked scheduled, with its
// amount and the running total, and each week's total
function Agenda({ occurrences, today }) {
  const weeks = agendaWeeks(occurrences, today);
  return (
    <section className="agenda-section">
      <div className="section-header"><h3>Next {AGENDA_DAYS} days</h3></div>
      {weeks.length === 0 ? (
        <p className="no-data">Nothing scheduled in the next {AGENDA_DAYS} days.</p>
      ) : (
        <>
          <div className="agenda-columns">
            <span>Date</span><span /><span>Amount</span><span>Running total</span>
          </div>
          {weeks.map(week => (
            <div key={week.start} className="agenda-week">
              <div className="agenda-week-header">
                <h4>{week.label}</h4>
                <span className="agenda-week-total">{formatSignedCents(week.total)}</span>
              </div>
              <ul className="agenda-items">
                {week.items.map(item => (
                  <li key={`${item.recurring_id}-${item.date}`} className="agenda-item">
                    <span className="agenda-date">{dayLabel(item.date, today)}</span>
                    <span className="agenda-what">
                      <span className="agenda-vendor">{item.vendor}</span>
                      <span className="agenda-tag">scheduled</span>
                    </span>
                    <span className={`agenda-amount${item.cents > 0 ? ' in' : ''}`}>{formatSignedCents(item.cents)}</span>
                    <span className="agenda-running">{formatSignedCents(item.running)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

export default Agenda;
