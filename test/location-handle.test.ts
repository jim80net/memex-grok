import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodePortableLocation,
  encodePortableLocation,
  stableUnclassifiedKey,
} from "@jim80net/memex-core";
import {
  assertAgentReadLocation,
  assertNoHostPathLeaks,
  buildGrokScanRootRegistry,
} from "../src/mcp/location-handle.ts";
import { DEFAULT_CONFIG } from "../src/core/config.ts";
import { getGrokPaths, type GrokPaths } from "../src/core/paths.ts";

describe("buildGrokScanRootRegistry", () => {
  const home = homedir();
  const cwd = "/work/my-repo";
  const paths = getGrokPaths();

  it("maps global and project scan paths to memex:// handles without host leakage", () => {
    const registry = buildGrokScanRootRegistry(cwd, DEFAULT_CONFIG, paths);
    const grokGlobal = join(home, ".grok", "skills", "foo", "SKILL.md");
    const claudeProject = join(cwd, ".claude", "skills", "bar", "SKILL.md");

    expect(encodePortableLocation(registry, grokGlobal)).toBe("memex://grok-global/foo/SKILL.md");
    expect(encodePortableLocation(registry, claudeProject)).toBe("memex://claude-project/bar/SKILL.md");
    assertNoHostPathLeaks(encodePortableLocation(registry, grokGlobal)!);
    assertNoHostPathLeaks(encodePortableLocation(registry, claudeProject)!);
  });

  it("round-trips handles with optional #fragment", () => {
    const registry = buildGrokScanRootRegistry(cwd, DEFAULT_CONFIG, paths);
    const memory = join(home, ".grok", "skills", "m.md");
    const handle = encodePortableLocation(registry, memory, undefined, "Section");
    expect(handle).toBe("memex://grok-global/m.md#Section");
    expect(decodePortableLocation(registry, handle!)).toBe(`${memory}#Section`);
  });

  it("labels config skillDirs with stable unclassified keys", () => {
    const config = {
      ...DEFAULT_CONFIG,
      skillDirs: ["/team/skills"],
    };
    const registry = buildGrokScanRootRegistry(cwd, config, paths);
    const key = stableUnclassifiedKey("skill", "/team/skills");
    const handle = encodePortableLocation(registry, "/team/skills/deploy/SKILL.md");
    expect(handle).toBe(`memex://${key}/deploy/SKILL.md`);
    expect(decodePortableLocation(registry, handle!)).toBe("/team/skills/deploy/SKILL.md");
  });

  it("builds portable roots from the same injected paths used for scanning", () => {
    const injectedPaths: GrokPaths = {
      ...paths,
      globalSkillsDirs: ["/embedded/.grok/skills", "/embedded/.claude/skills"],
      globalRulesDirs: ["/embedded/.grok/rules"],
    };

    const registry = buildGrokScanRootRegistry(cwd, DEFAULT_CONFIG, injectedPaths);

    expect(encodePortableLocation(registry, "/embedded/.grok/skills/foo/SKILL.md")).toBe(
      "memex://grok-global/foo/SKILL.md",
    );
    expect(registry.some((root) => root.rootPath === join(home, ".grok", "skills"))).toBe(false);
  });
});

describe("assertAgentReadLocation (memex-grok#19)", () => {
  const registry = buildGrokScanRootRegistry("/work", DEFAULT_CONFIG, getGrokPaths());

  it("accepts portable handles from memex_search", () => {
    const handle = "memex://grok-global/foo/SKILL.md";
    expect(assertAgentReadLocation(registry, handle)).toBe(handle);
  });

  it("rejects agent-supplied absolute paths (allowAbsolute:false)", () => {
    expect(() => assertAgentReadLocation(registry, "/etc/shadow")).toThrow(/unrecognized location/);
  });

  it("rejects traversal handles", () => {
    expect(() => assertAgentReadLocation(registry, "memex://grok-global/../../etc/shadow")).toThrow(
      /escapes scan root/,
    );
  });
});
