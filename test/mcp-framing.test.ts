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

  it("throws on malformed JSON", async () => {
    const input = makeReadable(["{not json"]);
    let err: unknown;
    try {
      for await (const _msg of readMessages(input)) { /* unused */ }
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(Error);
  });
});

describe("writeMessage", () => {
  it("writes a single JSON line terminated with \\n", async () => {
    const out = new CollectingWritable();
    await writeMessage(out, { jsonrpc: "2.0", id: 1, result: { ok: true } });
    expect(out.chunks.join("")).toBe('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n');
  });
});
