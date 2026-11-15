import { shiftDays, weekStart } from './dates';

// The Dashboard's agenda (Phase V, V6a): the recurring charges and income scheduled in the next
// AGENDA_DAYS days (GET /recurring/projection), in cents.

export const AGENDA_DAYS = 30;

// "Nov 29"
const shortDate = (day) => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// The projection's occurrences in date order, grouped by week (Sunday to Saturday): each week's
// `start`, `label` ("This week", "Next week", "Week of Nov 29") and `total`, and its `items`: each
// occurrence with its amount in `cents` and `running`, the total of everything scheduled from
// today through it
export const agendaWeeks = (occurrences, today) => {
  const thisWeek = weekStart(today);
  const nextWeek = shiftDays(thisWeek, 7);
  const weeks = [];
  let running = 0;
  [...occurrences]
    .sort((a, b) => a.date.localeCompare(b.date) || a.vendor.localeCompare(b.vendor))
    .forEach(occurrence => {
      const cents = Math.round(occurrence.amount * 100);
      running += cents;
      const start = weekStart(occurrence.date);
      let week = weeks[weeks.length - 1];
      if (!week || week.start !== start) {
        const label = start === thisWeek ? 'This week' : start === nextWeek ? 'Next week' : `Week of ${shortDate(start)}`;
        week = { start, label, total: 0, items: [] };
        weeks.push(week);
      }
      week.total += cents;
      week.items.push({ ...occurrence, cents, running });
    });
  return weeks;
};
