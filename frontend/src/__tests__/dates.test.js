import { todayISO } from '../utils/dates';

afterEach(() => jest.useRealTimers());

test("today is the local date, even late in the evening when it's tomorrow in UTC", () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 24, 23, 30));
  expect(todayISO()).toBe('2026-10-24');
});
