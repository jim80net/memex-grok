import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { lstat, mkdir, readlink, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_CONFIG } from "../src/core/config.ts";
import type { GrokPaths } from "../src/core/paths.ts";
import {
  buildGrokProjectionTargets,
  isProjectionProfileSet,
  runGrokProjection,
} from "../src/core/projection.ts";

function fakePaths(root: string): GrokPaths {
  return {
    cacheDir: join(root, "cache"),
    modelsDir: join(root, "cache", "models"),
    sessionsDir: join(root, "cache", "sessions"),
    syncRepoDir: join(root, "origin"),
    projectsDir: join(root, "memex", "projects"),
    telemetryPath: join(root, "cache", "telemetry.json"),
    configPath: join(root, "memex.json"),
    binaryCacheDir: join(root, "bin"),
    globalSkillsDirs: [join(root, ".grok", "skills")],
    globalRulesDirs: [join(root, ".grok", "rules")],
  };
}

describe("projection profile gate", () => {
  it("is off when sync.enabled is false (default)", () => {
    expect(isProjectionProfileSet(DEFAULT_CONFIG)).toBe(false);
  });

  it("is on when sync.enabled is true", () => {
    expect(
      isProjectionProfileSet({
        ...DEFAULT_CONFIG,
        sync: { ...DEFAULT_CONFIG.sync, enabled: true },
      }),
    ).toBe(true);
  });
});

describe("buildGrokProjectionTargets", () => {
  it("projects user rules only by default (no double-index of origin rules)", () => {
    const root = "/tmp/proj-paths";
    const paths = fakePaths(root);
    const targets = buildGrokProjectionTargets("/work/repo", paths);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.id).toBe("grok-user-rules");
    expect(targets[0]!.targetDir).toBe(join(root, ".grok", "rules"));
    expect(targets[0]!.originRelDir).toBe("rules");
    expect(targets[0]!.entryKind).toBe("files");
  });

  it("adds project rules only when projectOriginRelDir is explicit", () => {
    const paths = fakePaths("/tmp/p");
    const targets = buildGrokProjectionTargets("/work/repo", paths, {
      projectOriginRelDir: "projects/foo/rules",
    });
    expect(targets.map((t) => t.id)).toEqual(["grok-user-rules", "grok-project-rules"]);
    expect(targets[1]!.originRelDir).toBe("projects/foo/rules");
    expect(targets[1]!.targetDir).toBe(join("/work/repo", ".grok", "rules"));
  });
});

describe("runGrokProjection", () => {
  let root: string;
  let paths: GrokPaths;

  beforeEach(async () => {
    root = join(tmpdir(), `mg-proj-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await mkdir(root, { recursive: true });
    paths = fakePaths(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("no-ops with clear message when profile not set", async () => {
    const report = await runGrokProjection({
      config: DEFAULT_CONFIG,
      paths,
      cwd: root,
      homeDir: root,
    });
    expect(report.profileSet).toBe(false);
    expect(report.apply).toBeNull();
    expect(report.message).toMatch(/sync\.enabled=false/);
  });

  it("creates absolute symlinks from origin rules into ~/.grok/rules", async () => {
    const origin = paths.syncRepoDir;
    await mkdir(join(origin, "rules"), { recursive: true });
    await writeFile(join(origin, "rules", "dogfood.md"), "# dogfood\n", "utf8");

    const report = await runGrokProjection({
      config: {
        ...DEFAULT_CONFIG,
        sync: {
          ...DEFAULT_CONFIG.sync,
          enabled: true,
          repoDir: origin,
          autoPull: false,
        },
      },
      paths,
      cwd: root,
      homeDir: root,
    });

    expect(report.profileSet).toBe(true);
    expect(report.apply?.linked).toBe(1);
    expect(report.apply?.conflicts).toEqual([]);

    const linkPath = join(paths.globalRulesDirs[0]!, "dogfood.md");
    const st = await lstat(linkPath);
    expect(st.isSymbolicLink()).toBe(true);
    const target = await readlink(linkPath);
    expect(target).toBe(join(origin, "rules", "dogfood.md"));
  });

  it("does not clobber a real file (conflict, partial apply)", async () => {
    const origin = paths.syncRepoDir;
    await mkdir(join(origin, "rules"), { recursive: true });
    await writeFile(join(origin, "rules", "a.md"), "origin-a\n", "utf8");
    await writeFile(join(origin, "rules", "b.md"), "origin-b\n", "utf8");
    await mkdir(paths.globalRulesDirs[0]!, { recursive: true });
    await writeFile(join(paths.globalRulesDirs[0]!, "a.md"), "local-real\n", "utf8");

    const report = await runGrokProjection({
      config: {
        ...DEFAULT_CONFIG,
        sync: {
          ...DEFAULT_CONFIG.sync,
          enabled: true,
          repoDir: origin,
          autoPull: false,
        },
      },
      paths,
      cwd: root,
      homeDir: root,
    });

    expect(report.apply?.conflicts.some((c) => c.reason === "real-file")).toBe(true);
    // b.md should still link
    const b = join(paths.globalRulesDirs[0]!, "b.md");
    expect((await lstat(b)).isSymbolicLink()).toBe(true);
    // a.md remains a real file
    expect((await lstat(join(paths.globalRulesDirs[0]!, "a.md"))).isSymbolicLink()).toBe(false);
  });

  it("dry-run does not create links", async () => {
    const origin = paths.syncRepoDir;
    await mkdir(join(origin, "rules"), { recursive: true });
    await writeFile(join(origin, "rules", "x.md"), "x\n", "utf8");

    const report = await runGrokProjection({
      config: {
        ...DEFAULT_CONFIG,
        sync: { ...DEFAULT_CONFIG.sync, enabled: true, repoDir: origin, autoPull: false },
      },
      paths,
      cwd: root,
      homeDir: root,
      dryRun: true,
    });

    expect(report.plan?.links.length).toBeGreaterThan(0);
    expect(report.apply).toBeNull();
    await expect(lstat(join(paths.globalRulesDirs[0]!, "x.md"))).rejects.toThrow();
  });
});
