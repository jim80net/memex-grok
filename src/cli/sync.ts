// `memex sync` — pull origin (when remote configured) + re-project harness rules.
// Design: docs/superpowers/specs/2026-07-10-file-rules-symlink-init.md
// Memory write-path / full Plan 3 remains separate; this chapter is rules projection.

import { loadConfig } from "../core/config.ts";
import { scrubHostPaths } from "../core/host-path-egress.ts";
import { runGrokProjection, type ProjectionRunReport } from "../core/projection.ts";
import { parseInitArgs } from "./init.ts";
import { getGrokPaths } from "../core/paths.ts";
import {
  recordSyncFailure,
  recordSyncSuccess,
  syncStatePath,
} from "../core/sync-state.ts";

function exitCode(report: ProjectionRunReport, strict: boolean): number {
  if (!report.profileSet) return 0;
  const conflicts = report.apply?.conflicts.length ?? report.plan?.conflicts.length ?? 0;
  if (strict && conflicts > 0) return 1;
  return 0;
}

function printHuman(report: ProjectionRunReport): void {
  process.stdout.write(`sync: ${scrubHostPaths(report.message)}\n`);
  if (report.pullMessage) {
    process.stdout.write(`pull: ${scrubHostPaths(report.pullMessage)}\n`);
  }
  const conflicts = report.apply?.conflicts ?? report.plan?.conflicts ?? [];
  for (const c of conflicts) {
    process.stdout.write(
      scrubHostPaths(`conflict: ${c.targetPath} (${c.reason}) — not clobbered\n`),
    );
  }
  if (!report.profileSet) {
    process.stdout.write(
      "hint: set sync.enabled=true in ~/.grok/memex.json to enable origin pull + projection\n",
    );
  }
}

export async function runSync(args: string[]): Promise<number> {
  const opts = parseInitArgs(args);
  const config = await loadConfig();
  const statePath = syncStatePath(getGrokPaths().cacheDir);
  let report: ProjectionRunReport;
  try {
    // Same path as init: resolve origin, optional pull (when repo+autoPull), project.
    report = await runGrokProjection({
      config,
      cwd: opts.cwd,
      dryRun: opts.dryRun,
    });
  } catch (error) {
    if (config.sync.enabled && !opts.dryRun) {
      await recordSyncFailure(statePath, new Date().toISOString());
    }
    throw error;
  }
  const code = exitCode(report, opts.strict);
  const completedAt = new Date().toISOString();
  if (config.sync.enabled && !opts.dryRun) {
    if (code === 0) {
      await recordSyncSuccess(statePath, completedAt);
    } else {
      await recordSyncFailure(statePath, completedAt);
    }
  }
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printHuman(report);
    if (config.sync.enabled && !opts.dryRun) {
      process.stdout.write(
        code === 0
          ? `sync-state: last successful sync recorded at ${completedAt}\n`
          : `sync-state: failed sync attempt recorded at ${completedAt}\n`,
      );
    }
  }
  return code;
}
