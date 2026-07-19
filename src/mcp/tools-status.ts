import type { ToolHandler } from "./server.ts";
import type { GrokRouterConfig } from "../core/config.ts";
import type { MeasuredSyncStatus } from "../core/sync-state.ts";

export interface IndexStats {
  size: number;
  sourceCounts: Record<string, number>;
}

export interface StatusDeps {
  config: GrokRouterConfig;
  getIndexStats: () => IndexStats;
  getSyncStatus: () => MeasuredSyncStatus | Promise<MeasuredSyncStatus>;
}

/**
 * Creates the `memex_status` MCP tool handler.
 *
 * Reports memex installation state: index size, source counts by type,
 * last sync time, and embedding model. Useful for the model to introspect
 * whether memex_search is likely to be productive.
 */
export function makeStatusTool(deps: StatusDeps): ToolHandler {
  return {
    name: "memex_status",
    description:
      "Report memex installation state: index size, source counts by type, last sync time, and embedding model. Useful for the model to introspect whether memex_search is likely to be productive.",
    inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    call: async () => {
      const stats = deps.getIndexStats();
      const sync = await deps.getSyncStatus();
      const payload = {
        index_size: stats.size,
        source_counts: stats.sourceCounts,
        last_sync_at: sync.lastSyncAt,
        last_sync_attempt_at: sync.lastAttemptAt,
        sync_enabled: deps.config.sync.enabled,
        sync_state: sync.state,
        sync_status: sync.summary,
        embedding_model: deps.config.embeddingModel,
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
    },
  };
}
