/** One search hit retained so a later name+query_id read binds to that row. */
export interface QueryResultHit {
  name: string;
  location: string;
}

/** Process-local cap so a long-lived MCP session cannot grow without bound. */
export const QUERY_RESULT_MAP_CAP = 32;

/**
 * FIFO map of minted `query_id` → search hits for this MCP process.
 *
 * `memex_search` records when it mints a `query_id`. `memex_read_skill` looks
 * up `name` against that snapshot so a colliding corpus name cannot redirect
 * the read to a different location.
 */
export class QueryResultMap {
  private readonly entries = new Map<string, QueryResultHit[]>();
  private readonly insertionOrder: string[] = [];

  record(queryId: string, hits: readonly QueryResultHit[]): void {
    if (this.entries.has(queryId)) {
      this.entries.set(queryId, hits.map(cloneHit));
      return;
    }
    while (this.insertionOrder.length >= QUERY_RESULT_MAP_CAP) {
      const oldest = this.insertionOrder.shift();
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.insertionOrder.push(queryId);
    this.entries.set(queryId, hits.map(cloneHit));
  }

  /**
   * Resolve `name` against the snapshot for `queryId`.
   *
   * @throws if the query is unknown, the name is absent, or the name maps to
   *   more than one location in that query.
   */
  lookup(queryId: string, name: string): string {
    const hits = this.entries.get(queryId);
    if (hits === undefined) {
      throw new Error(`unknown query_id '${queryId}'`);
    }
    const exact = hits.filter((hit) => hit.name === name);
    if (exact.length === 0) {
      throw new Error(`name '${name}' not in query_id '${queryId}'`);
    }
    const locations = uniqueLocations(exact);
    if (locations.length > 1) {
      throw new Error(`ambiguous name '${name}' for query_id`);
    }
    return locations[0]!;
  }
}

function cloneHit(hit: QueryResultHit): QueryResultHit {
  return { name: hit.name, location: hit.location };
}

function uniqueLocations(hits: readonly QueryResultHit[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const hit of hits) {
    if (seen.has(hit.location)) continue;
    seen.add(hit.location);
    out.push(hit.location);
  }
  return out;
}
