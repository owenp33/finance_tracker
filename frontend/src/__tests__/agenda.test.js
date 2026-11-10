import { agendaWeeks } from '../utils/agenda';

// What GET /recurring/projection lists for the 30 days from Thursday, Nov 5, 2026
const occurrence = (recurringId, date, vendor, amount) => ({ recurring_id: recurringId, account_id: 1, date, vendor, category: 'Bills', amount });
const AGENDA = [
  occurrence(2, '2026-12-01', 'HLWW School District', 1700),
  occurrence(6, '2026-11-05', 'Allina Health', -87.38),
  occurrence(9, '2026-11-09', 'Gym', -30),
  occurrence(5, '2026-11-30', 'ASPIRE', -75),
  occurrence(7, '2026-12-02', 'Anthropic', -20),
];

test('the scheduled items in date order, grouped by week from Sunday, with each week\'s total', () => {
  expect(agendaWeeks(AGENDA, '2026-11-05').map(w => [w.start, w.label, w.total, w.items.map(i => i.vendor)])).toEqual([
    ['2026-11-01', 'This week', -8738, ['Allina Health']],
    ['2026-11-08', 'Next week', -3000, ['Gym']],
    ['2026-11-29', 'Week of Nov 29', 160500, ['ASPIRE', 'HLWW School District', 'Anthropic']],
  ]);
});

test('each item carries its amount in cents and the running total of everything scheduled through it', () => {
  const items = agendaWeeks(AGENDA, '2026-11-05').flatMap(w => w.items);
  expect(items.map(i => [i.date, i.cents, i.running])).toEqual([
    ['2026-11-05', -8738, -8738],
    ['2026-11-09', -3000, -11738],
    ['2026-11-30', -7500, -19238],
    ['2026-12-01', 170000, 150762],
    ['2026-12-02', -2000, 148762],
  ]);
});

test('nothing scheduled, no weeks', () => {
  expect(agendaWeeks([], '2026-11-05')).toEqual([]);
});
