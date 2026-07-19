import { describe, it, expect, vi } from "vitest";
import { makeMemexTools } from "../src/mcp/tools.ts";
import { DEFAULT_CONFIG } from "../src/core/config.ts";
import { buildGrokScanRootRegistry } from "../src/mcp/location-handle.ts";
import { getGrokPaths } from "../src/core/paths.ts";

const registry = buildGrokScanRootRegistry("/work", DEFAULT_CONFIG, getGrokPaths());

describe("makeMemexTools", () => {
  it("returns exactly three tools in declared order", () => {
    const tools = makeMemexTools({
      config: DEFAULT_CONFIG,
      index: { search: vi.fn(), readSkillContent: vi.fn() } as any,
      registry,
      getIndexStats: () => ({ size: 0, sourceCounts: {} }),
      getSyncStatus: () => ({
        state: "never_synced",
        lastSyncAt: null,
        lastAttemptAt: null,
        summary: "Sync is enabled but has not run yet.",
      }),
      recordMatch: () => {},
      sessionId: () => "s",
    });
    expect(tools.map((t) => t.name)).toEqual(["memex_search", "memex_read_skill", "memex_status"]);
  });
});
