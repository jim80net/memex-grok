import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ENTRY = ["tsx", "src/main.ts"];
const EMPTY_CONFIG = join(tmpdir(), `memex-grok-test-missing-${process.pid}.json`);

function run(args: string[]): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execFileSync("npx", [...ENTRY, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, MEMEX_CONFIG: EMPTY_CONFIG },
    });
    return { stdout, stderr: "", code: 0 };
  } catch (e: any) {
    return { stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? ""), code: e.status ?? 1 };
  }
}

describe("memex CLI", () => {
  it("parses and initializes MCP from source in Node strip-only mode", () => {
    const initialize = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "source-launch-test", version: "0" },
      },
    });
    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "src/main.ts", "mcp"],
      {
        cwd: join(import.meta.dirname, ".."),
        encoding: "utf8",
        input: `${initialize}\n`,
        timeout: 20_000,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("parameter property");
    const response = JSON.parse(result.stdout.trim()) as {
      id?: number;
      result?: { serverInfo?: { name?: string } };
    };
    expect(response.id).toBe(1);
    expect(response.result?.serverInfo?.name).toBe("memex");
  });

  it("prints version with --version", () => {
    const r = run(["--version"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("init is implemented (profile-off exits 0 with guidance)", () => {
    const r = run(["init"]);
    expect(r.code).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/sync\.enabled=false|profile not set/i);
  });

  it("sync is implemented (profile-off exits 0 with guidance)", () => {
    const r = run(["sync"]);
    expect(r.code).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/sync\.enabled=false|profile not set|enable/i);
  });

  it("exits 1 with a clear message for still-unimplemented subcommands", () => {
    const r = run(["hook"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("not yet implemented");
  });

  it("exits 1 with usage when called with no args", () => {
    const r = run([]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("usage");
  });
});
