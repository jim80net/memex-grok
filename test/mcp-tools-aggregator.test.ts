import { describe, it, expect, vi } from "vitest";
import { makeMemexTools } from "../src/mcp/tools.ts";
import { DEFAULT_CONFIG } from "../src/core/config.ts";
import { buildGrokScanRootRegistry } from "../src/mcp/location-handle.ts";
import { getGrokPaths } from "../src/core/paths.ts";

const registry = buildGrokScanRootRegistry("/work", DEFAULT_CONFIG, getGrokPaths());

function makeDeps(config = DEFAULT_CONFIG) {
  return {
    config,
    index: { search: vi.fn().mockResolvedValue([]), readSkillContent: vi.fn() } as any,
    registry,
    getIndexStats: () => ({ size: 0, sourceCounts: {} }),
    getSyncStatus: () => ({
      state: "never_synced" as const,
      lastSyncAt: null,
      lastAttemptAt: null,
      summary: "Sync is enabled but has not run yet.",
    }),
    recordMatch: () => {},
    sessionId: () => "s",
  };
}

describe("makeMemexTools", () => {
  it("returns exactly three tools in declared order", () => {
    const tools = makeMemexTools(makeDeps());
    expect(tools.map((t) => t.name)).toEqual(["memex_search", "memex_read_skill", "memex_status"]);
  });

  it("exposes only tools named by the configured allowlist", () => {
    const config = {
      ...DEFAULT_CONFIG,
      mcp: { ...DEFAULT_CONFIG.mcp, tools: ["memex_status", "not-a-memex-tool"] },
    };

    const tools = makeMemexTools(makeDeps(config));

    expect(tools.map((tool) => tool.name)).toEqual(["memex_status"]);
  });

  it("uses the published MCP search default independently of hook settings", async () => {
    const config = {
      ...DEFAULT_CONFIG,
      hooks: {
        ...DEFAULT_CONFIG.hooks,
        UserPromptSubmit: { ...DEFAULT_CONFIG.hooks.UserPromptSubmit, topK: 3 },
      },
    };
    const deps = makeDeps(config);
    const search = makeMemexTools(deps).find((tool) => tool.name === "memex_search")!;

    await search.call({ query: "deployment" });

    expect(deps.index.search).toHaveBeenCalledWith("deployment", 5, 0.5, undefined);
  });
});
