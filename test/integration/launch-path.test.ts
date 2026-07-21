// Launch-path integration tests — spawn the BUILT binary and drive real MCP
// stdio. Issue #3 guard: initialize handshake. Issue #4 guard: a real
// `memex_search` tools/call against the compiled embedding backend (not just
// tools/list discovery).
//
// Gated on the binary existing: `pnpm test` without a prior build skips (no
// false failure locally); CI builds first (see .github/workflows/ci.yml), so
// the assertion runs for real. A broken build fails loudly in the build step.

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { arch, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { homedir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { assertNoHostPathLeaks } from "../../src/mcp/location-handle.ts";

const DIST_DIR = join(process.cwd(), "dist", `${platform()}-${arch()}`);
const BIN = join(DIST_DIR, "memex");
const built = existsSync(BIN);
const SKILL_FIXTURE = join(process.cwd(), "test", "fixtures", "skills", "launch-path-smoke");

const tempHomes: string[] = [];
afterEach(() => {
  for (const home of tempHomes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "launch-path-smoke", version: "0" },
  },
};

function spawnMcp(env: NodeJS.ProcessEnv = process.env): ChildProcessWithoutNullStreams {
  const childEnv = { ...process.env, ...env };
  delete childEnv.LD_LIBRARY_PATH;
  return spawn(BIN, ["mcp"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: childEnv,
  });
}

/** Read JSON-RPC response lines until `id` matches or reject on timeout/exit. */
function readResponses(
  child: ChildProcessWithoutNullStreams,
  opts: { wantId?: number; timeoutMs?: number } = {},
): Promise<{ responses: Record<string, unknown>[]; stderr: string }> {
  const { wantId, timeoutMs = 20_000 } = opts;
  return new Promise((resolve, reject) => {
    let buf = "";
    let err = "";
    const responses: Record<string, unknown>[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timed out after ${timeoutMs}ms; stderr: ${err}; stdout: ${buf}`));
    }, timeoutMs);

    const maybeDone = () => {
      if (wantId !== undefined && responses.some((r) => r.id === wantId)) {
        clearTimeout(timer);
        child.kill("SIGKILL");
        resolve({ responses, stderr: err });
      }
    };

    child.stdout.on("data", (d) => {
      buf += d.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          responses.push(JSON.parse(line) as Record<string, unknown>);
        } catch (e) {
          clearTimeout(timer);
          child.kill("SIGKILL");
          reject(new Error(`unparseable line: ${line} (${String(e)})`));
          return;
        }
        maybeDone();
      }
    });
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("exit", (code) => {
      if (wantId !== undefined && !responses.some((r) => r.id === wantId)) {
        clearTimeout(timer);
        reject(new Error(`server exited (code ${code}) before id=${wantId}; stderr: ${err.trim()}; stdout: ${buf}`));
      }
    });
  });
}

/** Spawn `<BIN> mcp`, send one initialize request, resolve the first JSON-RPC
 *  response line (or reject on exit-before-response / timeout). */
async function initializeHandshake(timeoutMs = 20_000): Promise<Record<string, unknown>> {
  const child = spawnMcp();
  const pending = readResponses(child, { wantId: 1, timeoutMs });
  child.stdin.write(`${JSON.stringify(INITIALIZE)}\n`);
  const { responses } = await pending;
  return responses.find((r) => r.id === 1) ?? responses[0];
}

function isolatedHome(skillDirs: string[]): string {
  const home = mkdtempSync(join(tmpdir(), "memex-grok-launch-"));
  tempHomes.push(home);
  mkdirSync(join(home, ".grok", "cache", "models"), { recursive: true });
  writeFileSync(
    join(home, ".grok", "memex.json"),
    JSON.stringify({ skillDirs }),
  );
  return home;
}

// Skips locally when unbuilt (CI builds first, so it always runs there). The
// describe name carries the reason so a skipped line is self-explanatory.
describe.skipIf(!built)("built binary launch path (issue #3/#4 — run `pnpm build` first)", () => {
  it("completes the MCP initialize handshake as a spawned process", async () => {
    const resp = (await initializeHandshake()) as {
      result?: { protocolVersion?: string; serverInfo?: { name?: string } };
      error?: unknown;
    };
    expect(resp.error).toBeUndefined();
    expect(resp.result?.protocolVersion).toBe("2024-11-05");
    expect(resp.result?.serverInfo?.name).toBe("memex");
  });

  it("memex_search loads the adjacent ONNX runtime without LD_LIBRARY_PATH (issues #4/#5)", async () => {
    const home = isolatedHome([join(SKILL_FIXTURE, "..")]);
    const child = spawnMcp({ HOME: home });
    const pending = readResponses(child, { wantId: 2, timeoutMs: 120_000 });

    child.stdin.write(`${JSON.stringify(INITIALIZE)}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "memex_search",
          arguments: { query: "standard development flow ship memex", threshold: 0.3 },
        },
      })}\n`,
    );

    const { responses, stderr } = await pending;
    const search = responses.find((r) => r.id === 2) as {
      error?: { message?: string };
      result?: { content?: Array<{ text?: string }> };
    };
    expect(stderr).not.toMatch(/requires @huggingface\/transformers/);
    expect(search?.error).toBeUndefined();
    const payload = JSON.parse(search?.result?.content?.[0]?.text ?? "{}") as {
      results?: Array<{ name?: string; relevance?: number; location?: string }>;
    };
    expect(payload.results?.length).toBeGreaterThan(0);
    expect(payload.results?.[0]?.name).toBe("launch-path-smoke-skill");
    expect(payload.results?.[0]?.relevance).toBeGreaterThan(0.3);

    const searchText = search?.result?.content?.[0]?.text ?? "";
    assertNoHostPathLeaks(searchText, home);
    expect(payload.results?.[0]?.location).toMatch(/^memex:\/\//);
  }, 130_000);

  it("serves bounded human search/read inspection from the built binary (issue #50)", () => {
    const home = isolatedHome([]);
    const skills = join(home, "inspection-skills");
    const skill = join(skills, "inspection-long-content");
    mkdirSync(skill, { recursive: true });
    const longBody = "Paging regression content. ".repeat(240);
    writeFileSync(
      join(skill, "SKILL.md"),
      `---\nname: inspection-long-content\ndescription: A deliberately long inspection fixture with a compact searchable teaser.\n---\n\n# Inspection paging\n\n${longBody}\n`,
    );
    writeFileSync(
      join(home, ".grok", "memex.json"),
      JSON.stringify({ skillDirs: [skills] }),
    );
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
    delete env.LD_LIBRARY_PATH;

    const search = spawnSync(
      BIN,
      ["search", "--threshold", "0", "--top-k", "1", "inspection paging regression"],
      { encoding: "utf8", env, timeout: 120_000 },
    );
    expect(search.error).toBeUndefined();
    expect(search.status, search.stderr).toBe(0);
    expect(search.stdout).toContain("1 result(s)");
    expect(search.stdout).toContain("inspection-long-content [skill] relevance=");
    expect(search.stdout).toContain("read: memex read 'memex://");
    expect(search.stdout.split("\n").length).toBeLessThanOrEqual(6);
    assertNoHostPathLeaks(search.stdout, home);

    const read = spawnSync(BIN, ["read", "inspection-long-content"], {
      encoding: "utf8",
      env,
      timeout: 120_000,
    });
    expect(read.error).toBeUndefined();
    expect(read.status, read.stderr).toBe(0);
    expect(read.stdout).toContain("page 1/4 (chars 1-2000 of");
    expect(read.stdout).toContain("Continue: memex read 'inspection-long-content' --page 2");
    expect(read.stdout).toContain("Full: memex read 'inspection-long-content' --full");
    expect(read.stdout.length).toBeLessThan(2_500);
    assertNoHostPathLeaks(read.stdout, home);

    const raw = spawnSync(BIN, ["read", "inspection-long-content", "--raw"], {
      encoding: "utf8",
      env,
      timeout: 120_000,
    });
    expect(raw.status, raw.stderr).toBe(0);
    expect(raw.stdout).toContain(longBody.trim());
    expect(raw.stdout.length).toBeGreaterThan(6_000);

    const empty = spawnSync(BIN, ["search", "--threshold", "1", "no matching corpus entry"], {
      encoding: "utf8",
      env,
      timeout: 120_000,
    });
    expect(empty.status, empty.stderr).toBe(0);
    expect(empty.stdout).toBe('No results for "no matching corpus entry".\n');

    const security = spawnSync(BIN, ["read", "/etc/shadow"], {
      encoding: "utf8",
      env,
      timeout: 120_000,
    });
    expect(security.status).toBe(1);
    expect(security.stderr).toContain("memex: read: unrecognized location");
    expect(security.stdout).toBe("");
    assertNoHostPathLeaks(security.stderr, home);
  }, 620_000);

  it("search→read_skill round-trip via portable handle (issues #6/#7)", async () => {
    const home = isolatedHome([join(SKILL_FIXTURE, "..")]);
    const child = spawnMcp({ HOME: home });
    const pending = readResponses(child, { wantId: 2, timeoutMs: 120_000 });

    child.stdin.write(`${JSON.stringify(INITIALIZE)}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "memex_search",
          arguments: { query: "standard development flow ship memex", threshold: 0.3 },
        },
      })}\n`,
    );

    const { responses } = await pending;
    const search = responses.find((r) => r.id === 2) as {
      result?: { content?: Array<{ text?: string }> };
    };
    const searchPayload = JSON.parse(search?.result?.content?.[0]?.text ?? "{}") as {
      query_id?: string;
      results?: Array<{ location?: string }>;
    };
    const handle = searchPayload.results?.[0]?.location;
    expect(handle).toMatch(/^memex:\/\//);

    const child2 = spawnMcp({ HOME: home });
    const pending2 = readResponses(child2, { wantId: 3, timeoutMs: 120_000 });
    child2.stdin.write(`${JSON.stringify(INITIALIZE)}\n`);
    child2.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    child2.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "memex_read_skill",
          arguments: { location: handle, query_id: searchPayload.query_id },
        },
      })}\n`,
    );

    const { responses: readResponses2, stderr } = await pending2;
    const read = readResponses2.find((r) => r.id === 3) as {
      error?: unknown;
      result?: { content?: Array<{ text?: string }> };
    };
    expect(stderr).not.toMatch(/requires @huggingface\/transformers/);
    expect(read?.error).toBeUndefined();
    const body = read?.result?.content?.[0]?.text ?? "";
    expect(body).toMatch(/brainstorm/i);
    assertNoHostPathLeaks(body, home);
    assertNoHostPathLeaks(JSON.stringify(read), homedir());
  }, 260_000);

  it("memex_status reports populated index in the compiled binary (issue #9)", async () => {
    const home = isolatedHome([join(SKILL_FIXTURE, "..")]);
    const child = spawnMcp({ HOME: home });
    const pending = readResponses(child, { wantId: 2, timeoutMs: 120_000 });

    child.stdin.write(`${JSON.stringify(INITIALIZE)}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "memex_status", arguments: {} },
      })}\n`,
    );

    const { responses, stderr } = await pending;
    const status = responses.find((r) => r.id === 2) as {
      error?: unknown;
      result?: { content?: Array<{ text?: string }> };
    };
    expect(stderr).not.toMatch(/requires @huggingface\/transformers/);
    expect(status?.error).toBeUndefined();
    const payload = JSON.parse(status?.result?.content?.[0]?.text ?? "{}") as {
      index_size?: number;
      source_counts?: Record<string, number>;
    };
    expect(payload.index_size).toBeGreaterThan(0);
    expect(Object.keys(payload.source_counts ?? {}).length).toBeGreaterThan(0);
    expect(Object.values(payload.source_counts ?? {}).reduce((a, b) => a + b, 0)).toBe(
      payload.index_size,
    );
    assertNoHostPathLeaks(status?.result?.content?.[0]?.text ?? "", home);
  }, 130_000);

  it("persists a real compiled-binary sync and reports its measured time (issue #38)", async () => {
    const home = isolatedHome([join(SKILL_FIXTURE, "..")]);
    const origin = join(home, "origin");
    mkdirSync(join(origin, "rules"), { recursive: true });
    writeFileSync(
      join(home, ".grok", "memex.json"),
      JSON.stringify({
        skillDirs: [join(SKILL_FIXTURE, "..")],
        sync: { enabled: true, repoDir: origin, autoPull: false },
      }),
    );

    const before = Date.now();
    const sync = spawnSync(BIN, ["sync", "--cwd", home], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
    expect(sync.status, sync.stderr).toBe(0);
    expect(sync.stdout).toMatch(/sync-state: last successful sync recorded at/);

    const child = spawnMcp({ HOME: home });
    const pending = readResponses(child, { wantId: 2, timeoutMs: 120_000 });
    child.stdin.write(`${JSON.stringify(INITIALIZE)}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "memex_status", arguments: {} },
      })}\n`,
    );

    const { responses, stderr } = await pending;
    const status = responses.find((response) => response.id === 2) as {
      error?: unknown;
      result?: { content?: Array<{ text?: string }> };
    };
    expect(stderr).not.toMatch(/requires @huggingface\/transformers/);
    expect(status?.error).toBeUndefined();
    const payload = JSON.parse(status?.result?.content?.[0]?.text ?? "{}") as {
      last_sync_at?: string | null;
      last_sync_attempt_at?: string | null;
      sync_state?: string;
      sync_status?: string;
    };
    expect(payload.sync_state).toBe("synced");
    expect(payload.last_sync_at).toBe(payload.last_sync_attempt_at);
    expect(Date.parse(payload.last_sync_at ?? "")).toBeGreaterThanOrEqual(before);
    expect(payload.sync_status).toBe(
      `The last sync completed successfully at ${payload.last_sync_at}.`,
    );
    assertNoHostPathLeaks(status?.result?.content?.[0]?.text ?? "", home);
  }, 130_000);
});
