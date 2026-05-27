import { describe, it, expect, vi } from "vitest";
import { makeMemexTools } from "../src/mcp/tools.ts";
import { DEFAULT_CONFIG } from "../src/core/config.ts";

describe("makeMemexTools", () => {
  it("returns exactly three tools in declared order", () => {
    const tools = makeMemexTools({
      config: DEFAULT_CONFIG,
      index: { search: vi.fn(), readSkillContent: vi.fn() } as any,
      getIndexStats: () => ({ size: 0, sourceCounts: {} }),
      getLastSyncAt: () => null,
      recordMatch: () => {},
      sessionId: () => "s",
    });
    expect(tools.map((t) => t.name)).toEqual(["memex_search", "memex_read_skill", "memex_status"]);
  });
});
