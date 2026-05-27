import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { runMcpServer, type ToolHandler } from "../src/mcp/server.ts";

function makeStreams() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  return { stdin, stdout };
}

async function collectFor(ms: number, stream: PassThrough): Promise<string> {
  const chunks: Buffer[] = [];
  const onData = (c: Buffer) => chunks.push(c);
  stream.on("data", onData);
  await new Promise((r) => setTimeout(r, ms));
  stream.off("data", onData);
  return Buffer.concat(chunks).toString("utf8");
}

describe("runMcpServer", () => {
  it("responds to initialize with serverInfo and capabilities", async () => {
    const { stdin, stdout } = makeStreams();
    const tools: ToolHandler[] = [];
    const done = runMcpServer({ stdin, stdout, tools });
    stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
    const out = await collectFor(50, stdout);
    stdin.end();
    await done;
    const parsed = JSON.parse(out.trim().split("\n")[0]);
    expect(parsed.id).toBe(1);
    expect(parsed.result.serverInfo.name).toBe("memex");
    expect(parsed.result.capabilities.tools).toBeDefined();
    expect(parsed.result.protocolVersion).toBeDefined();
  });

  it("responds to tools/list with all registered tools", async () => {
    const { stdin, stdout } = makeStreams();
    const tools: ToolHandler[] = [
      { name: "alpha", description: "first",  inputSchema: { type: "object" }, call: async () => ({ content: [{ type: "text", text: "ok" }] }) },
      { name: "beta",  description: "second", inputSchema: { type: "object" }, call: async () => ({ content: [{ type: "text", text: "ok" }] }) },
    ];
    const done = runMcpServer({ stdin, stdout, tools });
    stdin.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');
    const out = await collectFor(50, stdout);
    stdin.end();
    await done;
    const parsed = JSON.parse(out.trim().split("\n")[0]);
    expect(parsed.result.tools.map((t: { name: string }) => t.name)).toEqual(["alpha", "beta"]);
  });
});
