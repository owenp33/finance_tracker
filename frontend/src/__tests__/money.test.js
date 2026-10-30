import { formatDollars, formatWholeDollars, formatCents } from '../utils/money';

test('formats dollars with a leading sign and thousands separators', () => {
  expect(formatDollars(1234.5)).toBe('$1,234.50');
  expect(formatDollars(-815.07)).toBe('-$815.07');
  expect(formatDollars(0)).toBe('$0.00');
});

test('treats a missing amount as zero', () => {
  expect(formatDollars(undefined)).toBe('$0.00');
  expect(formatDollars(null)).toBe('$0.00');
});

test('rounds estimates to whole dollars', () => {
  expect(formatWholeDollars(43.55)).toBe('$44');
  expect(formatWholeDollars(1234.4)).toBe('$1,234');
  expect(formatWholeDollars(0.4)).toBe('$0');
  expect(formatWholeDollars(undefined)).toBe('$0');
});

test('formats amounts kept in cents', () => {
  expect(formatCents(123450)).toBe('$1,234.50');
  expect(formatCents(-81507)).toBe('-$815.07');
  expect(formatCents(0)).toBe('$0.00');
});
