// Month labels for chart axes: evenly spaced, and never closer than a label needs, however long
// the run of months (Phase F wrap-up, backlog #29). Each chart measures its axis (Recharts'
// ResponsiveContainer onResize) and asks monthAxis (or dayAxis) which months to label.

import { dayNumber, monthsFrom, shiftPeriod } from './dates';

const MONTH_LABEL_WIDTH = 64;   // px: "Jan 2026" at 11–12px, plus a gap
const YEAR_LABEL_WIDTH = 44;    // px: "2026", plus a gap

// Months between labels, smallest first: every 1, 2, 3 or 6 months on the calendar (every 3:
// Jan, Apr, Jul, Oct), then every January, then every 2, 3, 5 or 10 years
const STEPS = [1, 2, 3, 6, 12, 24, 36, 60, 120];

const onStep = (month, step) => {
  const [year, m] = month.split('-').map(Number);
  return step < 12 ? (m - 1) % step === 0 : m === 1 && year % (step / 12) === 0;
};

// "Oct", or with the year for a January or the first label: "Jan 2026"
export const monthTick = (month, index) => {
  const [year, m] = month.split('-').map(Number);
  const withYear = m === 1 || index === 0;
  return new Date(year, m - 1, 1).toLocaleDateString('en-US', withYear ? { month: 'short', year: 'numeric' } : { month: 'short' });
};

// Which of `months` ('YYYY-MM', in order) to label on an axis `width` px wide, and how to word them:
// the smallest step whose labels fit (every month while the width isn't known), named by month
// ("Apr 2026", "Jul", "Oct", "Jan 2027") or, a year or more apart, by year alone ("2018", "2020")
export const monthAxis = (months, width) => {
  const fits = (step) => {
    const room = width == null ? Infinity : Math.max(1, Math.floor(width / (step < 12 ? MONTH_LABEL_WIDTH : YEAR_LABEL_WIDTH)));
    return months.filter(month => onStep(month, step)).length <= room;
  };
  const step = STEPS.find(fits) ?? STEPS[STEPS.length - 1];
  const ticks = months.filter(month => onStep(month, step));
  return {
    ticks: ticks.length > 0 ? ticks : months.slice(0, 1),
    format: step < 12 ? monthTick : (month) => month.slice(0, 4),
  };
};

// The months whose 1st falls after day `from` and on or before day `to` ('YYYY-MM-DD'), as 'YYYY-MM'
export const monthStartsAfter = (from, to) => monthsFrom(shiftPeriod(from.slice(0, 7), 1), to.slice(0, 7));

// monthAxis for an axis of days (utils/dates.js dayNumber, less `origin`): a tick on the 1st of each
// labelled month, worded as monthAxis words it
export const dayAxis = (months, width, origin = 0) => {
  const { ticks, format } = monthAxis(months, width);
  const days = ticks.map(month => dayNumber(`${month}-01`) - origin);
  const monthOn = Object.fromEntries(days.map((day, i) => [day, ticks[i]]));
  return { ticks: days, format: (day, index) => (monthOn[day] ? format(monthOn[day], index) : '') };
};
