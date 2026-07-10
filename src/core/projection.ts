/**
 * Grok harness projection — thin adapter over memex-core origin primitives.
 *
 * Design: docs/superpowers/specs/2026-07-10-file-rules-symlink-init.md
 * Core: resolveOriginRoot / planProjection / applyProjection (@jim80net/memex-core@0.6+)
 *
 * Does not invent a parallel origin layout. Memory remains MCP tool-call first-class.
 */

import {
  applyProjection,
  initSyncRepo,
  planProjection,
  resolveOriginRoot,
  syncPull,
  type ApplyProjectionResult,
  type ProjectPlan,
  type ProjectionTarget,
  type ResolvedOriginRoot,
  type SyncConfig,
  type SyncProfile,
} from "@jim80net/memex-core";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { GrokRouterConfig } from "./config.ts";
import {
  getGrokPaths,
  getProjectRulesDirs,
  type GrokPaths,
} from "./paths.ts";

export type ProjectionRunOptions = {
  config: GrokRouterConfig;
  /** Project cwd for project-scoped rules projection. Default process.cwd(). */
  cwd?: string;
  paths?: GrokPaths;
  /** When true, plan only — do not apply or mkdir origin. */
  dryRun?: boolean;
  /** Override home for resolveOriginRoot (tests). */
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
};

export type ProjectionRunReport = {
  profileSet: boolean;
  origin: ResolvedOriginRoot | null;
  plan: ProjectPlan | null;
  apply: ApplyProjectionResult | null;
  pullMessage: string | null;
  message: string;
};

/** Profile is set when adapter sync is enabled (maps to SyncProfile.enabled). */
export function isProjectionProfileSet(config: GrokRouterConfig): boolean {
  return config.sync.enabled === true;
}

/**
 * Build harness-neutral projection targets for Grok user rules.
 *
 * v1: project `cwd/.grok/rules` only when callers pass an explicit
 * `projectOriginRelDir` (e.g. `projects/<id>/rules`). Linking the same
 * origin `rules/` into both user and project dirs would double-index.
 * Skills projection is a follow-on (design backlog).
 */
export function buildGrokProjectionTargets(
  cwd: string,
  paths: GrokPaths = getGrokPaths(),
  opts: { projectOriginRelDir?: string } = {},
): ProjectionTarget[] {
  const targets: ProjectionTarget[] = [
    {
      id: "grok-user-rules",
      targetDir: paths.globalRulesDirs[0]!,
      originRelDir: "rules",
      entryKind: "files",
      pattern: "*.md",
      initTargetDir: true,
    },
  ];
  if (opts.projectOriginRelDir) {
    targets.push({
      id: "grok-project-rules",
      targetDir: getProjectRulesDirs(cwd)[0]!,
      originRelDir: opts.projectOriginRelDir,
      entryKind: "files",
      pattern: "*.md",
      initTargetDir: true,
    });
  }
  return targets;
}

/**
 * Construct a SyncProfile from grok config (legacy SyncConfig bridge).
 * Prefer core types only — no forked origin schema.
 */
export function buildGrokSyncProfile(
  config: GrokRouterConfig,
  cwd: string,
  paths: GrokPaths = getGrokPaths(),
): SyncProfile {
  return {
    version: 1,
    enabled: config.sync.enabled,
    origin: {
      root: config.sync.repoDir,
      repo: config.sync.repo || undefined,
    },
    projections: config.sync.enabled
      ? buildGrokProjectionTargets(cwd, paths)
      : [],
    onClobber: "fail-closed",
    relinkManaged: true,
    sync: {
      autoPull: config.sync.autoPull,
      autoCommitPush: config.sync.autoCommitPush,
      projectMappings: config.sync.projectMappings,
      caseSensitive: config.sync.caseSensitive,
    },
  };
}

/** Map adapter sync config to core SyncConfig for initSyncRepo / syncPull. */
export function toCoreSyncConfig(config: GrokRouterConfig): SyncConfig {
  return {
    enabled: config.sync.enabled,
    repo: config.sync.repo,
    autoPull: config.sync.autoPull,
    autoCommitPush: config.sync.autoCommitPush,
    projectMappings: config.sync.projectMappings,
    caseSensitive: config.sync.caseSensitive,
  };
}

/**
 * Resolve live origin root via core resolver (product default ~/.memex).
 * Explicit config.sync.repoDir maps to profile origin.root.
 */
export async function resolveGrokOrigin(
  config: GrokRouterConfig,
  opts: { homeDir?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<ResolvedOriginRoot> {
  return resolveOriginRoot({
    root: config.sync.repoDir,
    homeDir: opts.homeDir,
    env: opts.env,
  });
}

/**
 * Ensure origin exists, optionally pull remote, plan + apply rules projection.
 */
export async function runGrokProjection(
  opts: ProjectionRunOptions,
): Promise<ProjectionRunReport> {
  const { config } = opts;
  const cwd = opts.cwd ?? process.cwd();
  const paths = opts.paths ?? getGrokPaths();
  const dryRun = opts.dryRun === true;

  if (!isProjectionProfileSet(config)) {
    return {
      profileSet: false,
      origin: null,
      plan: null,
      apply: null,
      pullMessage: null,
      message:
        "sync profile not set (sync.enabled=false); enable in memex.json to project rules",
    };
  }

  const origin = await resolveGrokOrigin(config, {
    homeDir: opts.homeDir,
    env: opts.env,
  });
  const coreSync = toCoreSyncConfig(config);

  if (!dryRun) {
    await mkdir(origin.root, { recursive: true });
    await mkdir(join(origin.root, "rules"), { recursive: true });
    if (coreSync.repo) {
      await initSyncRepo(coreSync, origin.root);
    }
  }

  let pullMessage: string | null = null;
  if (!dryRun && coreSync.repo && coreSync.autoPull) {
    pullMessage = await syncPull(coreSync, origin.root);
  }

  const targets = buildGrokProjectionTargets(cwd, paths);
  const plan = await planProjection(origin.root, targets, { relinkManaged: true });

  if (dryRun) {
    return {
      profileSet: true,
      origin,
      plan,
      apply: null,
      pullMessage,
      message: `dry-run: origin=${origin.root} source=${origin.source} links=${plan.links.length} conflicts=${plan.conflicts.length}`,
    };
  }

  const apply = await applyProjection(plan, { onClobber: "fail-closed" });
  return {
    profileSet: true,
    origin,
    plan,
    apply,
    pullMessage,
    message: `origin=${origin.root} source=${origin.source} linked=${apply.linked} skipped=${apply.skipped} conflicts=${apply.conflicts.length}`,
  };
}

/**
 * Whether rules are expected to be projected into harness dirs (scan policy).
 * When true, buildScanDirs should not also append raw origin/rules (avoid double-index).
 */
export function rulesProjectionActive(config: GrokRouterConfig): boolean {
  return isProjectionProfileSet(config);
}
