import { join, resolve } from "node:path";
import {
  buildScanRoots,
  resolvePortableLocationResolved,
  type ScanDirs,
  type ScanRoot,
  type ScanRootRegistry,
} from "@jim80net/memex-core";
import type { GrokRouterConfig } from "../core/config.ts";
import { buildScanDirs } from "../core/index-init.ts";
import { getGrokPaths, type GrokPaths } from "../core/paths.ts";

export type { ScanRootRegistry };

/** Labeled scan roots for grok harness — delegates to memex-core buildScanRoots. */
export async function buildGrokScanRootRegistry(
  cwd: string,
  config: GrokRouterConfig,
  paths: GrokPaths = getGrokPaths(),
  scanDirs?: ScanDirs,
): Promise<ScanRootRegistry> {
  const dirs = scanDirs ?? await buildScanDirs(cwd, config, paths);
  const registry = buildScanRoots(
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
    dirs,
  );
  // Grok scans peer harness project trees; core labels only this harness's projectSkillsDir.
  return augmentPeerProjectRoots(cwd, registry);
}

/** Replace only unclassified peer project roots; preserve higher-authority catalog roots. */
function augmentPeerProjectRoots(cwd: string, registry: ScanRootRegistry): ScanRootRegistry {
  const peerRoots: ScanRoot[] = [
    { key: "claude-project", rootPath: resolve(join(cwd, ".claude", "skills")) },
  ];
  let out = registry;
  for (const peer of peerRoots) {
    // At cwd=$HOME the peer root is the registered global Claude root. Relabeling
    // that same corpus as project-local makes portable handles and cache keys vary
    // solely with caller cwd (memex-grok#62).
    if (out.some((root) => root.rootPath === peer.rootPath && root.key === "claude-global")) {
      continue;
    }
    out = out.filter((r) => r.rootPath !== peer.rootPath);
    out.push(peer);
  }
  return out.sort((a, b) => b.rootPath.length - a.rootPath.length);
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
