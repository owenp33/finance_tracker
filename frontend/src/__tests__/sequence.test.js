import { forEachInOrder } from '../utils/sequence';

test('runs one step at a time, in order', async () => {
  const log = [];
  let releaseFirst;
  const step = (item) => new Promise(resolve => {
    log.push(`start ${item}`);
    const finish = () => { log.push(`end ${item}`); resolve(); };
    if (item === 1) releaseFirst = finish; else finish();
  });

  const done = forEachInOrder([1, 2, 3], step);
  await Promise.resolve();
  expect(log).toEqual(['start 1']);   // 2 waits for 1 to finish
  releaseFirst();
  await done;
  expect(log).toEqual(['start 1', 'end 1', 'start 2', 'end 2', 'start 3', 'end 3']);
});

test('stops at the first failure', async () => {
  const seen = [];
  const step = async (item) => {
    seen.push(item);
    if (item === 2) throw new Error('no');
  };
  await expect(forEachInOrder([1, 2, 3], step)).rejects.toThrow('no');
  expect(seen).toEqual([1, 2]);
});
