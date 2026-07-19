import { describe, it, expect } from "vitest";
import { makeStatusTool } from "../src/mcp/tools-status.ts";
import { DEFAULT_CONFIG } from "../src/core/config.ts";

describe("memex_status tool", () => {
  it("returns a JSON content block with index size and sync state", async () => {
    const fakeIndex = { size: 42, sourceCounts: { skill: 30, rule: 12 } };
    const tool = makeStatusTool({
      config: {
        ...DEFAULT_CONFIG,
        sync: { ...DEFAULT_CONFIG.sync, enabled: true },
      },
      getIndexStats: () => fakeIndex,
      getSyncStatus: () => ({
        state: "synced",
        lastSyncAt: "2026-05-25T12:00:00Z",
        lastAttemptAt: "2026-05-25T12:00:00Z",
        summary: "The last sync completed successfully at 2026-05-25T12:00:00Z.",
      }),
    });
    expect(tool.name).toBe("memex_status");
    const result = await tool.call({});
    const text = result.content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.index_size).toBe(42);
    expect(parsed.source_counts).toEqual({ skill: 30, rule: 12 });
    expect(parsed.last_sync_at).toBe("2026-05-25T12:00:00Z");
    expect(parsed.last_sync_attempt_at).toBe("2026-05-25T12:00:00Z");
    expect(parsed.sync_enabled).toBe(true);
    expect(parsed.sync_state).toBe("synced");
    expect(parsed.sync_status).toMatch(/completed successfully/);
    expect(parsed.embedding_model).toBe(DEFAULT_CONFIG.embeddingModel);
  });

  it.each([
    ["disabled", "Sync is disabled; no successful sync is recorded."],
    ["never_synced", "Sync is enabled but has not run yet."],
    ["failed", "The last sync attempt failed at 2026-05-25T13:00:00Z. No successful sync is recorded."],
    ["unknown", "Sync history is unavailable; run memex sync to measure it."],
  ] as const)("glosses %s state instead of leaving null ambiguous", async (state, summary) => {
    const tool = makeStatusTool({
      config: DEFAULT_CONFIG,
      getIndexStats: () => ({ size: 0, sourceCounts: {} }),
      getSyncStatus: async () => ({
        state,
        lastSyncAt: null,
        lastAttemptAt: state === "failed" ? "2026-05-25T13:00:00Z" : null,
        summary,
      }),
    });
    const result = await tool.call({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.last_sync_at).toBeNull();
    expect(parsed.sync_state).toBe(state);
    expect(parsed.sync_status).toBe(summary);
  });
});
