import type { Readable, Writable } from "node:stream";
import { readMessages, writeMessage, type JsonRpcMessage } from "./framing.ts";
import { isRecord, validateSchemaValue, type JsonSchema } from "./schema-validation.ts";

export interface ToolHandler {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  call: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>;
}

export interface McpServerOptions {
  stdin: Readable;
  stdout: Writable;
  tools: ToolHandler[];
  onError?: (msg: string) => void;
}

const PROTOCOL_VERSION = "2024-11-05";

export async function runMcpServer(opts: McpServerOptions): Promise<void> {
  const { stdin, stdout, tools, onError } = opts;
  const log = onError ?? ((m: string) => process.stderr.write(`memex-mcp: ${m}\n`));
  const byName = new Map(tools.map((t) => [t.name, t]));

  for await (const msg of readMessages(stdin, {
    onParseError: (line) => log(`skipping malformed JSON-RPC line: ${line.slice(0, 120)}`),
  })) {
    try {
      await dispatch(msg);
    } catch (e) {
      log(`dispatch error: ${e instanceof Error ? e.message : String(e)}`);
      if (msg.id != null) {
        await writeMessage(stdout, {
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32603, message: e instanceof Error ? e.message : String(e) },
        });
      }
    }
  }

  async function dispatch(msg: JsonRpcMessage): Promise<void> {
    if (msg.method === "initialize") {
      await reply(msg.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "memex", version: process.env.MEMEX_GROK_VERSION ?? "0.0.0" },
      });
    } else if (msg.method === "notifications/initialized") {
      // no response
    } else if (msg.method === "tools/list") {
      await reply(msg.id, {
        tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      });
    } else if (msg.method === "tools/call") {
      if (!isRecord(msg.params)) {
        await replyError(msg.id, -32602, "tools/call params must be an object");
        return;
      }
      const params = msg.params;
      if (typeof params.name !== "string" || !params.name) {
        await replyError(msg.id, -32602, "tools/call name must be a non-empty string");
        return;
      }
      const tool = byName.get(params.name);
      if (!tool) {
        await replyError(msg.id, -32601, `unknown tool: ${params.name}`);
        return;
      }
      const args = Object.hasOwn(params, "arguments") ? params.arguments : {};
      const validationError = validateSchemaValue(tool.inputSchema, args);
      if (validationError) {
        await reply(msg.id, {
          isError: true,
          content: [{ type: "text", text: validationError }],
        });
        return;
      }
      const result = await tool.call(args as Record<string, unknown>);
      await reply(msg.id, result);
    } else if (msg.method !== undefined) {
      await replyError(msg.id, -32601, `unknown method: ${msg.method}`);
    }
  }

  async function reply(id: JsonRpcMessage["id"], result: unknown): Promise<void> {
    if (id == null) return;
    await writeMessage(stdout, { jsonrpc: "2.0", id, result });
  }

  async function replyError(id: JsonRpcMessage["id"], code: number, message: string): Promise<void> {
    if (id == null) return;
    await writeMessage(stdout, { jsonrpc: "2.0", id, error: { code, message } });
  }
}
