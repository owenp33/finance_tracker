import { previewImport } from '../api/imports';
import { uploadFile } from '../api/client';

jest.mock('../api/client');

const file = new File(['x'], 'bank.csv', { type: 'text/csv' });

test('preview sends the unmatched-accounts option, defaulting to create', () => {
  previewImport(file);
  expect(uploadFile).toHaveBeenCalledWith('/api/import/preview', file, { unmatched: 'create' });
});

test('preview sends the target account only for the "existing account" option', () => {
  previewImport(file, { unmatched: 'account', targetAccountId: '7' });
  expect(uploadFile).toHaveBeenLastCalledWith('/api/import/preview', file, { unmatched: 'account', target_account_id: '7' });

  previewImport(file, { unmatched: 'skip', targetAccountId: '7' });
  expect(uploadFile).toHaveBeenLastCalledWith('/api/import/preview', file, { unmatched: 'skip' });
});
