import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PassThrough } from "node:stream";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
    const stdin = new PassThrough();
    const stdout = new PassThrough();
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
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const { runMemexMcp } = await import("../src/mcp/main.ts");
    const done = runMemexMcp({ stdin, stdout, cwd: "/work" });

    stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
    stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    stdin.write('{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"memex_search","arguments":{"query":"say hi"}}}\n');

    const chunks: Buffer[] = [];
    stdout.on("data", (c) => chunks.push(c));
    await new Promise((r) => setTimeout(r, 500));
    const lines = Buffer.concat(chunks).toString("utf8").trim().split("\n").map((l) => JSON.parse(l));
    const searchPayload = JSON.parse(lines.find((l) => l.id === 2).result.content[0].text);
    const handle = searchPayload.results[0].location;

    stdin.write(
      `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"memex_read_skill","arguments":{"location":"${handle}","query_id":"${searchPayload.query_id}"}}}\n`,
    );
    await new Promise((r) => setTimeout(r, 500));
    stdin.end();
    await done;

    const allLines = Buffer.concat(chunks).toString("utf8").trim().split("\n").map((l) => JSON.parse(l));
    const readLine = allLines.find((l) => l.id === 3);
    expect(readLine?.error).toBeUndefined();
    expect(readLine?.result?.content?.[0]?.text).toMatch(/Hello there/);
  }, 60000);
});
