import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodePortableLocation,
  encodePortableLocation,
  SkillIndex,
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

  it("preserves claude-global when cwd aliases HOME while retaining genuine peer projects", () => {
    const globalRoot = join(home, ".claude", "skills");
    const globalFile = join(globalRoot, "stable", "SKILL.md");
    const homeRegistry = buildGrokScanRootRegistry(home, DEFAULT_CONFIG, paths);
    const projectRegistry = buildGrokScanRootRegistry(cwd, DEFAULT_CONFIG, paths);

    expect(homeRegistry).toContainEqual({ key: "claude-global", rootPath: globalRoot });
    expect(homeRegistry).not.toContainEqual({ key: "claude-project", rootPath: globalRoot });
    expect(projectRegistry).toContainEqual({
      key: "claude-project",
      rootPath: join(cwd, ".claude", "skills"),
    });
    expect(encodePortableLocation(homeRegistry, globalFile)).toBe(
      "memex://claude-global/stable/SKILL.md",
    );
    expect(encodePortableLocation(projectRegistry, globalFile)).toBe(
      "memex://claude-global/stable/SKILL.md",
    );
  });

  it("keeps cache identities byte-stable across HOME and unrelated-project rebuilds", async () => {
    const tmpHome = await mkdtemp(join(tmpdir(), "memex-grok-root-alias-"));
    try {
      const globalRoot = join(tmpHome, ".claude", "skills");
      const skillDir = join(globalRoot, "stable");
      const skillFile = join(skillDir, "SKILL.md");
      const cachePath = join(tmpHome, "cache", "memex-cache.json");
      const unrelatedProject = join(tmpHome, "peer-project");
      const injectedPaths: GrokPaths = {
        ...paths,
        cacheDir: join(tmpHome, "cache"),
        globalSkillsDirs: [join(tmpHome, ".grok", "skills"), globalRoot],
        globalRulesDirs: [join(tmpHome, ".grok", "rules")],
      };
      const provider = { embed: async (texts: string[]) => texts.map(() => [1, 0]) };

      await mkdir(skillDir, { recursive: true });
      await writeFile(
        skillFile,
        "---\nname: stable\ndescription: Stable identity fixture\n---\nFixture body.\n",
      );

      const firstRegistry = buildGrokScanRootRegistry(tmpHome, DEFAULT_CONFIG, injectedPaths);
      const firstIndex = new SkillIndex(DEFAULT_CONFIG, provider, cachePath, {
        registry: firstRegistry,
      });
      await firstIndex.build({ skillDirs: [globalRoot], memoryDirs: [], ruleDirs: [] });
      const firstCache = await readFile(cachePath);
      const firstKeys = Object.keys(JSON.parse(firstCache.toString()).skills);

      const secondRegistry = buildGrokScanRootRegistry(
        unrelatedProject,
        DEFAULT_CONFIG,
        injectedPaths,
      );
      const secondIndex = new SkillIndex(DEFAULT_CONFIG, provider, cachePath, {
        registry: secondRegistry,
      });
      await secondIndex.build({ skillDirs: [globalRoot], memoryDirs: [], ruleDirs: [] });
      const secondCache = await readFile(cachePath);
      const secondKeys = Object.keys(JSON.parse(secondCache.toString()).skills);

      expect(firstKeys).toEqual(["memex://claude-global/stable/SKILL.md"]);
      expect(secondKeys).toEqual(firstKeys);
      expect(createHash("sha256").update(secondCache).digest("hex")).toBe(
        createHash("sha256").update(firstCache).digest("hex"),
      );
    } finally {
      await rm(tmpHome, { recursive: true, force: true });
    }
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
