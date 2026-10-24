import { formatDollars } from '../utils/money';

test('formats dollars with a leading sign and thousands separators', () => {
  expect(formatDollars(1234.5)).toBe('$1,234.50');
  expect(formatDollars(-815.07)).toBe('-$815.07');
  expect(formatDollars(0)).toBe('$0.00');
});

test('treats a missing amount as zero', () => {
  expect(formatDollars(undefined)).toBe('$0.00');
  expect(formatDollars(null)).toBe('$0.00');
});
