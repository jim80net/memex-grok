// `memex doctor` health-check unit tests (cross-harness-integration spec —
// "Doctor command reports installation health"). Probes are injected so no test
// shells out to a real grok/binary; severity→exit semantics are pinned.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chdir } from "node:process";
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
const STAMP_OK = "0.1.0-alpha.0+abc1234";

function probes(over: Partial<DoctorProbes> = {}): DoctorProbes {
  return {
    findBinary: () => "/fake/memex-grok",
    binaryRuns: async () => true,
    binaryStamp: async () => STAMP_OK,
    readDeployStamp: () => STAMP_OK,
    readAvailableStamp: () => null,
    grokMcpServers: async () => ["memex-grok"],
    ...over,
  };
}

const sev = (r: Awaited<ReturnType<typeof runChecks>>, name: string) =>
  r.checks.find((c) => c.name === name)?.severity;

/** Project-scoped MCP list: read cwd `.grok/config.toml` only (mirrors grok behavior). */
function projectScopedMcpServersFromCwdConfig(): DoctorProbes["grokMcpServers"] {
  return async () => {
    const configPath = join(process.cwd(), ".grok", "config.toml");
    if (!existsSync(configPath)) return [];
    const text = readFileSync(configPath, "utf8");
    return /memex/i.test(text) ? ["memex-grok"] : [];
  };
}

const origCwd = process.cwd();

afterEach(async () => {
  chdir(origCwd);
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
  it("grok present but memex NOT registered in cwd → WARN (#25)", async () => {
    const r = await runChecks(fakePaths(), probes({ grokMcpServers: async () => ["something-else"] }));
    expect(sev(r, "mcp-registration")).toBe("WARN");
    expect(r.checks.find((c) => c.name === "mcp-registration")?.message).toMatch(/not registered in this cwd/);
    expect(r.ok).toBe(true);
  });

  it("memex in dir A config, doctor from dir B → WARN + exit 0 via real cwd config read (#25)", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "grok-mcp-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "grok-mcp-b-"));
    roots.push(dirA, dirB);
    mkdirSync(join(dirA, ".grok"), { recursive: true });
    writeFileSync(join(dirA, ".grok", "config.toml"), "[mcp.servers.memex-grok]\n", "utf8");

    chdir(dirB);
    const paths = fakePaths();
    mkdirSync(paths.syncRepoDir, { recursive: true });
    const r = await runChecks(paths, {
      ...probes(),
      grokMcpServers: projectScopedMcpServersFromCwdConfig(),
    });
    expect(sev(r, "mcp-registration")).toBe("WARN");
    expect(r.ok).toBe(true);
  });
});

describe("shared-origin check (resolveOriginRoot)", () => {
  it("present → OK", async () => {
    const paths = fakePaths();
    mkdirSync(paths.syncRepoDir, { recursive: true });
    expect(sev(await runChecks(paths, probes()), "shared-origin")).toBe("OK");
  });
  it("absent → WARN (self-initializes / memex init)", async () => {
    expect(sev(await runChecks(fakePaths(), probes()), "shared-origin")).toBe("WARN");
  });
});

describe("rules-projection + memory-surface", () => {
  it("projection idle when sync disabled", async () => {
    const r = await runChecks(fakePaths(), probes());
    expect(sev(r, "rules-projection")).toBe("OK");
    expect(r.checks.find((c) => c.name === "rules-projection")?.message).toMatch(/idle/);
  });

  it("memory-surface points at MCP tools not inject", async () => {
    const r = await runChecks(fakePaths(), probes());
    expect(sev(r, "memory-surface")).toBe("OK");
    expect(r.checks.find((c) => c.name === "memory-surface")?.message).toMatch(/MCP tools/);
    expect(r.checks.find((c) => c.name === "memory-surface")?.message).toMatch(/not inject/);
  });
});

describe("host-path egress (#13)", () => {
  it("scrubs /home/ from every check message", async () => {
    const fakeHome = "/home/testuser";
    const paths = fakePaths({
      binaryCacheDir: `${fakeHome}/.cache/memex-grok`,
      syncRepoDir: `${fakeHome}/.local/share/memex`,
      configPath: `${fakeHome}/.grok/memex.json`,
      modelsDir: `${fakeHome}/.grok/cache/models`,
      cacheDir: `${fakeHome}/.grok/cache`,
      telemetryPath: `${fakeHome}/.grok/cache/telemetry.json`,
      sessionsDir: `${fakeHome}/.grok/cache/sessions`,
    });
    const r = await runChecks(
      paths,
      probes({
        findBinary: () => `${fakeHome}/.cache/memex-grok/memex-grok`,
      }),
    );
    const blob = JSON.stringify(r);
    expect(blob).not.toMatch(/\/home\//);
    for (const c of r.checks) {
      expect(c.message).not.toMatch(/\/home\//);
    }
    expect(r.checks.find((c) => c.name === "binary")?.message).toContain("~/.cache/memex-grok");
  });
});

describe("deployed-binary drift check (#14)", () => {
  it("matching deploy stamp → OK", async () => {
    const r = await runChecks(fakePaths(), probes());
    expect(sev(r, "deployed-binary")).toBe("OK");
    expect(r.checks.find((c) => c.name === "deployed-binary")?.message).toContain(STAMP_OK);
  });

  it("deployed stamp differs from marker → WARN citing both", async () => {
    const r = await runChecks(
      fakePaths(),
      probes({
        binaryStamp: async () => "0.1.0-alpha.0+old1111",
        readDeployStamp: () => "0.1.0-alpha.0+new2222",
      }),
    );
    expect(sev(r, "deployed-binary")).toBe("WARN");
    const msg = r.checks.find((c) => c.name === "deployed-binary")?.message ?? "";
    expect(msg).toContain("0.1.0-alpha.0+old1111");
    expect(msg).toContain("0.1.0-alpha.0+new2222");
    expect(msg).toContain("redeploy");
    expect(r.ok).toBe(true);
  });

  it("deployed stamp differs from local build → WARN citing available", async () => {
    const r = await runChecks(
      fakePaths(),
      probes({
        binaryStamp: async () => "0.1.0-alpha.0+deployed",
        readDeployStamp: () => "0.1.0-alpha.0+deployed",
        readAvailableStamp: () => "0.1.0-alpha.0+freshbuild",
      }),
    );
    expect(sev(r, "deployed-binary")).toBe("WARN");
    const msg = r.checks.find((c) => c.name === "deployed-binary")?.message ?? "";
    expect(msg).toContain("0.1.0-alpha.0+deployed");
    expect(msg).toContain("0.1.0-alpha.0+freshbuild");
    expect(msg).toContain("available");
  });

  it("no marker and no local build stamp → WARN to record deploy stamp", async () => {
    const r = await runChecks(
      fakePaths(),
      probes({
        readDeployStamp: () => null,
        readAvailableStamp: () => null,
      }),
    );
    expect(sev(r, "deployed-binary")).toBe("WARN");
    expect(r.checks.find((c) => c.name === "deployed-binary")?.message).toContain(".stamp");
  });
});

describe("expected-by-design WARN grouping (#26)", () => {
  it("marks shared-origin/config/hooks WARNs as expectedByDesign", async () => {
    const r = await runChecks(fakePaths(), probes());
    for (const name of ["shared-origin", "config", "hooks"]) {
      const c = r.checks.find((x) => x.name === name);
      expect(c?.severity).toBe("WARN");
      expect(c?.expectedByDesign).toBe(true);
    }
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
