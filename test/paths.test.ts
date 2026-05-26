import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";

describe("getGrokPaths", () => {
  const originalHome = process.env.HOME;
  beforeEach(() => { process.env.HOME = "/tmp/fake-home"; });
  afterEach(() => { process.env.HOME = originalHome; });

  it("roots cache, models, and sessions under ~/.grok/cache", async () => {
    const { getGrokPaths } = await import("../src/core/paths.ts");
    const p = getGrokPaths();
    expect(p.cacheDir).toBe(join("/tmp/fake-home", ".grok", "cache"));
    expect(p.modelsDir).toBe(join("/tmp/fake-home", ".grok", "cache", "models"));
    expect(p.sessionsDir).toBe(join("/tmp/fake-home", ".grok", "cache", "sessions"));
  });

  it("defaults sync repo to ~/.local/share/memex", async () => {
    const { getGrokPaths } = await import("../src/core/paths.ts");
    expect(getGrokPaths().syncRepoDir).toBe(join("/tmp/fake-home", ".local", "share", "memex"));
  });

  it("exposes global skill and rule dirs under ~/.grok and ~/.claude", async () => {
    const { getGrokPaths } = await import("../src/core/paths.ts");
    const p = getGrokPaths();
    expect(p.globalSkillsDirs).toEqual([
      join("/tmp/fake-home", ".grok", "skills"),
      join("/tmp/fake-home", ".claude", "skills"),
    ]);
    expect(p.globalRulesDirs).toEqual([
      join("/tmp/fake-home", ".grok", "rules"),
    ]);
  });

  it("derives project skill and rule dirs from cwd", async () => {
    const { getProjectSkillsDirs, getProjectRulesDirs } = await import("../src/core/paths.ts");
    expect(getProjectSkillsDirs("/work/repo")).toEqual([
      join("/work/repo", ".grok", "skills"),
      join("/work/repo", ".claude", "skills"),
    ]);
    expect(getProjectRulesDirs("/work/repo")).toEqual([
      join("/work/repo", ".grok", "rules"),
    ]);
  });

  it("exposes config and binary cache paths", async () => {
    const { getGrokPaths } = await import("../src/core/paths.ts");
    const p = getGrokPaths();
    expect(p.configPath).toBe(join("/tmp/fake-home", ".grok", "memex.json"));
    expect(p.binaryCacheDir).toBe(join("/tmp/fake-home", ".cache", "memex-grok"));
  });
});
