import type { SkillIndex, ScanRootRegistry } from "@jim80net/memex-core";
import type { ToolHandler } from "./server.ts";
import type { GrokRouterConfig } from "../core/config.ts";
import { DEFAULT_MCP_SEARCH_TOP_K, makeSearchTool } from "./tools-search.ts";
import { makeReadSkillTool, type RecordMatchArgs } from "./tools-read.ts";
import { makeStatusTool, type IndexStats } from "./tools-status.ts";
import type { MeasuredSyncStatus } from "../core/sync-state.ts";
import { QueryResultMap } from "./query-result-map.ts";

export interface MemexToolsDeps {
  config: GrokRouterConfig;
  index: SkillIndex;
  registry: ScanRootRegistry;
  getIndexStats: () => IndexStats;
  getSyncStatus: () => MeasuredSyncStatus | Promise<MeasuredSyncStatus>;
  recordMatch: (args: RecordMatchArgs) => void | Promise<void>;
  sessionId: () => string;
}

/**
 * Declares all three memex MCP tool handlers in stable order, then applies the
 * configured `mcp.tools` allowlist:
 *   1. memex_search   — semantic search over the corpus
 *   2. memex_read_skill — full content fetch with telemetry
 *   3. memex_status   — installation / index health report
 */
export function makeMemexTools(deps: MemexToolsDeps): ToolHandler[] {
  const queryResults = new QueryResultMap();
  const declaredTools = [
    makeSearchTool({
      index: deps.index,
      defaultTopK: DEFAULT_MCP_SEARCH_TOP_K,
      defaultThreshold: deps.config.hooks.UserPromptSubmit.threshold ?? 0.5,
      queryResults,
    }),
    makeReadSkillTool({
      index: deps.index,
      registry: deps.registry,
      recordMatch: deps.recordMatch,
      sessionId: deps.sessionId,
      queryResults,
    }),
    makeStatusTool({
      config: deps.config,
      getIndexStats: deps.getIndexStats,
      getSyncStatus: deps.getSyncStatus,
    }),
  ];
  const enabledTools = new Set(deps.config.mcp.tools);
  return declaredTools.filter((tool) => enabledTools.has(tool.name));
}
