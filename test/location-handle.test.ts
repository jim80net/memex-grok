import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LocationHandleCodec,
  assertNoHostPathLeaks,
  buildScanRoots,
} from "../src/mcp/location-handle.ts";
import { DEFAULT_CONFIG } from "../src/core/config.ts";
import { getGrokPaths } from "../src/core/paths.ts";

describe("LocationHandleCodec", () => {
  const home = homedir();
  const cwd = "/work/my-repo";
  const paths = getGrokPaths();

  it("maps global and project scan paths to memex:// handles without host leakage", () => {
    const codec = LocationHandleCodec.forSession(cwd, DEFAULT_CONFIG, paths);
    const grokGlobal = join(home, ".grok", "skills", "foo", "SKILL.md");
    const claudeProject = join(cwd, ".claude", "skills", "bar", "SKILL.md");

    expect(codec.toHandle(grokGlobal)).toBe("memex://grok-global/foo/SKILL.md");
    expect(codec.toHandle(claudeProject)).toBe("memex://claude-project/bar/SKILL.md");
    assertNoHostPathLeaks(codec.toHandle(grokGlobal));
    assertNoHostPathLeaks(codec.toHandle(claudeProject));
  });

  it("round-trips handles with optional #fragment", () => {
    const codec = LocationHandleCodec.forSession(cwd, DEFAULT_CONFIG, paths);
    const memory = `${join(home, ".grok", "skills", "m.md")}#Section`;
    const handle = codec.toHandle(memory);
    expect(handle).toBe("memex://grok-global/m.md#Section");
    expect(codec.resolveInput(handle)).toBe(`${join(home, ".grok", "skills", "m.md")}#Section`);
  });

  it("labels config skillDirs as skill-extra-N", () => {
    const config = {
      ...DEFAULT_CONFIG,
      skillDirs: ["/team/skills"],
    };
    const roots = buildScanRoots(cwd, config, paths);
    expect(roots.some((r) => r.key === "skill-extra-0" && r.rootPath === "/team/skills")).toBe(true);
    const codec = new LocationHandleCodec(roots);
    const handle = codec.toHandle("/team/skills/deploy/SKILL.md");
    expect(handle).toBe("memex://skill-extra-0/deploy/SKILL.md");
    expect(codec.resolveInput(handle)).toBe("/team/skills/deploy/SKILL.md");
  });
});