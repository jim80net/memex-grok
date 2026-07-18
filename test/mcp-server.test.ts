import { describe, it, expect, vi } from "vitest";
import { PassThrough } from "node:stream";
import { runMcpServer, type ToolHandler } from "../src/mcp/server.ts";
import { makeSearchTool } from "../src/mcp/tools-search.ts";
import { makeReadSkillTool } from "../src/mcp/tools-read.ts";
import { makeStatusTool } from "../src/mcp/tools-status.ts";

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

describe("runMcpServer error envelopes", () => {
  it("returns -32601 for unknown tool", async () => {
    const { stdin, stdout } = makeStreams();
    const done = runMcpServer({ stdin, stdout, tools: [] });
    stdin.write('{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"nope","arguments":{}}}\n');
    const out = await collectFor(50, stdout);
    stdin.end();
    await done;
    const parsed = JSON.parse(out.trim().split("\n")[0]);
    expect(parsed.error.code).toBe(-32601);
    expect(parsed.error.message).toContain("nope");
  });

  it("survives a malformed stdin line and still answers the next valid request", async () => {
    const { stdin, stdout } = makeStreams();
    const done = runMcpServer({ stdin, stdout, tools: [] });
    stdin.write("{not json\n");
    stdin.write('{"jsonrpc":"2.0","id":9,"method":"initialize","params":{}}\n');
    const out = await collectFor(50, stdout);
    stdin.end();
    await done;
    const parsed = JSON.parse(out.trim().split("\n")[0]);
    expect(parsed.id).toBe(9);
    expect(parsed.result.serverInfo.name).toBe("memex");
  });

  it("returns -32603 when a tool handler throws", async () => {
    const { stdin, stdout } = makeStreams();
    const tools: ToolHandler[] = [{
      name: "boom",
      description: "throws",
      inputSchema: { type: "object" },
      call: async () => { throw new Error("kaboom"); },
    }];
    const done = runMcpServer({ stdin, stdout, tools });
    stdin.write('{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"boom","arguments":{}}}\n');
    const out = await collectFor(50, stdout);
    stdin.end();
    await done;
    const parsed = JSON.parse(out.trim().split("\n")[0]);
    expect(parsed.error.code).toBe(-32603);
    expect(parsed.error.message).toBe("kaboom");
  });

  it("returns -32601 for an unknown method", async () => {
    const { stdin, stdout } = makeStreams();
    const done = runMcpServer({ stdin, stdout, tools: [] });
    stdin.write('{"jsonrpc":"2.0","id":5,"method":"resources/list"}\n');
    const out = await collectFor(50, stdout);
    stdin.end();
    await done;
    const parsed = JSON.parse(out.trim().split("\n")[0]);
    expect(parsed.error).toEqual({ code: -32601, message: "unknown method: resources/list" });
  });

  it.each([
    ["non-object params", [], "tools/call params must be an object"],
    ["missing name", {}, "tools/call name must be a non-empty string"],
    ["wrong-type name", { name: 42 }, "tools/call name must be a non-empty string"],
  ])("returns -32602 for malformed tools/call %s", async (_label, params, message) => {
    const { stdin, stdout } = makeStreams();
    const done = runMcpServer({ stdin, stdout, tools: [] });
    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 6, method: "tools/call", params })}\n`);
    const out = await collectFor(50, stdout);
    stdin.end();
    await done;
    const parsed = JSON.parse(out.trim().split("\n")[0]);
    expect(parsed.error).toEqual({ code: -32602, message });
  });
});

describe("tools/call schema enforcement", () => {
  function contractTools() {
    const search = makeSearchTool({} as never);
    const read = makeReadSkillTool({} as never);
    const status = makeStatusTool({} as never);
    const calls = {
      search: vi.fn(async () => ({ content: [{ type: "text" as const, text: "search-ok" }] })),
      read: vi.fn(async () => ({ content: [{ type: "text" as const, text: "read-ok" }] })),
      status: vi.fn(async () => ({ content: [{ type: "text" as const, text: "status-ok" }] })),
    };
    return {
      calls,
      tools: [
        { ...search, call: calls.search },
        { ...read, call: calls.read },
        { ...status, call: calls.status },
      ],
    };
  }

  it("publishes closed input schemas for search, read, and status", () => {
    const { tools } = contractTools();
    expect(tools.map((tool) => [tool.name, tool.inputSchema.additionalProperties])).toEqual([
      ["memex_search", false],
      ["memex_read_skill", false],
      ["memex_status", false],
    ]);
  });

  it("rejects invalid search/status/read arguments before handlers execute", async () => {
    const { stdin, stdout } = makeStreams();
    const { tools, calls } = contractTools();
    const done = runMcpServer({ stdin, stdout, tools });
    const cases: Array<{ name: string; arguments?: unknown; error: string }> = [
      { name: "memex_search", arguments: {}, error: "arguments.query is required" },
      { name: "memex_search", arguments: { query: 7 }, error: "arguments.query must be a string" },
      { name: "memex_search", arguments: { query: "x", top_k: 0 }, error: "arguments.top_k must be >= 1" },
      { name: "memex_search", arguments: { query: "x", top_k: 21 }, error: "arguments.top_k must be <= 20" },
      { name: "memex_search", arguments: { query: "x", top_k: 1.5 }, error: "arguments.top_k must be an integer" },
      { name: "memex_search", arguments: { query: "x", threshold: -1 }, error: "arguments.threshold must be >= 0" },
      { name: "memex_search", arguments: { query: "x", threshold: 2 }, error: "arguments.threshold must be <= 1" },
      { name: "memex_search", arguments: { query: "x", types: "rule" }, error: "arguments.types must be an array" },
      {
        name: "memex_search",
        arguments: { query: "x", types: ["invalid"] },
        error: "arguments.types[0] must be one of: 'skill', 'memory', 'rule', 'workflow', 'session-learning', 'tool-guidance'",
      },
      { name: "memex_search", arguments: { query: "x", extra: true }, error: "arguments.extra is not allowed" },
      { name: "memex_status", arguments: { extra: true }, error: "arguments.extra is not allowed" },
      {
        name: "memex_read_skill",
        arguments: { name: "x", query_id: 4 },
        error: "arguments.query_id must be a string",
      },
      { name: "memex_read_skill", arguments: { name: "x", extra: true }, error: "arguments.extra is not allowed" },
      { name: "memex_search", arguments: null, error: "arguments must be an object" },
      { name: "memex_status", arguments: [], error: "arguments must be an object" },
    ];
    const chunks: Buffer[] = [];
    stdout.on("data", (chunk) => chunks.push(chunk as Buffer));
    cases.forEach((testCase, index) => {
      const params = { name: testCase.name, arguments: testCase.arguments };
      stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: index + 1, method: "tools/call", params })}\n`);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    stdin.end();
    await done;

    const responses = Buffer.concat(chunks).toString("utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(responses).toHaveLength(cases.length);
    responses.forEach((response, index) => {
      expect(response.result.isError).toBe(true);
      expect(response.result.content).toEqual([{ type: "text", text: cases[index].error }]);
    });
    expect(calls.search).not.toHaveBeenCalled();
    expect(calls.read).not.toHaveBeenCalled();
    expect(calls.status).not.toHaveBeenCalled();
  });

  it("executes handlers for schema-valid search/status/read arguments", async () => {
    const { stdin, stdout } = makeStreams();
    const { tools, calls } = contractTools();
    const done = runMcpServer({ stdin, stdout, tools });
    const requests = [
      { name: "memex_search", arguments: { query: "x", top_k: 1, threshold: 0, types: ["rule"] } },
      { name: "memex_status", arguments: {} },
      { name: "memex_read_skill", arguments: { location: "memex://rules/x.md", query_id: "q-1" } },
    ];
    const chunks: Buffer[] = [];
    stdout.on("data", (chunk) => chunks.push(chunk as Buffer));
    requests.forEach((params, index) => {
      stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: index + 1, method: "tools/call", params })}\n`);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    stdin.end();
    await done;

    const responses = Buffer.concat(chunks).toString("utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(responses.map((response) => response.result.content[0].text)).toEqual(["search-ok", "status-ok", "read-ok"]);
    expect(calls.search).toHaveBeenCalledWith(requests[0].arguments);
    expect(calls.status).toHaveBeenCalledWith(requests[1].arguments);
    expect(calls.read).toHaveBeenCalledWith(requests[2].arguments);
  });
});
