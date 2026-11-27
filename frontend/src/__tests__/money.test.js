import { formatDollars, formatWholeDollars, formatCents, formatSignedCents, formatCompactDollars } from '../utils/money';

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

test('a change in cents, signed: a plus for money in, a minus for money out, none for no change', () => {
  expect(formatSignedCents(598541)).toBe('+$5,985.41');
  expect(formatSignedCents(-50000)).toBe('-$500.00');
  expect(formatSignedCents(0)).toBe('$0.00');
});

test('compact dollars for chart axes: whole dollars under $1,000, then thousands', () => {
  expect(formatCompactDollars(350)).toBe('$350');
  expect(formatCompactDollars(7274.13)).toBe('$7.3k');
  expect(formatCompactDollars(14000)).toBe('$14k');
  expect(formatCompactDollars(-991.45)).toBe('-$991');
  expect(formatCompactDollars(0)).toBe('$0');
});
