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

export interface ReadMessagesOptions {
  /** Called when a non-blank line is not valid JSON-RPC (server stays alive). */
  onParseError?: (line: string) => void;
}

function parseMessageLine(line: string): JsonRpcMessage | null {
  try {
    return JSON.parse(line) as JsonRpcMessage;
  } catch {
    return null;
  }
}

/** Yields one JsonRpcMessage per non-blank line on the given stream. */
export async function* readMessages(
  input: Readable,
  opts: ReadMessagesOptions = {},
): AsyncGenerator<JsonRpcMessage> {
  let buffer = "";
  for await (const chunk of input) {
    buffer += (chunk as Buffer).toString("utf8");
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const msg = parseMessageLine(line);
      if (msg) {
        yield msg;
      } else {
        opts.onParseError?.(line);
      }
    }
  }
  const tail = buffer.trim();
  if (tail) {
    const msg = parseMessageLine(tail);
    if (msg) {
      yield msg;
    } else {
      opts.onParseError?.(tail);
    }
  }
}

/** Writes a single JsonRpcMessage as a JSON line ending with \n. */
export function writeMessage(output: Writable, msg: JsonRpcMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    output.write(JSON.stringify(msg) + "\n", (err) => (err ? reject(err) : resolve()));
  });
}
