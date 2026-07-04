// `memex doctor` health-check unit tests (cross-harness-integration spec —
// "Doctor command reports installation health"). Probes are injected so no test
// shells out to a real grok/binary; severity→exit semantics are pinned.

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type DoctorProbes, runChecks } from "../src/cli/doctor.ts";
import type { GrokPaths } from "../src/core/paths.ts";

const roots: string[] = [];
function fakePaths(over: Partial<GrokPaths> = {}): GrokPaths {
  const root = mkdtempSync(join(tmpdir(), "grok-doctor-"));
  roots.push(root);
  return {
    cacheDir: join(root, "cache"),
    modelsDir: join(root, "cache", "models"),
    sessionsDir: join(root, "cache", "sessions"),
    syncRepoDir: join(root, "sync"),
    telemetryPath: join(root, "cache", "telemetry.json"),
    configPath: join(root, "memex.json"),
    binaryCacheDir: join(root, "bin"),
    globalSkillsDirs: [],
    globalRulesDirs: [],
    ...over,
  };
}

// Probes for a "fully healthy" install by default; tests override per-case.
function probes(over: Partial<DoctorProbes> = {}): DoctorProbes {
  return {
    findBinary: () => "/fake/memex-grok",
    binaryRuns: async () => true,
    grokMcpServers: async () => ["memex-grok"],
    ...over,
  };
}

const sev = (r: Awaited<ReturnType<typeof runChecks>>, name: string) =>
  r.checks.find((c) => c.name === name)?.severity;

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

describe("doctor severity → report.ok", () => {
  it("all-OK-or-WARN → ok:true (exit 0)", async () => {
    const paths = fakePaths();
    mkdirSync(paths.syncRepoDir, { recursive: true }); // OK
    // config/model absent → WARN; hooks WARN; but no FAIL
    const r = await runChecks(paths, probes());
    expect(r.checks.some((c) => c.severity === "FAIL")).toBe(false);
    expect(r.ok).toBe(true);
  });

  it("any FAIL → ok:false (exit 1)", async () => {
    const r = await runChecks(fakePaths(), probes({ findBinary: () => null }));
    expect(sev(r, "binary")).toBe("FAIL");
    expect(r.ok).toBe(false);
  });
});

describe("binary check", () => {
  it("missing binary is FAIL", async () => {
    const r = await runChecks(fakePaths(), probes({ findBinary: () => null }));
    expect(sev(r, "binary")).toBe("FAIL");
  });
  it("present-but-not-runnable is FAIL", async () => {
    const r = await runChecks(fakePaths(), probes({ binaryRuns: async () => false }));
    expect(sev(r, "binary")).toBe("FAIL");
  });
  it("present and runnable is OK", async () => {
    expect(sev(await runChecks(fakePaths(), probes()), "binary")).toBe("OK");
  });
});

describe("mcp-registration check (grok's primary surface)", () => {
  it("grok absent → WARN (cannot verify, not a crash)", async () => {
    const r = await runChecks(fakePaths(), probes({ grokMcpServers: async () => null }));
    expect(sev(r, "mcp-registration")).toBe("WARN");
    expect(r.ok).toBe(true); // WARN does not fail the run
  });
  it("registered → OK", async () => {
    const r = await runChecks(fakePaths(), probes({ grokMcpServers: async () => ["other", "memex-grok"] }));
    expect(sev(r, "mcp-registration")).toBe("OK");
  });
  it("grok present but memex NOT registered → FAIL", async () => {
    const r = await runChecks(fakePaths(), probes({ grokMcpServers: async () => ["something-else"] }));
    expect(sev(r, "mcp-registration")).toBe("FAIL");
    expect(r.ok).toBe(false);
  });
});

describe("sync-repo check (coexistence/deferral)", () => {
  it("present → OK", async () => {
    const paths = fakePaths();
    mkdirSync(paths.syncRepoDir, { recursive: true });
    expect(sev(await runChecks(paths, probes()), "sync-repo")).toBe("OK");
  });
  it("absent → WARN (self-initializes)", async () => {
    expect(sev(await runChecks(fakePaths(), probes()), "sync-repo")).toBe("WARN");
  });
});

describe("advisory checks never FAIL", () => {
  it("config/model absent → WARN; hooks → WARN (dormant by design)", async () => {
    const r = await runChecks(fakePaths(), probes());
    expect(sev(r, "config")).toBe("WARN");
    expect(sev(r, "embedding-model")).toBe("WARN");
    expect(sev(r, "hooks")).toBe("WARN");
  });
  it("config present → OK", async () => {
    const paths = fakePaths();
    writeFileSync(paths.configPath, "{}", "utf-8");
    expect(sev(await runChecks(paths, probes()), "config")).toBe("OK");
  });
});
