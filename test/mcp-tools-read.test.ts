import { describe, it, expect, vi } from "vitest";
import { makeReadSkillTool } from "../src/mcp/tools-read.ts";
import { LocationHandleCodec } from "../src/mcp/location-handle.ts";
import { DEFAULT_CONFIG } from "../src/core/config.ts";
import { getGrokPaths } from "../src/core/paths.ts";

const locations = LocationHandleCodec.forSession("/work", DEFAULT_CONFIG, getGrokPaths());

describe("memex_read_skill tool", () => {
  it("returns the file content via index.readSkillContent using a portable handle", async () => {
    const abs = "/work/.grok/skills/a/SKILL.md";
    const index = { readSkillContent: vi.fn().mockResolvedValue("# A skill\nbody"), search: vi.fn() };
    const recordMatch = vi.fn();
    const tool = makeReadSkillTool({ index: index as any, locations, recordMatch, sessionId: () => "s-1" });
    const handle = locations.toHandle(abs);
    const result = await tool.call({ location: handle });
    expect(result.content[0].text).toBe("# A skill\nbody");
    expect(index.readSkillContent).toHaveBeenCalledWith(abs);
  });

  it("records telemetry when query_id is provided (absolute path stored)", async () => {
    const abs = "/work/.grok/skills/b/SKILL.md";
    const index = { readSkillContent: vi.fn().mockResolvedValue("body"), search: vi.fn() };
    const recordMatch = vi.fn();
    const tool = makeReadSkillTool({ index: index as any, locations, recordMatch, sessionId: () => "s-9" });
    await tool.call({ location: locations.toHandle(abs), query_id: "q-abc" });
    expect(recordMatch).toHaveBeenCalledWith({ location: abs, queryId: "q-abc", sessionId: "s-9" });
  });

  it("resolves by name when location is omitted", async () => {
    const abs = "/work/.grok/skills/c/SKILL.md";
    const index = {
      readSkillContent: vi.fn().mockResolvedValue("by-name"),
      search: vi.fn().mockResolvedValue([
        { skill: { name: "target-skill", location: abs }, score: 0.9, bestQueryIndex: 0 },
      ]),
    };
    const tool = makeReadSkillTool({ index: index as any, locations, recordMatch: vi.fn(), sessionId: () => "s-9" });
    const result = await tool.call({ name: "target-skill" });
    expect(result.content[0].text).toBe("by-name");
    expect(index.readSkillContent).toHaveBeenCalledWith(abs);
  });

  it("does not record telemetry when query_id is missing", async () => {
    const index = { readSkillContent: vi.fn().mockResolvedValue("body"), search: vi.fn() };
    const recordMatch = vi.fn();
    const tool = makeReadSkillTool({ index: index as any, locations, recordMatch, sessionId: () => "s-9" });
    await tool.call({ location: locations.toHandle("/work/.grok/skills/c/SKILL.md") });
    expect(recordMatch).not.toHaveBeenCalled();
  });

  it("returns isError when neither location nor name is provided", async () => {
    const index = { readSkillContent: vi.fn(), search: vi.fn() };
    const tool = makeReadSkillTool({ index: index as any, locations, recordMatch: () => {}, sessionId: () => "s-9" });
    const result = await tool.call({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/location|name/);
  });

  it("returns isError when readSkillContent throws", async () => {
    const index = { readSkillContent: vi.fn().mockRejectedValue(new Error("ENOENT")), search: vi.fn() };
    const tool = makeReadSkillTool({ index: index as any, locations, recordMatch: () => {}, sessionId: () => "s-9" });
    const result = await tool.call({ location: locations.toHandle("/work/.grok/skills/missing/SKILL.md") });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("ENOENT");
  });
});