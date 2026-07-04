// Launch-path smoke test — spawns the BUILT binary and drives a real MCP
// `initialize` handshake over stdio. This is the guard for issue #3: the unit
// suite transforms via esbuild (which handles TS parameter properties), so it
// stays green even when the actual `node --experimental-strip-types` / bundled
// launch path is broken. Only a test against the shipped artifact catches a
// server that can't complete `initialize`.
//
// Gated on the binary existing: `pnpm test` without a prior build skips (no
// false failure locally); CI builds first (see .github/workflows/ci.yml), so
// the assertion runs for real. A broken build fails loudly in the build step.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { arch, platform } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BIN = join(process.cwd(), "dist", `${platform()}-${arch()}`, "memex");
const built = existsSync(BIN);

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

/** Spawn `<BIN> mcp`, send one initialize request, resolve the first JSON-RPC
 *  response line (or reject on exit-before-response / timeout). */
function initializeHandshake(timeoutMs = 20_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(BIN, ["mcp"], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`no initialize response within ${timeoutMs}ms; stderr: ${err}`));
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      out += d.toString();
      const nl = out.indexOf("\n");
      if (nl !== -1) {
        clearTimeout(timer);
        child.kill("SIGKILL");
        try {
          resolve(JSON.parse(out.slice(0, nl)));
        } catch (e) {
          reject(new Error(`unparseable response: ${out.slice(0, nl)} (${String(e)})`));
        }
      }
    });
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("exit", (code) => {
      if (out.indexOf("\n") === -1) {
        clearTimeout(timer);
        reject(new Error(`server exited (code ${code}) before responding; stderr: ${err.trim()}`));
      }
    });
    child.stdin.write(`${JSON.stringify(INITIALIZE)}\n`);
  });
}

// Skips locally when unbuilt (CI builds first, so it always runs there). The
// describe name carries the reason so a skipped line is self-explanatory.
describe.skipIf(!built)("built binary launch path (issue #3 guard — run `pnpm build` first)", () => {
  it("completes the MCP initialize handshake as a spawned process", async () => {
    const resp = (await initializeHandshake()) as {
      result?: { protocolVersion?: string; serverInfo?: { name?: string } };
      error?: unknown;
    };
    expect(resp.error).toBeUndefined();
    expect(resp.result?.protocolVersion).toBe("2024-11-05");
    expect(resp.result?.serverInfo?.name).toBe("memex");
  });
});
