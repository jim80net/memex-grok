import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { collectDoctorReport, type DoctorReport } from "./doctor.ts";
import { assertNoHostPathLeaks, scrubHostPaths } from "../core/host-path-egress.ts";

const MCP_TIMEOUT_MS = 120_000;
const SEARCH_QUERY = "standard development flow";
const TRAVERSAL_HANDLE = "memex://grok-global/../../etc/shadow";

export type SelfcheckStepName =
  | "doctor"
  | "search"
  | "read_skill"
  | "security"
  | "path-egress";

export interface SelfcheckStep {
  name: SelfcheckStepName;
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface SelfcheckReport {
  ok: boolean;
  steps: SelfcheckStep[];
}

export interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface SelfcheckMcpClient {
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
  close(): Promise<void>;
}

export interface SelfcheckDeps {
  doctor: () => Promise<DoctorReport>;
  openMcp: () => Promise<SelfcheckMcpClient>;
}

export interface SelfMcpCommand {
  command: string;
  args: string[];
}

export interface SelfcheckOutput {
  write(chunk: string): unknown;
}

const defaultDeps: SelfcheckDeps = {
  doctor: collectDoctorReport,
  openMcp: openSelfMcpClient,
};

/** Open this exact source or installed entrypoint as its own stdio MCP server. */
export async function openSelfMcpClient(): Promise<SelfcheckMcpClient> {
  return StdioMcpClient.open(resolveSelfMcpCommand());
}

export async function performSelfcheck(
  deps: SelfcheckDeps = defaultDeps,
): Promise<SelfcheckReport> {
  const steps: SelfcheckStep[] = [];
  const toolOutputs: string[] = [];
  let client: SelfcheckMcpClient | null = null;
  let searchPayload: SearchPayload | null = null;

  try {
    const doctor = await deps.doctor();
    const failures = doctor.checks.filter((check) => check.severity === "FAIL");
    steps.push({
      name: "doctor",
      ok: doctor.ok,
      message: doctor.ok
        ? `${doctor.checks.length} checks completed; no failures`
        : `${failures.length} check(s) failed: ${failures.map((check) => check.name).join(", ")}`,
      details: {
        checks: doctor.checks,
      },
    });
  } catch (error) {
    steps.push(failedStep("doctor", error));
  }

  try {
    client = await deps.openMcp();
  } catch (error) {
    const reason = errorMessage(error);
    steps.push({ name: "search", ok: false, message: `MCP server did not start: ${reason}` });
    steps.push({ name: "read_skill", ok: false, message: "not run because MCP server did not start" });
    steps.push({ name: "security", ok: false, message: "not run because MCP server did not start" });
    steps.push({ name: "path-egress", ok: false, message: "not verified because MCP server did not start" });
    return makeReport(steps);
  }

  try {
    const search = await client.callTool("memex_search", {
      query: SEARCH_QUERY,
      threshold: 0,
    });
    toolOutputs.push(toolText(search));
    if (search.isError) throw new Error(`memex_search rejected the probe: ${toolText(search)}`);
    searchPayload = parseSearchPayload(toolText(search));
    const top = searchPayload.results[0];
    steps.push({
      name: "search",
      ok: true,
      message: `${searchPayload.results.length} hit(s) at threshold 0; top hit ${top.name ?? "unnamed"}`,
      details: {
        threshold: 0,
        hits: searchPayload.results.length,
        top_hit: top.name ?? null,
      },
    });
  } catch (error) {
    steps.push(failedStep("search", error));
  }

  if (searchPayload) {
    try {
      const top = searchPayload.results[0];
      const read = await client.callTool("memex_read_skill", {
        location: top.location,
        query_id: searchPayload.query_id,
      });
      const content = toolText(read);
      toolOutputs.push(content);
      if (read.isError) throw new Error(`memex_read_skill rejected the top hit: ${content}`);
      if (content.length <= 100) {
        throw new Error(`top-hit content is ${content.length} characters; expected more than 100`);
      }
      steps.push({
        name: "read_skill",
        ok: true,
        message: `top-hit round-trip returned ${content.length} characters`,
        details: { content_length: content.length },
      });
    } catch (error) {
      steps.push(failedStep("read_skill", error));
    }
  } else {
    steps.push({
      name: "read_skill",
      ok: false,
      message: "not run because search did not return a usable hit",
    });
  }

  try {
    const absolute = await client.callTool("memex_read_skill", { location: "/etc/shadow" });
    const traversal = await client.callTool("memex_read_skill", { location: TRAVERSAL_HANDLE });
    toolOutputs.push(toolText(absolute), toolText(traversal));
    const rejected = { absolute: absolute.isError === true, traversal: traversal.isError === true };
    if (!rejected.absolute || !rejected.traversal) {
      const accepted = [
        !rejected.absolute ? "absolute path" : null,
        !rejected.traversal ? "traversal handle" : null,
      ].filter(Boolean);
      throw new Error(`security probe accepted ${accepted.join(" and ")}`);
    }
    steps.push({
      name: "security",
      ok: true,
      message: "absolute /etc/shadow path and traversal handle both rejected",
      details: { absolute_rejected: true, traversal_rejected: true },
    });
  } catch (error) {
    steps.push(failedStep("security", error));
  }

  try {
    if (toolOutputs.length === 0) throw new Error("no MCP tool output was available to inspect");
    for (const output of toolOutputs) assertNoHostPathLeaks(output);
    steps.push({
      name: "path-egress",
      ok: true,
      message: `${toolOutputs.length} MCP tool output(s) contain no host home path`,
      details: { outputs_checked: toolOutputs.length },
    });
  } catch (error) {
    steps.push(failedStep("path-egress", error));
  } finally {
    await client.close();
  }

  return makeReport(steps);
}

export async function runSelfcheck(
  args: string[],
  deps: SelfcheckDeps = defaultDeps,
  stdout: SelfcheckOutput = process.stdout,
): Promise<number> {
  const json = args.includes("--json");
  const report = await performSelfcheck(deps);
  if (json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    for (const step of report.steps) {
      stdout.write(`${step.ok ? "OK" : "FAIL"}: ${step.name} — ${step.message}\n`);
    }
  }
  return report.ok ? 0 : 1;
}

export function resolveSelfMcpCommand(
  runtime: Pick<NodeJS.Process, "execPath" | "execArgv" | "argv"> = process,
): SelfMcpCommand {
  const entry = runtime.argv[1];
  if (entry?.endsWith(".ts")) {
    return {
      command: runtime.execPath,
      args: [...runtime.execArgv, entry, "mcp"],
    };
  }
  return { command: runtime.execPath, args: ["mcp"] };
}

interface SearchPayload {
  query_id: string;
  results: Array<{ name?: string; location: string }>;
}

function parseSearchPayload(text: string): SearchPayload {
  const parsed = JSON.parse(text) as Partial<SearchPayload>;
  if (typeof parsed.query_id !== "string") throw new Error("memex_search returned no query_id");
  if (!Array.isArray(parsed.results) || parsed.results.length === 0) {
    throw new Error("memex_search returned zero hits at threshold 0");
  }
  const top = parsed.results[0];
  if (!top || typeof top.location !== "string" || top.location.length === 0) {
    throw new Error("memex_search top hit returned no readable portable handle");
  }
  return {
    query_id: parsed.query_id,
    results: parsed.results as Array<{ name?: string; location: string }>,
  };
}

function toolText(result: McpToolResult): string {
  return result.content.map((part) => part.text).join("\n");
}

function failedStep(name: SelfcheckStepName, error: unknown): SelfcheckStep {
  return { name, ok: false, message: errorMessage(error) };
}

function errorMessage(error: unknown): string {
  return scrubHostPaths(error instanceof Error ? error.message : String(error));
}

function makeReport(steps: SelfcheckStep[]): SelfcheckReport {
  return { ok: steps.length === 5 && steps.every((step) => step.ok), steps };
}

interface JsonRpcEnvelope {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

class StdioMcpClient implements SelfcheckMcpClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private stdoutBuffer = "";
  private stderr = "";
  private closed = false;
  private readonly pending = new Map<
    number,
    {
      resolve: (message: JsonRpcEnvelope) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  private constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => this.onStdout(chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => this.failAll(error));
    child.on("exit", (code, signal) => {
      this.closed = true;
      if (this.pending.size > 0) {
        this.failAll(
          new Error(
            `MCP server exited before replying (code=${String(code)}, signal=${String(signal)}): ${this.stderr.trim()}`,
          ),
        );
      }
    });
  }

  static async open(command: SelfMcpCommand): Promise<StdioMcpClient> {
    const child = spawn(command.command, command.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    const client = new StdioMcpClient(child);
    try {
      const initialized = await client.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "memex-selfcheck", version: "1" },
      });
      if (initialized.error) {
        throw new Error(`MCP initialize failed: ${initialized.error.message}`);
      }
      client.notify("notifications/initialized");
      return client;
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const response = await this.request("tools/call", { name, arguments: args });
    if (response.error) throw new Error(`${name} JSON-RPC error: ${response.error.message}`);
    const result = response.result as Partial<McpToolResult> | undefined;
    if (!result || !Array.isArray(result.content)) {
      throw new Error(`${name} returned a malformed tool result`);
    }
    return result as McpToolResult;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.child.stdin.end();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (!this.closed) this.child.kill("SIGKILL");
        resolve();
      }, 1_000);
      timer.unref();
      this.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private request(method: string, params: Record<string, unknown>): Promise<JsonRpcEnvelope> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${MCP_TIMEOUT_MS}ms: ${this.stderr.trim()}`));
      }, MCP_TIMEOUT_MS);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  private notify(method: string): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newline: number;
    while ((newline = this.stdoutBuffer.indexOf("\n")) >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      let message: JsonRpcEnvelope;
      try {
        message = JSON.parse(line) as JsonRpcEnvelope;
      } catch {
        this.failAll(new Error(`MCP server emitted malformed JSON: ${line.slice(0, 200)}`));
        continue;
      }
      if (typeof message.id !== "number") continue;
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      pending.resolve(message);
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
