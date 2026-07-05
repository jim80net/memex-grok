import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { computeIndexStats } from "../src/core/index-stats.ts";

const SAMPLE_CACHE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "memex-cache-sample.json");

describe("computeIndexStats", () => {
  it("returns empty stats for an empty index", async () => {
    const stats = await computeIndexStats(
      { skillCount: 0 },
      "/nonexistent/cache.json",
      "Xenova/all-MiniLM-L6-v2",
    );
    expect(stats).toEqual({ size: 0, sourceCounts: {} });
  });

  it("counts types from the persisted cache after build", async () => {
    const stats = await computeIndexStats(
      { skillCount: 3 },
      SAMPLE_CACHE,
      "Xenova/all-MiniLM-L6-v2",
    );
    expect(stats.size).toBe(3);
    expect(stats.sourceCounts).toEqual({ skill: 2, rule: 1 });
  });
});