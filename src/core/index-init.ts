import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ScanDirs } from "@jim80net/memex-core";
import type { GrokRouterConfig } from "./config.ts";
import {
  getGrokPaths,
  getProjectSkillsDirs,
  getProjectRulesDirs,
} from "./paths.ts";

/**
 * Build the ScanDirs handed to memex-core's SkillIndex for a given cwd.
 *
 * Plan 1: index local + project skill/rule dirs and (if present) the
 * sync repo as a read-only source. Plan 3 will add memoryDirs once
 * canonicalProjectId is available from memex-core.
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
    const repoDir = config.sync.repoDir ?? paths.syncRepoDir;
    if (existsSync(join(repoDir, "skills"))) {
      skillDirs.push(join(repoDir, "skills"));
    }
    if (existsSync(join(repoDir, "rules"))) {
      ruleDirs.push(join(repoDir, "rules"));
    }
  }

  return {
    skillDirs,
    ruleDirs,
    memoryDirs: [], // populated in Plan 3
  };
}
