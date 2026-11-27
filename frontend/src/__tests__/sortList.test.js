import { sortList } from '../components/transactions/utils';

const rows = [
  { id: 1, date: '2026-01-05' }, { id: 3, date: '2026-01-10' },
  { id: 2, date: '2026-01-10' }, { id: 4, date: '2026-01-05' },
];

test('newest first; same-day transactions most recently entered first', () => {
  expect(sortList(rows, 'date-desc').map(r => r.id)).toEqual([3, 2, 4, 1]);
});

test('oldest first; same-day transactions in the order entered', () => {
  expect(sortList(rows, 'date-asc').map(r => r.id)).toEqual([1, 4, 2, 3]);
});
