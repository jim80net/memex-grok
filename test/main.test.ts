import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

const ENTRY = ["tsx", "src/main.ts"];

function run(args: string[]): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execFileSync("npx", [...ENTRY, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { stdout, stderr: "", code: 0 };
  } catch (e: any) {
    return { stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? ""), code: e.status ?? 1 };
  }
}

describe("memex CLI", () => {
  it("prints version with --version", () => {
    const r = run(["--version"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("exits 1 with a clear message for unimplemented subcommands", () => {
    const r = run(["sync"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("not yet implemented");
  });

  it("exits 1 with usage when called with no args", () => {
    const r = run([]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("usage");
  });
});
