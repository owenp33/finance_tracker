import {
  todayISO, daysInMonth, monthElapsed, monthEndLabel, sameDayLastMonth, dayRangeLabel, shiftPeriod, monthRangeLabel,
  dayNumber, shiftMonths, monthsFrom, shiftDays, weekStart,
} from '../utils/dates';

afterEach(() => jest.useRealTimers());

test("today is the local date, even late in the evening when it's tomorrow in UTC", () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 24, 23, 30));
  expect(todayISO()).toBe('2026-10-24');
});

test('counts the days in a month, leap years included', () => {
  expect(daysInMonth('2026-10')).toBe(31);
  expect(daysInMonth('2026-11')).toBe(30);
  expect(daysInMonth('2026-02')).toBe(28);
  expect(daysInMonth('2028-02')).toBe(29);
});

test("names a month's last day", () => {
  expect(monthEndLabel('2026-10')).toBe('Oct 31');
  expect(monthEndLabel('2026-11')).toBe('Nov 30');
  expect(monthEndLabel('2028-02')).toBe('Feb 29');
});

test('the same day last month, or its last day when last month is shorter', () => {
  expect(sameDayLastMonth('2026-11-05')).toBe('2026-10-05');
  expect(sameDayLastMonth('2026-10-31')).toBe('2026-09-30');
  expect(sameDayLastMonth('2026-03-30')).toBe('2026-02-28');
  expect(sameDayLastMonth('2026-01-15')).toBe('2025-12-15');
});

test('the same day some months away, or that month\'s last day when it is shorter', () => {
  expect(shiftMonths('2026-11-08', -3)).toBe('2026-08-08');
  expect(shiftMonths('2026-08-31', -6)).toBe('2026-02-28');
  expect(shiftMonths('2026-11-08', -12)).toBe('2025-11-08');
  expect(shiftMonths('2026-01-31', 1)).toBe('2026-02-28');
});

test('lists the months from one to another, both included', () => {
  expect(monthsFrom('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  expect(monthsFrom('2026-10', '2026-10')).toEqual(['2026-10']);
  expect(monthsFrom('2026-10', '2026-09')).toEqual([]);
});

test('moves days forward or back, across months and years', () => {
  expect(shiftDays('2026-11-29', 7)).toBe('2026-12-06');
  expect(shiftDays('2026-01-01', -1)).toBe('2025-12-31');
});

test("a week starts on the Sunday on or before the day", () => {
  expect(weekStart('2026-11-05')).toBe('2026-11-01');      // a Thursday
  expect(weekStart('2026-11-08')).toBe('2026-11-08');      // a Sunday
  expect(weekStart('2026-12-02')).toBe('2026-11-29');
});

test('names a run of days in one month', () => {
  expect(dayRangeLabel('2026-10-01', '2026-10-05')).toBe('Oct 1–5');
  expect(dayRangeLabel('2026-09-01', '2026-09-30')).toBe('Sep 1–30');
  expect(dayRangeLabel('2026-10-01', '2026-10-01')).toBe('Oct 1');
});

test('moves a month forward or back, across years', () => {
  expect(shiftPeriod('2026-11', -12)).toBe('2025-11');
  expect(shiftPeriod('2026-01', -1)).toBe('2025-12');
  expect(shiftPeriod('2026-12', 1)).toBe('2027-01');
  expect(shiftPeriod('2026-10', 0)).toBe('2026-10');
});

test('names a run of months', () => {
  expect(monthRangeLabel('2025-11', '2026-10')).toBe('Nov 2025–Oct 2026');
  expect(monthRangeLabel('2026-04', '2026-10')).toBe('Apr–Oct 2026');
  expect(monthRangeLabel('2026-09', '2026-09')).toBe('Sep 2026');
});

test('numbers days, so subtracting two gives the days between, across months and leap years', () => {
  expect(dayNumber('2027-02-28') - dayNumber('2026-11-05')).toBe(115);
  expect(dayNumber('2028-03-01') - dayNumber('2028-02-28')).toBe(2);
  expect(dayNumber('1970-01-02')).toBe(1);
});

test("the current month has passed by today's share of its days, today included", () => {
  expect(monthElapsed('2026-10', '2026-10-15')).toBe(15 / 31);
  expect(monthElapsed('2026-10', '2026-10-01')).toBe(1 / 31);
  expect(monthElapsed('2026-10', '2026-10-31')).toBe(1);
  expect(monthElapsed('2028-02', '2028-02-29')).toBe(1);
});

test('a past month has passed entirely and a future one not at all', () => {
  expect(monthElapsed('2026-09', '2026-10-15')).toBe(1);
  expect(monthElapsed('2025-12', '2026-01-02')).toBe(1);
  expect(monthElapsed('2026-11', '2026-10-15')).toBe(0);
  expect(monthElapsed('2027-01', '2026-12-31')).toBe(0);
});
