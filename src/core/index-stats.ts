import { loadCache } from "@jim80net/memex-core";
import type { SkillIndex } from "@jim80net/memex-core";
import type { IndexStats } from "../mcp/tools-status.ts";

/**
 * Derive memex_status counts from the on-disk index cache after build.
 *
 * memex-core's SkillIndex exposes skillCount but not a public iterator; the
 * persisted cache (written during build) carries per-entry `type` attribution.
 */
export async function computeIndexStats(
  index: Pick<SkillIndex, "skillCount">,
  cachePath: string,
  embeddingModel: string,
): Promise<IndexStats> {
  const size = index.skillCount;
  const cache = await loadCache(cachePath, embeddingModel);
  const sourceCounts: Record<string, number> = {};
  for (const entry of Object.values(cache.skills)) {
    sourceCounts[entry.type] = (sourceCounts[entry.type] ?? 0) + 1;
  }
  const typedTotal = Object.values(sourceCounts).reduce((sum, n) => sum + n, 0);
  if (size > 0 && typedTotal === 0) {
    // Post-build cache should always carry types; fail loud in status rather than lie.
    sourceCounts.unknown = size;
  }
  return { size, sourceCounts };
}