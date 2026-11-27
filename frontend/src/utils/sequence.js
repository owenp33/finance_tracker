// Runs an async step for each item, one after another and never two at once; stops at the first
// failure. Bulk actions use it so the server handles their requests one at a time.
export const forEachInOrder = async (items, step) => {
  for (const item of items) await step(item);
};
