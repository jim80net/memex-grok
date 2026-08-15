import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { type ScanDirs } from "@jim80net/memex-core";
import type { GrokRouterConfig } from "./config.ts";
import {
  getGrokPaths,
  getProjectMemoryDir,
  getProjectSkillsDirs,
  getProjectRulesDirs,
  type GrokPaths,
} from "./paths.ts";
import { rulesProjectionActive } from "./projection.ts";

/**
 * Existing origin `projects/<id>/memory` directories, including `_local`.
 *
 * Cwd-independent: every present origin project memory dir is returned so
 * search sees the same origin corpus from a matching cwd and a non-matching
 * one. Does not create directories. Does not descend into a `memory/` leaf.
 */
async function listOriginProjectMemoryDirs(repoDir: string): Promise<string[]> {
  const projectsDir = join(repoDir, "projects");
  const found: string[] = [];

  async function walk(absDir: string): Promise<void> {
    let names: string[];
    try {
      names = await readdir(absDir);
    } catch {
      return;
    }
    for (const name of names) {
      const child = join(absDir, name);
      const st = await stat(child).catch(() => null);
      if (st === null || !st.isDirectory()) {
        continue;
      }
      if (name === "memory") {
        found.push(child);
        continue;
      }
      await walk(child);
    }
  }

  await walk(projectsDir);
  return found;
}

/**
 * Build the ScanDirs handed to memex-core's SkillIndex for a given cwd.
 *
 * Memory: harness project memory always, plus every existing origin
 * `projects/<id>/memory` when sync is enabled (independent of cwd).
 *
 * When rules projection is active (sync.enabled), harness rule dirs are the
 * projection surface (symlinks into origin) — do not also append raw
 * origin/rules (avoids double-indexing the same content). Skills still scan
 * origin when present until skills projection lands.
 */
export async function buildScanDirs(
  cwd: string,
  config: GrokRouterConfig,
  paths: GrokPaths = getGrokPaths(),
): Promise<ScanDirs> {
  const skillDirs: string[] = [
    ...paths.globalSkillsDirs,
    ...getProjectSkillsDirs(cwd),
    ...config.skillDirs,
  ];
  const ruleDirs: string[] = [
    ...paths.globalRulesDirs,
    ...getProjectRulesDirs(cwd),
  ];
  const memoryDirs: string[] = [getProjectMemoryDir(cwd, paths.projectsDir)];

  if (config.sync.enabled) {
    // Prefer explicit repoDir; live origin resolution for MCP first-call is separate.
    const repoDir = config.sync.repoDir ?? paths.syncRepoDir;
    if (existsSync(join(repoDir, "skills"))) {
      skillDirs.push(join(repoDir, "skills"));
    }
    // Rules: only append raw origin when projection is *not* the delivery path.
    if (!rulesProjectionActive(config) && existsSync(join(repoDir, "rules"))) {
      ruleDirs.push(join(repoDir, "rules"));
    }
    const originMemDirs = await listOriginProjectMemoryDirs(repoDir);
    memoryDirs.push(...originMemDirs);
  }

  return {
    skillDirs,
    ruleDirs,
    memoryDirs,
  };
}
