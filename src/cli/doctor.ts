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
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
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
    await checkMcpRegistration(probes),
    checkSyncRepo(paths),
    checkConfig(paths),
    checkModel(paths),
    checkHooks(),
  ];
  return { ok: !checks.some((c) => c.severity === "FAIL"), checks };
}

export async function runDoctor(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const report = await runChecks();
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    for (const c of report.checks) {
      process.stdout.write(`${c.severity}: ${c.name} — ${c.message}\n`);
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
  /** `<binary> version` → true if it runs and exits 0. */
  binaryRuns: (binaryPath: string) => Promise<boolean>;
  /** grok's registered MCP server ids, or null if the grok CLI is not
   *  installed / not inspectable on this host. */
  grokMcpServers: () => Promise<string[] | null>;
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
      await execFileAsync(binaryPath, ["version"], { timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
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
};

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

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
  const registered = servers.some((s) => /memex/i.test(s));
  return registered
    ? { name: "mcp-registration", severity: "OK", message: "memex MCP server registered with grok" }
    : {
        name: "mcp-registration",
        severity: "FAIL",
        message: `memex MCP server not registered (grok knows: ${servers.join(", ") || "none"})`,
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
      message: `deferring to memex-claude repo at ${LEGACY_SYNC_REPO} (canonical-id migration pending; run doctor --migrate-repo)`,
    };
  }
  return {
    name: "sync-repo",
    severity: "WARN",
    message: `not initialized (${paths.syncRepoDir}); it self-creates on first sync`,
  };
}

function checkConfig(paths: GrokPaths): Check {
  return existsSync(paths.configPath)
    ? { name: "config", severity: "OK", message: `present at ${paths.configPath}` }
    : { name: "config", severity: "WARN", message: `no memex.json (${paths.configPath}); using defaults` };
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
    message: "grok hook injection is dormant by design (D1/D3) — MCP is the primary surface",
  };
}

// ---------------------------------------------------------------------------
// Private
// ---------------------------------------------------------------------------

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

function serverId(entry: unknown): string | null {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    const o = entry as Record<string, unknown>;
    const id = o.name ?? o.id ?? o.server;
    return typeof id === "string" ? id : null;
  }
  return null;
}
