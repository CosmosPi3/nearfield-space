// Runs `fn` over `items` with at most `limit` in flight at once — used so a
// wide discovery hop doesn't fire dozens of simultaneous feature-extraction
// requests (each of which may trigger a multi-second server-side pipeline).
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
