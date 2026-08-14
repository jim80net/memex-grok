import { homedir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { encodePortableLocation } from "@jim80net/memex-core";
import { makeReadSkillTool } from "../src/mcp/tools-read.ts";
import { makeSearchTool } from "../src/mcp/tools-search.ts";
import { QueryResultMap } from "../src/mcp/query-result-map.ts";
import { buildGrokScanRootRegistry } from "../src/mcp/location-handle.ts";
import { DEFAULT_CONFIG } from "../src/core/config.ts";
import { getGrokPaths } from "../src/core/paths.ts";

const cwd = "/work";
const registry = await buildGrokScanRootRegistry(cwd, DEFAULT_CONFIG, getGrokPaths());
const home = homedir();

function portableHandle(abs: string): string {
  const handle = encodePortableLocation(registry, abs);
  if (!handle) throw new Error(`no handle for ${abs}`);
  return handle;
}

describe("memex_read_skill tool", () => {
  it("returns the file content via index.readSkillContent using a portable handle", async () => {
    const abs = join(home, ".grok", "skills", "a", "SKILL.md");
    const handle = portableHandle(abs);
    const index = { readSkillContent: vi.fn().mockResolvedValue("# A skill\nbody"), search: vi.fn() };
    const recordMatch = vi.fn();
    const tool = makeReadSkillTool({ index: index as any, registry, recordMatch, sessionId: () => "s-1" });
    const result = await tool.call({ location: handle });
    expect(result.content[0].text).toBe("# A skill\nbody");
    expect(index.readSkillContent).toHaveBeenCalledWith(handle);
  });

  it("records telemetry with portable handle when query_id is provided", async () => {
    const abs = join(home, ".grok", "skills", "b", "SKILL.md");
    const handle = portableHandle(abs);
    const index = { readSkillContent: vi.fn().mockResolvedValue("body"), search: vi.fn() };
    const recordMatch = vi.fn();
    const tool = makeReadSkillTool({ index: index as any, registry, recordMatch, sessionId: () => "s-9" });
    await tool.call({ location: handle, query_id: "q-abc" });
    expect(recordMatch).toHaveBeenCalledWith({ location: handle, queryId: "q-abc", sessionId: "s-9" });
  });

  it("resolves by name when location is omitted", async () => {
    const abs = join(cwd, ".grok", "skills", "c", "SKILL.md");
    const handle = portableHandle(abs);
    const index = {
      readSkillContent: vi.fn().mockResolvedValue("by-name"),
      search: vi.fn().mockResolvedValue([
        { skill: { name: "target-skill", location: handle }, score: 0.9, bestQueryIndex: 0 },
      ]),
    };
    const tool = makeReadSkillTool({ index: index as any, registry, recordMatch: vi.fn(), sessionId: () => "s-9" });
    const result = await tool.call({ name: "target-skill" });
    expect(result.content[0].text).toBe("by-name");
    expect(index.readSkillContent).toHaveBeenCalledWith(handle);
  });

  it("does not record telemetry when query_id is missing", async () => {
    const abs = join(home, ".grok", "skills", "c", "SKILL.md");
    const handle = portableHandle(abs);
    const index = { readSkillContent: vi.fn().mockResolvedValue("body"), search: vi.fn() };
    const recordMatch = vi.fn();
    const tool = makeReadSkillTool({ index: index as any, registry, recordMatch, sessionId: () => "s-9" });
    await tool.call({ location: handle });
    expect(recordMatch).not.toHaveBeenCalled();
  });

  it("returns isError when neither location nor name is provided", async () => {
    const index = { readSkillContent: vi.fn(), search: vi.fn() };
    const tool = makeReadSkillTool({ index: index as any, registry, recordMatch: () => {}, sessionId: () => "s-9" });
    const result = await tool.call({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/location|name/);
  });

  it("returns isError when readSkillContent throws", async () => {
    const abs = join(home, ".grok", "skills", "missing", "SKILL.md");
    const handle = portableHandle(abs);
    const index = { readSkillContent: vi.fn().mockRejectedValue(new Error("ENOENT")), search: vi.fn() };
    const tool = makeReadSkillTool({ index: index as any, registry, recordMatch: () => {}, sessionId: () => "s-9" });
    const result = await tool.call({ location: handle });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("ENOENT");
  });

  it("rejects /etc/shadow via the tool (memex-grok#19)", async () => {
    const index = { readSkillContent: vi.fn(), search: vi.fn() };
    const tool = makeReadSkillTool({ index: index as any, registry, recordMatch: vi.fn(), sessionId: () => "s-9" });
    const result = await tool.call({ location: "/etc/shadow" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/unrecognized location/);
    expect(index.readSkillContent).not.toHaveBeenCalled();
  });

  it("scrubs /home/ from skill body before returning (#22)", async () => {
    const abs = join(home, ".grok", "skills", "leaky", "SKILL.md");
    const handle = portableHandle(abs);
    const leaky = `See config at ${home}/x for details`;
    const index = { readSkillContent: vi.fn().mockResolvedValue(leaky), search: vi.fn() };
    const tool = makeReadSkillTool({ index: index as any, registry, recordMatch: vi.fn(), sessionId: () => "s-1" });
    const result = await tool.call({ location: handle });
    expect(result.content[0].text).toBe("See config at ~/x for details");
    expect(result.content[0].text).not.toMatch(/\/home\//);
  });

  it("rejects traversal portable handle via the tool (memex-grok#19)", async () => {
    const index = { readSkillContent: vi.fn(), search: vi.fn() };
    const tool = makeReadSkillTool({ index: index as any, registry, recordMatch: vi.fn(), sessionId: () => "s-9" });
    const result = await tool.call({ location: "memex://grok-global/../../etc/shadow" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/escapes scan root/);
    expect(index.readSkillContent).not.toHaveBeenCalled();
  });

  it("binds name+query_id to the grok-global hit when two exact names exist", async () => {
    const grokHandle = portableHandle(join(home, ".grok", "skills", "subagent-patterns", "SKILL.md"));
    const claudeHandle = portableHandle(join(home, ".claude", "skills", "subagent-patterns", "SKILL.md"));
    const queryResults = new QueryResultMap();
    const index = {
      search: vi.fn().mockResolvedValue([
        {
          skill: { name: "subagent-patterns", location: grokHandle, type: "skill", description: "grok" },
          score: 0.9,
          bestQueryIndex: 0,
        },
      ]),
      readSkillContent: vi.fn(async (location: string) => {
        if (location === grokHandle) return "GROK-SUBAGENT-BYTES";
        if (location === claudeHandle) return "CLAUDE-SUBAGENT-BYTES";
        throw new Error(`unexpected location ${location}`);
      }),
    };
    const search = makeSearchTool({
      index: index as never,
      defaultTopK: 5,
      defaultThreshold: 0,
      queryResults,
    });
    const read = makeReadSkillTool({
      index: index as never,
      registry,
      recordMatch: vi.fn(),
      sessionId: () => "s-9",
      queryResults,
    });

    const searchResult = await search.call({ query: "subagent patterns" });
    const payload = JSON.parse(searchResult.content[0]!.text) as { query_id: string };
    const byName = await read.call({ name: "subagent-patterns", query_id: payload.query_id });

    expect(byName.isError).not.toBe(true);
    expect(byName.content[0]!.text).toBe("GROK-SUBAGENT-BYTES");
    expect(index.readSkillContent).toHaveBeenCalledWith(grokHandle);
  });

  it("fails closed on name-only when two exact names have distinct locations", async () => {
    const grokHandle = portableHandle(join(home, ".grok", "skills", "subagent-patterns", "SKILL.md"));
    const claudeHandle = portableHandle(join(home, ".claude", "skills", "subagent-patterns", "SKILL.md"));
    const index = {
      search: vi.fn().mockResolvedValue([
        {
          skill: { name: "subagent-patterns", location: grokHandle, type: "skill", description: "grok" },
          score: 0.9,
          bestQueryIndex: 0,
        },
        {
          skill: { name: "subagent-patterns", location: claudeHandle, type: "skill", description: "claude" },
          score: 0.8,
          bestQueryIndex: 0,
        },
      ]),
      readSkillContent: vi.fn(),
    };
    const tool = makeReadSkillTool({
      index: index as never,
      registry,
      recordMatch: vi.fn(),
      sessionId: () => "s-9",
    });
    const result = await tool.call({ name: "subagent-patterns" });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/ambiguous/);
    expect(index.readSkillContent).not.toHaveBeenCalled();
  });

  it("still resolves a unique name without query_id", async () => {
    const abs = join(cwd, ".grok", "skills", "c", "SKILL.md");
    const handle = portableHandle(abs);
    const index = {
      readSkillContent: vi.fn().mockResolvedValue("by-name"),
      search: vi.fn().mockResolvedValue([
        { skill: { name: "target-skill", location: handle }, score: 0.9, bestQueryIndex: 0 },
      ]),
    };
    const tool = makeReadSkillTool({ index: index as never, registry, recordMatch: vi.fn(), sessionId: () => "s-9" });
    const result = await tool.call({ name: "target-skill" });
    expect(result.isError).not.toBe(true);
    expect(result.content[0]!.text).toBe("by-name");
    expect(index.readSkillContent).toHaveBeenCalledWith(handle);
  });
});
