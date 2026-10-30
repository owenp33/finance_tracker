import { todayISO, daysInMonth, monthElapsed } from '../utils/dates';

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
