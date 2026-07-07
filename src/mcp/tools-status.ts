import type { ToolHandler } from "./server.ts";
import type { GrokRouterConfig } from "../core/config.ts";

export interface IndexStats {
  size: number;
  sourceCounts: Record<string, number>;
}

export interface StatusDeps {
  config: GrokRouterConfig;
  getIndexStats: () => IndexStats;
  getLastSyncAt: () => string | null;
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
    inputSchema: { type: "object", properties: {}, required: [] },
    call: async () => {
      const stats = deps.getIndexStats();
      const payload = {
        index_size: stats.size,
        source_counts: stats.sourceCounts,
        last_sync_at: deps.getLastSyncAt(),
        sync_enabled: deps.config.sync.enabled,
        embedding_model: deps.config.embeddingModel,
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
    },
  };
}
