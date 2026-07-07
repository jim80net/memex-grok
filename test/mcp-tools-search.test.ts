import { describe, it, expect, vi } from "vitest";
import { makeSearchTool } from "../src/mcp/tools-search.ts";

interface FakeIndex {
  search: ReturnType<typeof vi.fn>;
}

function fakeResult(name: string, score: number) {
  return {
    skill: {
      name,
      type: "skill",
      location: `memex://grok-global/${name}.md`,
      description: `desc ${name}`,
    },
    score,
    bestQueryIndex: 0,
  };
}

describe("memex_search tool", () => {
  it("returns query_id and result list with portable handles from index", async () => {
    const index: FakeIndex = {
      search: vi.fn().mockResolvedValue([fakeResult("alpha", 0.9), fakeResult("beta", 0.7)]),
    };
    const tool = makeSearchTool({ index: index as any, defaultTopK: 5, defaultThreshold: 0.5 });
    const result = await tool.call({ query: "deploy spark" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.query_id).toMatch(/^q-/);
    expect(parsed.results.map((r: { name: string }) => r.name)).toEqual(["alpha", "beta"]);
    expect(parsed.results[0].relevance).toBe(0.9);
    expect(parsed.results[0].location).toBe("memex://grok-global/alpha.md");
    expect(index.search).toHaveBeenCalledWith("deploy spark", 5, 0.5, undefined);
  });

  it("honors top_k, threshold, and types args", async () => {
    const index: FakeIndex = { search: vi.fn().mockResolvedValue([]) };
    const tool = makeSearchTool({ index: index as any, defaultTopK: 5, defaultThreshold: 0.5 });
    await tool.call({ query: "x", top_k: 2, threshold: 0.7, types: ["skill", "rule"] });
    expect(index.search).toHaveBeenCalledWith("x", 2, 0.7, ["skill", "rule"]);
  });

  it("returns empty results array for no matches (not an error)", async () => {
    const index: FakeIndex = { search: vi.fn().mockResolvedValue([]) };
    const tool = makeSearchTool({ index: index as any, defaultTopK: 5, defaultThreshold: 0.5 });
    const result = await tool.call({ query: "anything" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.results).toEqual([]);
    expect(parsed.query_id).toBeTruthy();
    expect(result.isError).toBeUndefined();
  });

  it("rejects empty query with isError", async () => {
    const index: FakeIndex = { search: vi.fn() };
    const tool = makeSearchTool({ index: index as any, defaultTopK: 5, defaultThreshold: 0.5 });
    const result = await tool.call({ query: "   " });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/non-empty/);
    expect(index.search).not.toHaveBeenCalled();
  });

  it("generates a unique query_id per call", async () => {
    const index: FakeIndex = { search: vi.fn().mockResolvedValue([]) };
    const tool = makeSearchTool({ index: index as any, defaultTopK: 5, defaultThreshold: 0.5 });
    const a = JSON.parse((await tool.call({ query: "a" })).content[0].text).query_id;
    const b = JSON.parse((await tool.call({ query: "b" })).content[0].text).query_id;
    expect(a).not.toBe(b);
  });
});