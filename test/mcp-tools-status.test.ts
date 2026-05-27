import { describe, it, expect } from "vitest";
import { makeStatusTool } from "../src/mcp/tools-status.ts";
import { DEFAULT_CONFIG } from "../src/core/config.ts";

describe("memex_status tool", () => {
  it("returns a JSON content block with index size and sync state", async () => {
    const fakeIndex = { size: 42, sourceCounts: { skill: 30, rule: 12 } };
    const tool = makeStatusTool({
      config: DEFAULT_CONFIG,
      getIndexStats: () => fakeIndex,
      getLastSyncAt: () => "2026-05-25T12:00:00Z",
    });
    expect(tool.name).toBe("memex_status");
    const result = await tool.call({});
    const text = result.content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.index_size).toBe(42);
    expect(parsed.source_counts).toEqual({ skill: 30, rule: 12 });
    expect(parsed.last_sync_at).toBe("2026-05-25T12:00:00Z");
    expect(parsed.sync_enabled).toBe(false);
    expect(parsed.embedding_model).toBe(DEFAULT_CONFIG.embeddingModel);
  });

  it("emits null last_sync_at when unknown", async () => {
    const tool = makeStatusTool({
      config: DEFAULT_CONFIG,
      getIndexStats: () => ({ size: 0, sourceCounts: {} }),
      getLastSyncAt: () => null,
    });
    const result = await tool.call({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.last_sync_at).toBeNull();
  });
});
