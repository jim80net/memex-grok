import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ScanDirs } from "@jim80net/memex-core";
import type { GrokRouterConfig } from "./config.ts";
import {
  getGrokPaths,
  getProjectSkillsDirs,
  getProjectRulesDirs,
} from "./paths.ts";
import { rulesProjectionActive } from "./projection.ts";

/**
 * Build the ScanDirs handed to memex-core's SkillIndex for a given cwd.
 *
 * When rules projection is active (sync.enabled), harness rule dirs are the
 * projection surface (symlinks into origin) — do not also append raw
 * origin/rules (avoids double-indexing the same content). Skills still scan
 * origin when present until skills projection lands.
 */
export function buildScanDirs(cwd: string, config: GrokRouterConfig): ScanDirs {
  const paths = getGrokPaths();
  const skillDirs: string[] = [
    ...paths.globalSkillsDirs,
    ...getProjectSkillsDirs(cwd),
    ...config.skillDirs,
  ];
  const ruleDirs: string[] = [
    ...paths.globalRulesDirs,
    ...getProjectRulesDirs(cwd),
  ];

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
  }

  return {
    skillDirs,
    ruleDirs,
    memoryDirs: [], // populated in Plan 3
  };
}
