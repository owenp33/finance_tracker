import { frequencyLabel, frequencyValue, parseFrequencyValue } from '../components/transactions/utils';

test('labels the standard schedules', () => {
  expect(frequencyLabel(7, 'days')).toBe('Weekly');
  expect(frequencyLabel(14, 'days')).toBe('Biweekly');
  expect(frequencyLabel(1, 'months')).toBe('Monthly');
  expect(frequencyLabel(3, 'months')).toBe('Quarterly');
  expect(frequencyLabel(12, 'months')).toBe('Annually');
});

test('labels schedules from before these options by their count', () => {
  expect(frequencyLabel(30, 'days')).toBe('Every 30 days');
  expect(frequencyLabel(1, 'days')).toBe('Every 1 day');
  expect(frequencyLabel(6, 'months')).toBe('Every 6 months');
});

test('round-trips a schedule through a select value', () => {
  expect(parseFrequencyValue(frequencyValue(3, 'months'))).toEqual({ frequency: 3, frequency_unit: 'months' });
});
