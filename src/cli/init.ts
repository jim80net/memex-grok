// `memex init` — ensure shared origin + project harness rules as origin symlinks.
// Design: docs/superpowers/specs/2026-07-10-file-rules-symlink-init.md

import { loadConfig } from "../core/config.ts";
import { scrubHostPaths } from "../core/host-path-egress.ts";
import { runGrokProjection, type ProjectionRunReport } from "../core/projection.ts";

export type InitCliOptions = {
  cwd: string;
  strict: boolean;
  dryRun: boolean;
  json: boolean;
};

export function parseInitArgs(args: string[]): InitCliOptions {
  let cwd = process.cwd();
  let strict = false;
  let dryRun = false;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--strict") strict = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--json") json = true;
    else if (a === "--cwd" && args[i + 1]) {
      cwd = args[++i]!;
    } else if (a?.startsWith("--cwd=")) {
      cwd = a.slice("--cwd=".length);
    }
  }
  return { cwd, strict, dryRun, json };
}

function exitCode(report: ProjectionRunReport, strict: boolean): number {
  if (!report.profileSet) return 0;
  const conflicts = report.apply?.conflicts.length ?? report.plan?.conflicts.length ?? 0;
  if (strict && conflicts > 0) return 1;
  return 0;
}

function printHuman(report: ProjectionRunReport): void {
  process.stdout.write(`${scrubHostPaths(report.message)}\n`);
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
      "hint: set sync.enabled=true in ~/.grok/memex.json (or MEMEX_CONFIG) to project rules\n",
    );
  }
}

export async function runInit(args: string[]): Promise<number> {
  const opts = parseInitArgs(args);
  const config = await loadConfig();
  const report = await runGrokProjection({
    config,
    cwd: opts.cwd,
    dryRun: opts.dryRun,
  });
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printHuman(report);
  }
  return exitCode(report, opts.strict);
}
