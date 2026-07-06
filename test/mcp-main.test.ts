import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { PassThrough } from "node:stream";
import { PassThrough as PassThroughStream } from "node:stream";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

type JsonRpcLine = { id?: number; result?: unknown; error?: unknown };

/** Collect stdout JSON-RPC lines until `wantId` appears (or timeout). */
async function waitForRpcResponse(
  stdout: PassThrough,
  chunks: Buffer[],
  wantId: number,
  timeoutMs = 30_000,
): Promise<JsonRpcLine> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line) as JsonRpcLine;
      if (msg.id === wantId && (msg.result !== undefined || msg.error !== undefined)) {
        return msg;
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for json-rpc id=${wantId}`);
}

describe("runMemexMcp end-to-end", () => {
  let tmpHome: string;
  const originalHome = process.env.HOME;

  beforeEach(async () => {
    tmpHome = join(tmpdir(), `mg-main-${Date.now()}-${Math.random()}`);
    await mkdir(join(tmpHome, ".grok", "skills", "hello"), { recursive: true });
    await writeFile(
      join(tmpHome, ".grok", "skills", "hello", "SKILL.md"),
      "---\nname: hello\ndescription: Says hello.\nqueries:\n  - hi\n  - hello\n---\n\nHello there.\n"
    );
    process.env.HOME = tmpHome;
  });
  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tmpHome, { recursive: true, force: true });
  });

  it("loads skills, exposes tools, and serves memex_search end-to-end", async () => {
    const stdin = new PassThroughStream();
    const stdout = new PassThroughStream();
    const { runMemexMcp } = await import("../src/mcp/main.ts");
    const done = runMemexMcp({ stdin, stdout, cwd: "/work" });

    // handshake
    stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
    stdin.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');
    stdin.write('{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"memex_search","arguments":{"query":"say hi"}}}\n');

    const chunks: Buffer[] = [];
    stdout.on("data", (c) => chunks.push(c));
    await new Promise((r) => setTimeout(r, 500)); // allow embedding model to load
    stdin.end();
    await done;
    const lines = Buffer.concat(chunks).toString("utf8").trim().split("\n").map((l) => JSON.parse(l));

    expect(lines[0].result.serverInfo.name).toBe("memex");
    expect(lines[1].result.tools.map((t: { name: string }) => t.name)).toEqual(["memex_search", "memex_read_skill", "memex_status"]);
    const searchPayload = JSON.parse(lines[2].result.content[0].text);
    expect(searchPayload.query_id).toBeTruthy();
    expect(searchPayload.results.length).toBeGreaterThanOrEqual(1);
    expect(searchPayload.results[0].name).toBe("hello");
    expect(searchPayload.results[0].location).toMatch(/^memex:\/\//);
  }, 30000);

  it("search→read_skill round-trips portable handle via registry wiring", async () => {
    const stdin = new PassThroughStream();
    const stdout = new PassThroughStream();
    const { runMemexMcp } = await import("../src/mcp/main.ts");
    const done = runMemexMcp({ stdin, stdout, cwd: "/work" });

    const chunks: Buffer[] = [];
    stdout.on("data", (c) => chunks.push(c as Buffer));

    stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
    stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    stdin.write('{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"memex_search","arguments":{"query":"say hi"}}}\n');

    const searchLine = await waitForRpcResponse(stdout, chunks, 2);
    expect(searchLine.error).toBeUndefined();
    const searchResult = searchLine.result as { content: Array<{ text: string }> };
    const searchPayload = JSON.parse(searchResult.content[0].text) as {
      query_id: string;
      results: Array<{ location: string }>;
    };
    const handle = searchPayload.results[0].location;
    expect(handle).toMatch(/^memex:\/\//);

    stdin.write(
      `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"memex_read_skill","arguments":{"location":"${handle}","query_id":"${searchPayload.query_id}"}}}\n`,
    );

    const readLine = await waitForRpcResponse(stdout, chunks, 3);
    stdin.end();
    await done;

    expect(readLine.error).toBeUndefined();
    const readResult = readLine.result as { content: Array<{ text: string }> };
    expect(readResult.content[0].text).toMatch(/Hello there/);
  }, 60000);
});
