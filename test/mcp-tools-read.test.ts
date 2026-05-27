import { describe, it, expect, vi } from "vitest";
import { makeReadSkillTool } from "../src/mcp/tools-read.ts";

describe("memex_read_skill tool", () => {
  it("returns the file content via index.readSkillContent", async () => {
    const index = { readSkillContent: vi.fn().mockResolvedValue("# A skill\nbody") };
    const recordMatch = vi.fn();
    const tool = makeReadSkillTool({ index: index as any, recordMatch, sessionId: () => "s-1" });
    const result = await tool.call({ location: "/a.md" });
    expect(result.content[0].text).toBe("# A skill\nbody");
    expect(index.readSkillContent).toHaveBeenCalledWith("/a.md");
  });

  it("records telemetry when query_id is provided", async () => {
    const index = { readSkillContent: vi.fn().mockResolvedValue("body") };
    const recordMatch = vi.fn();
    const tool = makeReadSkillTool({ index: index as any, recordMatch, sessionId: () => "s-9" });
    await tool.call({ location: "/b.md", query_id: "q-abc" });
    expect(recordMatch).toHaveBeenCalledWith({ location: "/b.md", queryId: "q-abc", sessionId: "s-9" });
  });

  it("does not record telemetry when query_id is missing", async () => {
    const index = { readSkillContent: vi.fn().mockResolvedValue("body") };
    const recordMatch = vi.fn();
    const tool = makeReadSkillTool({ index: index as any, recordMatch, sessionId: () => "s-9" });
    await tool.call({ location: "/c.md" });
    expect(recordMatch).not.toHaveBeenCalled();
  });

  it("returns isError when location is missing", async () => {
    const index = { readSkillContent: vi.fn() };
    const tool = makeReadSkillTool({ index: index as any, recordMatch: () => {}, sessionId: () => "s-9" });
    const result = await tool.call({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/location/);
  });

  it("returns isError when readSkillContent throws", async () => {
    const index = { readSkillContent: vi.fn().mockRejectedValue(new Error("ENOENT")) };
    const tool = makeReadSkillTool({ index: index as any, recordMatch: () => {}, sessionId: () => "s-9" });
    const result = await tool.call({ location: "/missing.md" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("ENOENT");
  });
});
