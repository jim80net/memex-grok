import { describe, it, expect } from "vitest";
import { Readable, Writable } from "node:stream";
import { readMessages, writeMessage } from "../src/mcp/framing.ts";
import type { JsonRpcMessage } from "../src/mcp/framing.ts";

function makeReadable(lines: string[]): Readable {
  return Readable.from(lines.map((l) => l + "\n"));
}

class CollectingWritable extends Writable {
  chunks: string[] = [];
  _write(chunk: Buffer, _enc: string, cb: () => void) { this.chunks.push(chunk.toString("utf8")); cb(); }
}

describe("readMessages", () => {
  it("yields one message per line", async () => {
    const input = makeReadable([
      '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
      '{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
    ]);
    const out: JsonRpcMessage[] = [];
    for await (const msg of readMessages(input)) out.push(msg);
    expect(out).toEqual([
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]);
  });

  it("skips blank lines silently", async () => {
    const input = makeReadable(['{"jsonrpc":"2.0","id":1,"method":"x"}', "", "   "]);
    const out: JsonRpcMessage[] = [];
    for await (const msg of readMessages(input)) out.push(msg);
    expect(out.length).toBe(1);
  });

  it("skips malformed JSON without throwing", async () => {
    const input = makeReadable(["{not json"]);
    const errors: string[] = [];
    const out: JsonRpcMessage[] = [];
    for await (const msg of readMessages(input, { onParseError: (l) => errors.push(l) })) {
      out.push(msg);
    }
    expect(out).toEqual([]);
    expect(errors).toEqual(["{not json"]);
  });

  it("yields valid messages after a malformed line", async () => {
    const input = makeReadable([
      "{not json",
      '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
    ]);
    const out: JsonRpcMessage[] = [];
    for await (const msg of readMessages(input)) out.push(msg);
    expect(out).toEqual([{ jsonrpc: "2.0", id: 1, method: "initialize" }]);
  });
});

describe("writeMessage", () => {
  it("writes a single JSON line terminated with \\n", async () => {
    const out = new CollectingWritable();
    await writeMessage(out, { jsonrpc: "2.0", id: 1, result: { ok: true } });
    expect(out.chunks.join("")).toBe('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n');
  });
});
