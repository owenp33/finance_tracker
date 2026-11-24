import { monthAxis, dayAxis, monthStartsAfter } from '../utils/monthTicks';
import { dayNumber, monthsFrom } from '../utils/dates';
const labels = ({ ticks, format }) => ticks.map((month, i) => format(month, i));
const TEN_YEARS = monthsFrom('2017-01', '2026-11');

describe('month labels on an axis', () => {
  test('a short run in plenty of room names every month, the year on the first and on January', () => {
    expect(labels(monthAxis(monthsFrom('2026-10', '2027-02'), 600))).toEqual(['Oct 2026', 'Nov', 'Dec', 'Jan 2027', 'Feb']);
  });

  test('before its width is known, every month is named', () => {
    expect(monthAxis(TEN_YEARS, null).ticks).toHaveLength(119);
  });

  test('a longer run steps through the calendar, evenly, as far as it needs to fit', () => {
    // 64px a month label: 240px fits 3, so Feb–Nov names every third month (Jan, Apr, Jul, Oct)
    expect(labels(monthAxis(monthsFrom('2026-02', '2026-11'), 240))).toEqual(['Apr 2026', 'Jul', 'Oct']);
    // 400px fits 6: every other month
    expect(labels(monthAxis(monthsFrom('2026-01', '2026-12'), 400))).toEqual(['Jan 2026', 'Mar', 'May', 'Jul', 'Sep', 'Nov']);
  });

  test('ten years name years alone, every year or every other year, whatever fits', () => {
    // 44px a year label: 1,080px fits 24, so every January; a small panel's 256px fits 5
    expect(labels(monthAxis(TEN_YEARS, 1080))).toEqual(['2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026']);
    expect(labels(monthAxis(TEN_YEARS, 256))).toEqual(['2018', '2020', '2022', '2024', '2026']);
    expect(labels(monthAxis(TEN_YEARS, 150))).toEqual(['2019', '2022', '2025']);
    expect(labels(monthAxis(TEN_YEARS, 120))).toEqual(['2020', '2025']);
  });

  test('labels never come closer than a label needs, however narrow the axis', () => {
    [100, 200, 300, 500, 800, 1200].forEach(width => {
      const { ticks } = monthAxis(TEN_YEARS, width);
      expect(ticks.length).toBeGreaterThan(0);
      expect(ticks.length * 44).toBeLessThanOrEqual(Math.max(width, 44));
    });
  });
});

describe('month labels on an axis of days', () => {
  test('the months whose 1st falls after one day and on or before another', () => {
    expect(monthStartsAfter('2026-11-20', '2027-02-18')).toEqual(['2026-12', '2027-01', '2027-02']);
    expect(monthStartsAfter('2026-11-01', '2026-12-01')).toEqual(['2026-12']);
    expect(monthStartsAfter('2026-11-20', '2026-11-30')).toEqual([]);
  });

  test("each label sits on its month's 1st, counted in days from an origin", () => {
    const { ticks, format } = dayAxis(['2026-12', '2027-01', '2027-02'], 600, dayNumber('2026-12-01'));
    expect(ticks).toEqual([0, 31, 62]);
    expect(ticks.map((day, i) => format(day, i))).toEqual(['Dec 2026', 'Jan 2027', 'Feb']);
  });
});
