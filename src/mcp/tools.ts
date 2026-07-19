import type { SkillIndex, ScanRootRegistry } from "@jim80net/memex-core";
import type { ToolHandler } from "./server.ts";
import type { GrokRouterConfig } from "../core/config.ts";
import { makeSearchTool } from "./tools-search.ts";
import { makeReadSkillTool, type RecordMatchArgs } from "./tools-read.ts";
import { makeStatusTool, type IndexStats } from "./tools-status.ts";
import type { MeasuredSyncStatus } from "../core/sync-state.ts";

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
 * Wires all three memex MCP tool handlers in declared order:
 *   1. memex_search   — semantic search over the corpus
 *   2. memex_read_skill — full content fetch with telemetry
 *   3. memex_status   — installation / index health report
 */
export function makeMemexTools(deps: MemexToolsDeps): ToolHandler[] {
  return [
    makeSearchTool({
      index: deps.index,
      defaultTopK: deps.config.hooks.UserPromptSubmit.topK ?? 5,
      defaultThreshold: deps.config.hooks.UserPromptSubmit.threshold ?? 0.5,
    }),
    makeReadSkillTool({
      index: deps.index,
      registry: deps.registry,
      recordMatch: deps.recordMatch,
      sessionId: deps.sessionId,
    }),
    makeStatusTool({
      config: deps.config,
      getIndexStats: deps.getIndexStats,
      getSyncStatus: deps.getSyncStatus,
    }),
  ];
}
