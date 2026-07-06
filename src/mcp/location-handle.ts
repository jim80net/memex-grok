import { join } from "node:path";
import {
  buildScanRoots,
  resolvePortableLocationResolved,
  type ScanRootRegistry,
} from "@jim80net/memex-core";
import type { GrokRouterConfig } from "../core/config.ts";
import { buildScanDirs } from "../core/index-init.ts";
import { getGrokPaths, type GrokPaths } from "../core/paths.ts";

export type { ScanRootRegistry };

/** Labeled scan roots for grok harness — delegates to memex-core buildScanRoots. */
export function buildGrokScanRootRegistry(
  cwd: string,
  config: GrokRouterConfig,
  paths: GrokPaths = getGrokPaths(),
): ScanRootRegistry {
  const scanDirs = buildScanDirs(cwd, config);
  return buildScanRoots(
    {
      cwd,
      harness: "grok",
      syncEnabled: config.sync.enabled,
      syncRepoDir: config.sync.repoDir ?? paths.syncRepoDir,
      globalSkillsDirs: paths.globalSkillsDirs,
      globalRulesDirs: paths.globalRulesDirs,
      projectSkillsDir: join(cwd, ".grok", "skills"),
      projectRulesDir: join(cwd, ".grok", "rules"),
    },
    scanDirs,
  );
}

/**
 * Validate agent-supplied read input — memex-grok#19 closure.
 * Fail-closed: rejects raw absolute paths and traversal handles.
 * Returns after validation; pass the original portable handle to readSkillContent.
 */
export function assertAgentReadLocation(registry: ScanRootRegistry, input: string): string {
  const trimmed = input.trim();
  resolvePortableLocationResolved(registry, trimmed, { allowAbsolute: false });
  return trimmed;
}

export { assertNoHostPathLeaks } from "../core/host-path-egress.ts";