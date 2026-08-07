/**
 * PostgREST caps an unpaginated select at 1000 rows and returns them
 * silently truncated rather than erroring — a table that's grown past that
 * (send_log, inbound_messages, lead_activities all have) loses whichever
 * end of the result the query's own ORDER BY put last. Found this the hard
 * way more than once: the Bulk SMS progress counter stalling short of the
 * real total, and the dashboard's "SMS Sent" trend showing 0 for a day that
 * genuinely had 1600+ sends, both traced back to exactly this.
 *
 * Takes a page-fetcher rather than a query builder directly so callers keep
 * full control of their own filters/select shape/order — this just repeats
 * whatever that callback does across successive .range() windows.
 */
const PAGE_SIZE = 1000;

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}
