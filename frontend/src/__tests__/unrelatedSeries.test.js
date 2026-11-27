import { unrelatedSeriesByTransaction } from '../components/transactions/utils';

test('maps each transaction marked unrelated to the series it was marked against', () => {
  const templates = [
    { id: 5, vendor: 'ASPIRE', dismissed_transaction_ids: [496, 509] },
    { id: 6, vendor: 'Allina Health', dismissed_transaction_ids: [] },
    { id: 7, vendor: 'Loan Co', dismissed_transaction_ids: [509] },
  ];
  expect(unrelatedSeriesByTransaction(templates)).toEqual({
    496: [{ id: 5, vendor: 'ASPIRE' }],
    509: [{ id: 5, vendor: 'ASPIRE' }, { id: 7, vendor: 'Loan Co' }],
  });
});

test('templates without the field contribute nothing', () => {
  expect(unrelatedSeriesByTransaction([{ id: 1, vendor: 'Old' }])).toEqual({});
});
