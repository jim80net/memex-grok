import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_CONFIG } from "../src/core/config.ts";

describe("buildScanDirs", () => {
  let tmpHome: string;
  const originalHome = process.env.HOME;

  beforeEach(async () => {
    tmpHome = join(tmpdir(), `mg-idx-${Date.now()}-${Math.random()}`);
    await mkdir(tmpHome, { recursive: true });
    process.env.HOME = tmpHome;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tmpHome, { recursive: true, force: true });
  });

  it("includes grok-global, claude-global, and project skill dirs", async () => {
    const { buildScanDirs } = await import("../src/core/index-init.ts");
    const dirs = buildScanDirs("/work/repo", DEFAULT_CONFIG);
    expect(dirs.skillDirs).toContain(join(tmpHome, ".grok", "skills"));
    expect(dirs.skillDirs).toContain(join(tmpHome, ".claude", "skills"));
    expect(dirs.skillDirs).toContain(join("/work/repo", ".grok", "skills"));
    expect(dirs.skillDirs).toContain(join("/work/repo", ".claude", "skills"));
  });

  it("includes user-configured extra skillDirs", async () => {
    const cfg = { ...DEFAULT_CONFIG, skillDirs: ["/team/skills"] };
    const { buildScanDirs } = await import("../src/core/index-init.ts");
    const dirs = buildScanDirs("/work/repo", cfg);
    expect(dirs.skillDirs).toContain("/team/skills");
  });

  it("includes sync repo skills when sync.enabled and dir exists", async () => {
    const syncDir = join(tmpHome, "syncrepo");
    await mkdir(join(syncDir, "skills"), { recursive: true });
    const cfg = { ...DEFAULT_CONFIG, sync: { ...DEFAULT_CONFIG.sync, enabled: true, repoDir: syncDir } };
    const { buildScanDirs } = await import("../src/core/index-init.ts");
    const dirs = buildScanDirs("/work/repo", cfg);
    expect(dirs.skillDirs).toContain(join(syncDir, "skills"));
  });

  it("omits sync repo skills when sync.enabled but dir missing", async () => {
    const cfg = { ...DEFAULT_CONFIG, sync: { ...DEFAULT_CONFIG.sync, enabled: true, repoDir: "/nope/missing" } };
    const { buildScanDirs } = await import("../src/core/index-init.ts");
    const dirs = buildScanDirs("/work/repo", cfg);
    expect(dirs.skillDirs).not.toContain(join("/nope/missing", "skills"));
  });

  it("omits memoryDirs in Plan 1 (sync writes deferred to Plan 3)", async () => {
    const { buildScanDirs } = await import("../src/core/index-init.ts");
    const dirs = buildScanDirs("/work/repo", DEFAULT_CONFIG);
    expect(dirs.memoryDirs).toEqual([]);
  });

  it("when projection active, does not double-scan origin/rules", async () => {
    const syncDir = join(tmpHome, "syncrepo");
    await mkdir(join(syncDir, "rules"), { recursive: true });
    const cfg = {
      ...DEFAULT_CONFIG,
      sync: { ...DEFAULT_CONFIG.sync, enabled: true, repoDir: syncDir },
    };
    const { buildScanDirs } = await import("../src/core/index-init.ts");
    const dirs = buildScanDirs("/work/repo", cfg);
    expect(dirs.ruleDirs).not.toContain(join(syncDir, "rules"));
    expect(dirs.ruleDirs).toContain(join(tmpHome, ".grok", "rules"));
  });
});
