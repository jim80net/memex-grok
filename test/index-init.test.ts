import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_CONFIG } from "../src/core/config.ts";
import type { GrokPaths } from "../src/core/paths.ts";

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
    const dirs = await buildScanDirs("/work/repo", DEFAULT_CONFIG);
    expect(dirs.skillDirs).toContain(join(tmpHome, ".grok", "skills"));
    expect(dirs.skillDirs).toContain(join(tmpHome, ".claude", "skills"));
    expect(dirs.skillDirs).toContain(join("/work/repo", ".grok", "skills"));
    expect(dirs.skillDirs).toContain(join("/work/repo", ".claude", "skills"));
  });

  it("includes user-configured extra skillDirs", async () => {
    const cfg = { ...DEFAULT_CONFIG, skillDirs: ["/team/skills"] };
    const { buildScanDirs } = await import("../src/core/index-init.ts");
    const dirs = await buildScanDirs("/work/repo", cfg);
    expect(dirs.skillDirs).toContain("/team/skills");
  });

  it("includes sync repo skills when sync.enabled and dir exists", async () => {
    const syncDir = join(tmpHome, "syncrepo");
    await mkdir(join(syncDir, "skills"), { recursive: true });
    const cfg = { ...DEFAULT_CONFIG, sync: { ...DEFAULT_CONFIG.sync, enabled: true, repoDir: syncDir } };
    const { buildScanDirs } = await import("../src/core/index-init.ts");
    const dirs = await buildScanDirs("/work/repo", cfg);
    expect(dirs.skillDirs).toContain(join(syncDir, "skills"));
  });

  it("omits sync repo skills when sync.enabled but dir missing", async () => {
    const cfg = { ...DEFAULT_CONFIG, sync: { ...DEFAULT_CONFIG.sync, enabled: true, repoDir: "/nope/missing" } };
    const { buildScanDirs } = await import("../src/core/index-init.ts");
    const dirs = await buildScanDirs("/work/repo", cfg);
    expect(dirs.skillDirs).not.toContain(join("/nope/missing", "skills"));
  });

  it("includes harness project memory dir", async () => {
    const { encodeProjectPath } = await import("@jim80net/memex-core");
    const { buildScanDirs } = await import("../src/core/index-init.ts");
    const cwd = "/work/repo";
    const dirs = await buildScanDirs(cwd, DEFAULT_CONFIG);
    expect(dirs.memoryDirs).toContain(
      join(tmpHome, ".grok", "memex", "projects", encodeProjectPath(cwd), "memory"),
    );
  });

  it("includes origin matching project memory when sync.enabled and dir exists", async () => {
    const { encodeProjectPath } = await import("@jim80net/memex-core");
    const syncDir = join(tmpHome, "syncrepo");
    const cwd = "/work/repo";
    const canonical = "github.com/acme/repo";
    await mkdir(join(syncDir, "projects", canonical, "memory"), { recursive: true });
    const cfg = {
      ...DEFAULT_CONFIG,
      sync: {
        ...DEFAULT_CONFIG.sync,
        enabled: true,
        repoDir: syncDir,
        projectMappings: { [cwd]: canonical },
      },
    };
    const { buildScanDirs } = await import("../src/core/index-init.ts");
    const dirs = await buildScanDirs(cwd, cfg);
    expect(dirs.memoryDirs).toContain(
      join(tmpHome, ".grok", "memex", "projects", encodeProjectPath(cwd), "memory"),
    );
    expect(dirs.memoryDirs).toContain(join(syncDir, "projects", canonical, "memory"));
  });

  it("includes origin project memory from matching and non-matching cwds when sync.enabled", async () => {
    const { existsSync } = await import("node:fs");
    const syncDir = join(tmpHome, "syncrepo");
    const matchingCwd = "/work/repo";
    const otherCwd = "/work/unrelated";
    const canonical = "github.com/acme/repo";
    const originMem = join(syncDir, "projects", canonical, "memory");
    await mkdir(originMem, { recursive: true });
    const cfg = {
      ...DEFAULT_CONFIG,
      sync: {
        ...DEFAULT_CONFIG.sync,
        enabled: true,
        repoDir: syncDir,
        projectMappings: { [matchingCwd]: canonical },
      },
    };
    const { buildScanDirs } = await import("../src/core/index-init.ts");
    const fromMatching = await buildScanDirs(matchingCwd, cfg);
    const fromOther = await buildScanDirs(otherCwd, cfg);
    expect(fromMatching.memoryDirs).toContain(originMem);
    expect(fromOther.memoryDirs).toContain(originMem);
    expect(existsSync(join(tmpHome, ".grok", "memex", "projects"))).toBe(false);
  });

  it("includes origin _local project memory fallback when that dir exists", async () => {
    const { encodeProjectPath } = await import("@jim80net/memex-core");
    const syncDir = join(tmpHome, "syncrepo");
    const cwd = "/work/repo";
    const localMem = join(syncDir, "projects", "_local", encodeProjectPath(cwd), "memory");
    await mkdir(localMem, { recursive: true });
    const cfg = {
      ...DEFAULT_CONFIG,
      sync: { ...DEFAULT_CONFIG.sync, enabled: true, repoDir: syncDir },
    };
    const { buildScanDirs } = await import("../src/core/index-init.ts");
    const dirs = await buildScanDirs(cwd, cfg);
    expect(dirs.memoryDirs).toContain(localMem);
  });

  it("omits origin project memory when sync is disabled", async () => {
    const syncDir = join(tmpHome, "syncrepo");
    const cwd = "/work/repo";
    const canonical = "github.com/acme/repo";
    await mkdir(join(syncDir, "projects", canonical, "memory"), { recursive: true });
    const cfg = {
      ...DEFAULT_CONFIG,
      sync: {
        ...DEFAULT_CONFIG.sync,
        enabled: false,
        repoDir: syncDir,
        projectMappings: { [cwd]: canonical },
      },
    };
    const { buildScanDirs } = await import("../src/core/index-init.ts");
    const dirs = await buildScanDirs(cwd, cfg);
    expect(dirs.memoryDirs).not.toContain(join(syncDir, "projects", canonical, "memory"));
  });

  it("uses injected projectsDir for harness memory", async () => {
    const { encodeProjectPath } = await import("@jim80net/memex-core");
    const injectedRoot = join(tmpHome, "injected");
    const injectedPaths: GrokPaths = {
      cacheDir: join(injectedRoot, "cache"),
      modelsDir: join(injectedRoot, "models"),
      sessionsDir: join(injectedRoot, "sessions"),
      syncRepoDir: join(injectedRoot, "origin"),
      projectsDir: join(injectedRoot, "projects"),
      telemetryPath: join(injectedRoot, "telemetry.json"),
      configPath: join(injectedRoot, "memex.json"),
      binaryCacheDir: join(injectedRoot, "bin"),
      globalSkillsDirs: [join(injectedRoot, "grok-skills")],
      globalRulesDirs: [join(injectedRoot, "grok-rules")],
    };
    const { buildScanDirs } = await import("../src/core/index-init.ts");
    const cwd = "/work/repo";
    const dirs = await buildScanDirs(cwd, DEFAULT_CONFIG, injectedPaths);
    expect(dirs.memoryDirs).toContain(
      join(injectedRoot, "projects", encodeProjectPath(cwd), "memory"),
    );
    expect(dirs.memoryDirs).not.toContain(
      join(tmpHome, ".grok", "memex", "projects", encodeProjectPath(cwd), "memory"),
    );
  });

  it("when projection active, does not double-scan origin/rules", async () => {
    const syncDir = join(tmpHome, "syncrepo");
    await mkdir(join(syncDir, "rules"), { recursive: true });
    const cfg = {
      ...DEFAULT_CONFIG,
      sync: { ...DEFAULT_CONFIG.sync, enabled: true, repoDir: syncDir },
    };
    const { buildScanDirs } = await import("../src/core/index-init.ts");
    const dirs = await buildScanDirs("/work/repo", cfg);
    expect(dirs.ruleDirs).not.toContain(join(syncDir, "rules"));
    expect(dirs.ruleDirs).toContain(join(tmpHome, ".grok", "rules"));
  });

  it("uses injected global and sync paths consistently", async () => {
    const injectedRoot = join(tmpHome, "injected");
    const injectedPaths: GrokPaths = {
      cacheDir: join(injectedRoot, "cache"),
      modelsDir: join(injectedRoot, "models"),
      sessionsDir: join(injectedRoot, "sessions"),
      syncRepoDir: join(injectedRoot, "origin"),
      projectsDir: join(injectedRoot, "projects"),
      telemetryPath: join(injectedRoot, "telemetry.json"),
      configPath: join(injectedRoot, "memex.json"),
      binaryCacheDir: join(injectedRoot, "bin"),
      globalSkillsDirs: [join(injectedRoot, "grok-skills"), join(injectedRoot, "claude-skills")],
      globalRulesDirs: [join(injectedRoot, "grok-rules")],
    };
    const { buildScanDirs } = await import("../src/core/index-init.ts");

    const dirs = await buildScanDirs("/work/repo", DEFAULT_CONFIG, injectedPaths);

    expect(dirs.skillDirs).toEqual(expect.arrayContaining(injectedPaths.globalSkillsDirs));
    expect(dirs.ruleDirs).toEqual(expect.arrayContaining(injectedPaths.globalRulesDirs));
    expect(dirs.skillDirs).not.toContain(join(tmpHome, ".grok", "skills"));
    expect(dirs.ruleDirs).not.toContain(join(tmpHome, ".grok", "rules"));
  });
});
