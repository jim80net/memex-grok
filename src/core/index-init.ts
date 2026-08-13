import { existsSync } from "node:fs";
import { join } from "node:path";
import { findMatchingProjectMemoryDirs, type ScanDirs } from "@jim80net/memex-core";
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
 * Build the ScanDirs handed to memex-core's SkillIndex for a given cwd.
 *
 * Memory follows the Claude/Codex contract: harness project memory always,
 * plus origin projects/<id>/memory matches when sync is enabled.
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
    const syncMemDirs = await findMatchingProjectMemoryDirs(cwd, repoDir, config.sync);
    memoryDirs.push(...syncMemDirs);
  }

  return {
    skillDirs,
    ruleDirs,
    memoryDirs,
  };
}
