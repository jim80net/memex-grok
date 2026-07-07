import type { Readable, Writable } from "node:stream";

/** A JSON-RPC 2.0 message envelope. */
export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** Yields one JsonRpcMessage per non-blank line on the given stream. */
export async function* readMessages(input: Readable): AsyncGenerator<JsonRpcMessage> {
  let buffer = "";
  for await (const chunk of input) {
    buffer += (chunk as Buffer).toString("utf8");
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      yield JSON.parse(line) as JsonRpcMessage;
    }
  }
  const tail = buffer.trim();
  if (tail) yield JSON.parse(tail) as JsonRpcMessage;
}

/** Writes a single JsonRpcMessage as a JSON line ending with \n. */
export function writeMessage(output: Writable, msg: JsonRpcMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    output.write(JSON.stringify(msg) + "\n", (err) => (err ? reject(err) : resolve()));
  });
}
