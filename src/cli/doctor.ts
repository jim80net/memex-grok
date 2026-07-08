// `memex doctor` — installation health report for the Grok adapter.
//
// Grok has no reliable hook injection (design D1/D3): the memex surfaces are the
// filesystem-synced corpus + the MCP server. So doctor's critical checks are the
// binary + MCP registration; the sync repo / config / model are advisory (they
// self-initialise on first use); hooks are informational (dormant by design).
//
// Severity → exit code (cross-harness-integration spec): OK→0, WARN-only→0, any
// FAIL→1. `--json` emits the structured report. Every check degrades gracefully:
// a missing external tool (e.g. the `grok` CLI on a dev box) is a WARN ("cannot
// verify"), NOT a crash — only a definitively-broken install is a FAIL.

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  deployStampPath,
  localBuildStampPath,
  normalizeStamp,
} from "../core/build-stamp.ts";
import { assertNoHostPathLeaks, scrubHostPaths } from "../core/host-path-egress.ts";
import { type GrokPaths, getGrokPaths } from "../core/paths.ts";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Severity = "OK" | "WARN" | "FAIL";

export interface Check {
  name: string;
  severity: Severity;
  message: string;
  /** Design-expected advisory (D1/D3/D5) — grouped separately in text output. */
  expectedByDesign?: boolean;
}

export interface DoctorReport {
  ok: boolean; // false iff any FAIL
  checks: Check[];
}

// The legacy memex-claude sync repo; memex-grok defers to it until the canonical
// project-id migration (design D5 / cross-harness coexistence).
const LEGACY_SYNC_REPO = join(homedir(), ".local", "share", "memex-claude");

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/** Run every health check and return the structured report. Pure over `paths`
 *  + injectable probes so each check is unit-testable without a live grok. */
export async function runChecks(
  paths: GrokPaths = getGrokPaths(),
  probes: DoctorProbes = defaultProbes,
): Promise<DoctorReport> {
  const checks: Check[] = [
    await checkBinary(paths, probes),
    await checkDeployedBinary(paths, probes),
    await checkMcpRegistration(probes),
    checkSyncRepo(paths),
    checkConfig(paths),
    checkModel(paths),
    checkHooks(),
  ];
  const report: DoctorReport = { ok: !checks.some((c) => c.severity === "FAIL"), checks };
  return sanitizeReport(report);
}

function sanitizeReport(report: DoctorReport): DoctorReport {
  const checks = report.checks.map((c) => ({
    ...c,
    message: scrubHostPaths(c.message),
  }));
  const sanitized = { ...report, checks };
  const blob = JSON.stringify(sanitized);
  assertNoHostPathLeaks(blob);
  return sanitized;
}

export async function runDoctor(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const report = await runChecks();
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const primary = report.checks.filter((c) => !c.expectedByDesign);
    const expected = report.checks.filter((c) => c.expectedByDesign);
    for (const c of primary) {
      process.stdout.write(`${c.severity}: ${c.name} — ${c.message}\n`);
    }
    if (expected.length > 0) {
      process.stdout.write("\n--- expected / by-design (healthy deploy) ---\n");
      for (const c of expected) {
        process.stdout.write(`${c.severity}: ${c.name} — ${c.message}\n`);
      }
    }
  }
  return report.ok ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Probes (injectable — so tests never shell out to a real grok binary)
// ---------------------------------------------------------------------------

export interface DoctorProbes {
  /** Absolute path of the installed memex-grok binary, or null if none. */
  findBinary: (paths: GrokPaths) => string | null;
  /** `<binary> --version` → true if it runs and exits 0. */
  binaryRuns: (binaryPath: string) => Promise<boolean>;
  /** `<binary> --version` stdout (build stamp), or null if unreadable. */
  binaryStamp: (binaryPath: string) => Promise<string | null>;
  /** Deploy marker under the binary cache dir (issue #14, option a). */
  readDeployStamp: (paths: GrokPaths) => string | null;
  /** Latest local `dist/<platform>/.stamp` when present (dev workflow). */
  readAvailableStamp: (paths: GrokPaths) => string | null;
  /** grok's registered MCP server ids in the current cwd project scope, or null
   *  if the grok CLI is not installed / not inspectable on this host. */
  grokMcpServers: () => Promise<string[] | null>;
  /** Scopes (user + project configs) where memex is registered; null if unscanable. */
  grokMemexScopeCount: () => Promise<number | null>;
}

const defaultProbes: DoctorProbes = {
  findBinary(paths) {
    const candidates = [
      join(paths.binaryCacheDir, "memex-grok"),
      join(paths.binaryCacheDir, "memex.bin"),
      join(process.cwd(), "dist", "memex-grok"),
    ];
    return candidates.find((p) => existsSync(p)) ?? null;
  },
  async binaryRuns(binaryPath) {
    try {
      // `--version` is the binary's liveness command (src/main.ts); `version`
      // (no dashes) is an unknown subcommand that exits non-zero.
      await execFileAsync(binaryPath, ["--version"], { timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  },
  async binaryStamp(binaryPath) {
    try {
      const { stdout } = await execFileAsync(binaryPath, ["--version"], { timeout: 10_000 });
      return normalizeStamp(stdout);
    } catch {
      return null;
    }
  },
  readDeployStamp(paths) {
    return readStampFile(deployStampPath(paths.binaryCacheDir));
  },
  readAvailableStamp(_paths) {
    return readStampFile(localBuildStampPath());
  },
  async grokMcpServers() {
    // grok's MCP registry surface; absent on a non-grok host → null (cannot verify).
    for (const args of [
      ["mcp", "list", "--json"],
      ["inspect", "--json"],
    ]) {
      try {
        const { stdout } = await execFileAsync("grok", args, { timeout: 10_000 });
        return extractServerIds(JSON.parse(stdout) as unknown);
      } catch {
        // try the next arg form
      }
    }
    return null;
  },
  async grokMemexScopeCount() {
    return scanMemexRegistrationScopes();
  },
};

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function checkDeployedBinary(paths: GrokPaths, probes: DoctorProbes): Promise<Check> {
  const bin = probes.findBinary(paths);
  if (!bin) {
    return {
      name: "deployed-binary",
      severity: "WARN",
      message: "skipped — no deployed binary to compare",
    };
  }

  const deployed = await probes.binaryStamp(bin);
  if (!deployed) {
    return {
      name: "deployed-binary",
      severity: "WARN",
      message: "cannot read build stamp from deployed binary",
    };
  }

  const marker = probes.readDeployStamp(paths);
  const available = probes.readAvailableStamp(paths);

  if (marker && deployed !== marker) {
    return {
      name: "deployed-binary",
      severity: "WARN",
      message: `deployed ${deployed} is stale, expected ${marker} — redeploy`,
    };
  }

  if (available && deployed !== available) {
    return {
      name: "deployed-binary",
      severity: "WARN",
      message: `deployed ${deployed} is stale, available ${available} — redeploy`,
    };
  }

  if (!marker && !available) {
    return {
      name: "deployed-binary",
      severity: "WARN",
      message: `no deploy stamp at ${deployStampPath(paths.binaryCacheDir)}; record one when deploying`,
    };
  }

  return {
    name: "deployed-binary",
    severity: "OK",
    message: `deploy stamp ${deployed} matches deployed binary`,
  };
}

async function checkBinary(paths: GrokPaths, probes: DoctorProbes): Promise<Check> {
  const bin = probes.findBinary(paths);
  if (!bin) {
    return {
      name: "binary",
      severity: "FAIL",
      message: `memex-grok binary not found (looked under ${paths.binaryCacheDir}); run bin/install.sh`,
    };
  }
  const runs = await probes.binaryRuns(bin);
  return runs
    ? { name: "binary", severity: "OK", message: `present and runnable (${bin})` }
    : { name: "binary", severity: "FAIL", message: `present but not runnable (${bin})` };
}

async function checkMcpRegistration(probes: DoctorProbes): Promise<Check> {
  const servers = await probes.grokMcpServers();
  if (servers === null) {
    return {
      name: "mcp-registration",
      severity: "WARN",
      message: "grok CLI not found — cannot verify MCP registration (run on a grok host)",
    };
  }
  const cwdHasMemex = servers.some((s) => /memex/i.test(s));
  if (cwdHasMemex) {
    return { name: "mcp-registration", severity: "OK", message: "memex MCP server registered with grok" };
  }
  const scopeCount = await probes.grokMemexScopeCount();
  if (scopeCount != null && scopeCount > 0) {
    const n = scopeCount === 1 ? "1 scope" : `${scopeCount} scopes`;
    return {
      name: "mcp-registration",
      severity: "WARN",
      message:
        `memex registered in ${n} but not in current cwd — run doctor from your project dir or \`grok mcp add\` here`,
    };
  }
  return {
    name: "mcp-registration",
    severity: "FAIL",
    message: `memex MCP server not registered (grok knows in cwd: ${servers.join(", ") || "none"})`,
  };
}

function checkSyncRepo(paths: GrokPaths): Check {
  if (existsSync(paths.syncRepoDir)) {
    return { name: "sync-repo", severity: "OK", message: `present at ${paths.syncRepoDir}` };
  }
  if (existsSync(LEGACY_SYNC_REPO)) {
    return {
      name: "sync-repo",
      severity: "WARN",
      expectedByDesign: true,
      message: `deferring to memex-claude repo at ${LEGACY_SYNC_REPO} (canonical-id migration pending; run doctor --migrate-repo)`,
    };
  }
  return {
    name: "sync-repo",
    severity: "WARN",
    expectedByDesign: true,
    message: `not initialized (${paths.syncRepoDir}); it self-creates on first sync`,
  };
}

function checkConfig(paths: GrokPaths): Check {
  return existsSync(paths.configPath)
    ? { name: "config", severity: "OK", message: `present at ${paths.configPath}` }
    : {
        name: "config",
        severity: "WARN",
        expectedByDesign: true,
        message: `no memex.json (${paths.configPath}); using defaults`,
      };
}

function checkModel(paths: GrokPaths): Check {
  // The local embedding model powers MCP semantic search; absent → downloads on
  // first search (advisory, not a hard failure).
  const present = existsSync(join(paths.modelsDir, "Xenova")) || existsSync(paths.modelsDir);
  return present
    ? { name: "embedding-model", severity: "OK", message: `model cache at ${paths.modelsDir}` }
    : {
        name: "embedding-model",
        severity: "WARN",
        message: `no model cache (${paths.modelsDir}); downloads on first MCP search`,
      };
}

function checkHooks(): Check {
  // Grok hook injection is dormant/best-effort by design (D1/D3) — MCP is the
  // authoritative surface. Informational, never a failure.
  return {
    name: "hooks",
    severity: "WARN",
    expectedByDesign: true,
    message: "grok hook injection is dormant by design (D1/D3) — MCP is the primary surface",
  };
}

// ---------------------------------------------------------------------------
// Private
// ---------------------------------------------------------------------------

function readStampFile(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    return normalizeStamp(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Pull server ids out of whatever shape the grok MCP registry returns. */
function extractServerIds(parsed: unknown): string[] {
  if (Array.isArray(parsed)) {
    return parsed.map(serverId).filter((s): s is string => s !== null);
  }
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const list = obj.servers ?? obj.mcpServers ?? obj.mcp;
    if (Array.isArray(list)) {
      return list.map(serverId).filter((s): s is string => s !== null);
    }
    if (list && typeof list === "object") {
      return Object.keys(list); // { "memex-grok": {...} } shape
    }
  }
  return [];
}

/** Count user + cwd project scopes where memex appears in grok MCP config. */
function scanMemexRegistrationScopes(): number {
  const seen = new Set<string>();
  for (const path of [
    join(homedir(), ".grok", "config.toml"),
    join(process.cwd(), ".grok", "config.toml"),
  ]) {
    if (!existsSync(path)) continue;
    try {
      if (/memex/i.test(readFileSync(path, "utf8"))) seen.add(path);
    } catch {
      // unreadable config — skip
    }
  }
  return seen.size;
}

function serverId(entry: unknown): string | null {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    const o = entry as Record<string, unknown>;
    const id = o.name ?? o.id ?? o.server;
    return typeof id === "string" ? id : null;
  }
  return null;
}
