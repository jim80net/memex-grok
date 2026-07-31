#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { loadConfig, type WalkConfig } from "./config.ts";
import { CLI_STATIONS, SCHEMA_CASES } from "./station-spec.ts";

const config = loadConfig();
const capturedAt = new Date().toISOString();
const cwdByKind = {
  registered: config.registeredCwd,
  source: config.wrongCwd,
  older: config.olderSource,
};

const releaseTruth = {
  captured_at: capturedAt,
  installed_version: capture([config.binary, "--version"], config.registeredCwd),
  installed_stamp: readFileSync(config.stamp, "utf8").trim(),
  installed_hashes: Object.fromEntries(
    [config.binary, `${config.binary}.bin`, join(dirname(config.binary), "libonnxruntime.so.1"), config.stamp]
      .map((path) => [path, sha256(readFileSync(path))]),
  ),
  origin_main: capture(["git", "ls-remote", "origin", "refs/heads/main"], config.source),
  harness_source_head: capture(["git", "rev-parse", "HEAD"], config.source),
  harness_source_status: capture(["git", "status", "--short", "--untracked-files=no"], config.source),
  deployment_performed: false,
};

const cliCaptures = CLI_STATIONS.map((station) => {
  const command = station.argv.map(expand);
  const cwd = cwdByKind[station.cwd];
  const result = capture(command, cwd);
  return {
    label: station.label,
    command,
    cwd,
    mutation_suppressed: true,
    ...result,
    expected_exit_code: station.expectedExit,
    exit_contract_matches: Array.isArray(station.expectedExit)
      ? station.expectedExit.includes(result.exit_code ?? -1)
      : result.exit_code === station.expectedExit,
  };
});

const cliPayload = {
  captured_at: capturedAt,
  nonce: config.nonce,
  installed_binary: config.binary,
  environment: { LD_LIBRARY_PATH: "unset", deployment_performed: false },
  release_truth: releaseTruth,
  captures: cliCaptures,
  station_count: cliCaptures.length,
};
writeJson("01-live-cli-stations.json", cliPayload);
writeFileSync(join(config.out, "raw-cli-transcript.txt"), cliCaptures.map(formatCliStation).join("\n"));

const mcpPayload = await runMcp(config);
writeJson("02-live-mcp-transcript.json", mcpPayload);
writeJson("capture-summary.json", {
  nonce: config.nonce,
  cli_stations: cliCaptures.length,
  cli_exit_mismatches: cliCaptures.filter((station) => !station.exit_contract_matches).map((station) => station.label),
  mcp_stations: mcpPayload.transcript.length,
  populated_searches: mcpPayload.populated_searches.length,
  unique_populated_hits: mcpPayload.unique_populated_hits,
  round_trip_reads: mcpPayload.round_trip_reads.length,
  installed_version: releaseTruth.installed_version.stdout.trim(),
  harness_commit: config.harnessCommit,
});

async function runMcp(walk: WalkConfig) {
  const env = { ...process.env };
  delete env.LD_LIBRARY_PATH;
  const child = spawn(walk.binary, ["mcp"], {
    cwd: walk.registeredCwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const rawClientChunks: string[] = [];
  const rawServerStdoutLines: string[] = [];
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  const transcript: Record<string, unknown>[] = [];
  let stdoutBuffer = "";
  let stderr = "";
  let nextId = 1;

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    while (stdoutBuffer.includes("\n")) {
      const newline = stdoutBuffer.indexOf("\n");
      const line = stdoutBuffer.slice(0, newline);
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      rawServerStdoutLines.push(line);
      try {
        const parsed = JSON.parse(line) as { id?: number };
        if (parsed.id !== undefined) {
          const waiter = pending.get(parsed.id);
          if (waiter) {
            clearTimeout(waiter.timer);
            waiter.resolve(parsed);
            pending.delete(parsed.id);
          }
        }
      } catch { /* malformed server diagnostics remain captured */ }
    }
  });
  child.on("error", (error) => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  });

  const sendChunk = (chunk: string) => { rawClientChunks.push(chunk); child.stdin.write(chunk); };
  const waitFor = (id: number) => new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timed out waiting for JSON-RPC id ${id}`));
    }, 30_000);
    pending.set(id, { resolve, reject, timer });
  });
  const request = async (label: string, method: string, params: unknown) => {
    const id = nextId++;
    const responsePromise = waitFor(id);
    sendChunk(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    const response = await responsePromise;
    const entry: Record<string, unknown> = { label, method, params, response };
    if (method === "tools/call") {
      const call = params as { name?: string; arguments?: unknown } | undefined;
      entry.tool = call?.name;
      entry.arguments = call?.arguments;
    }
    transcript.push(entry);
    return entry;
  };

  sendChunk("{not json\n");
  const initializeId = nextId++;
  const initializePromise = waitFor(initializeId);
  const initialize = JSON.stringify({ jsonrpc: "2.0", id: initializeId, method: "initialize", params: {} });
  const splitAt = Math.floor(initialize.length / 2);
  sendChunk(initialize.slice(0, splitAt));
  await delay(25);
  sendChunk(`${initialize.slice(splitAt)}\n`);
  const initializeResponse = await initializePromise;
  transcript.push({ label: "initialize_after_malformed_and_split_stdin", method: "initialize", params: {}, response: initializeResponse });
  sendChunk(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);

  const toolsList = await request("tools_list", "tools/list", {});
  const unknownMethod = await request("unknown_method", "resources/list", {});
  await request("status_populated", "tools/call", { name: "memex_status", arguments: {} });

  const populatedSpecs = [
    ["search_default_omitted_top_k", { query: "standard development flow", threshold: 0 }],
    ["search_standard_flow", { query: "standard development flow", threshold: 0, top_k: 5 }],
    ["search_merge_policy", { query: "merge pull request policy", threshold: 0, top_k: 5 }],
    ["search_rules_only", { query: "verify before acting", threshold: 0, top_k: 3, types: ["rule"] }],
  ] as const;
  const populatedSearches: Array<{ label: string; query_id: string; results: Array<{ name: string; location: string }> }> = [];
  for (const [label, args] of populatedSpecs) {
    const entry = await request(label, "tools/call", { name: "memex_search", arguments: args });
    const payload = parseToolText(entry.response) as { query_id: string; results: Array<{ name: string; location: string }> };
    populatedSearches.push({ label, query_id: payload.query_id, results: payload.results });
  }
  await request("search_nonsense_empty", "tools/call", {
    name: "memex_search", arguments: { query: `zzqv_no_memex_hit_${walk.nonce}`, threshold: 1 },
  });
  for (const [label, tool, args] of SCHEMA_CASES) {
    await request(label, "tools/call", { name: tool, arguments: args });
  }
  await request("read_missing_arguments", "tools/call", { name: "memex_read_skill" });
  await request("read_unknown_name", "tools/call", { name: "memex_read_skill", arguments: { name: `zzqv-no-entry-${walk.nonce}` } });
  await request("read_malformed_handle", "tools/call", { name: "memex_read_skill", arguments: { location: "not-a-memex-handle" } });
  await request("security_absolute_shadow", "tools/call", { name: "memex_read_skill", arguments: { location: "/etc/shadow" } });
  await request("security_traversal_handle", "tools/call", { name: "memex_read_skill", arguments: { location: "memex://grok-global/../../etc/shadow" } });
  await request("unknown_tool", "tools/call", { name: "definitely_not_a_tool", arguments: {} });

  const roundTripReads = [];
  for (const search of populatedSearches) {
    for (const [index, result] of search.results.entries()) {
      const ordinal = index + 1;
      const handle = await request(`read_${search.label}_${ordinal}_handle`, "tools/call", {
        name: "memex_read_skill", arguments: { location: result.location, query_id: search.query_id },
      });
      const name = await request(`read_${search.label}_${ordinal}_name`, "tools/call", {
        name: "memex_read_skill", arguments: { name: result.name, query_id: search.query_id },
      });
      const handleText = toolText(handle.response);
      const nameText = toolText(name.response);
      roundTripReads.push({
        search: search.label, ordinal, name: result.name, location: result.location,
        query_id: search.query_id, handle_content_length: handleText.length,
        name_content_length: nameText.length, content_equal: handleText === nameText,
        handle_sha256: sha256(handleText), name_sha256: sha256(nameText),
      });
    }
  }

  child.stdin.end();
  const serverExitCode = await new Promise<number | null>((resolve) => child.on("close", resolve));
  const uniqueHits = new Set(populatedSearches.flatMap((search) => search.results.map((result) => result.location)));
  return {
    captured_at: new Date().toISOString(), nonce: walk.nonce, installed_binary: walk.binary,
    initialize_response: initializeResponse,
    tools_list_response: (toolsList as { response: unknown }).response,
    unknown_method_response: (unknownMethod as { response: unknown }).response,
    transcript, populated_searches: populatedSearches, round_trip_reads: roundTripReads,
    unique_populated_hits: uniqueHits.size, raw_client_chunks: rawClientChunks,
    raw_server_stdout_lines: rawServerStdoutLines, server_exit_code: serverExitCode,
    server_stderr: stderr, station_count: transcript.length,
  };
}

function expand(value: string): string {
  return value.replaceAll("$BINARY", config.binary)
    .replaceAll("$REGISTERED", config.registeredCwd)
    .replaceAll("$HOME", homedir())
    .replaceAll("$NONCE", config.nonce.replaceAll(/[^A-Za-z0-9]/g, "_"));
}

function capture(command: string[], cwd: string) {
  const started = Date.now();
  const env = { ...process.env };
  delete env.LD_LIBRARY_PATH;
  const result = spawnSync(command[0], command.slice(1), {
    cwd, env, encoding: "utf8", timeout: 60_000, maxBuffer: 32 * 1024 * 1024,
  });
  return { exit_code: result.status, signal: result.signal, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error?.message ?? null, duration_ms: Date.now() - started };
}

function toolText(response: unknown): string {
  const payload = response as { result?: { content?: Array<{ type?: string; text?: string }> } };
  return payload?.result?.content?.find((item) => item.type === "text")?.text ?? "";
}
function parseToolText(response: unknown): unknown { return JSON.parse(toolText(response)); }
function sha256(value: string | NodeJS.ArrayBufferView): string { return createHash("sha256").update(value).digest("hex"); }
function writeJson(name: string, value: unknown): void { writeFileSync(join(config.out, name), `${JSON.stringify(value, null, 2)}\n`); }
function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function formatCliStation(station: Record<string, unknown>): string {
  return [`===== ${station.label} =====`, `cwd: ${station.cwd}`, `argv: ${JSON.stringify(station.command)}`, `exit: ${station.exit_code}`, "--- stdout ---", station.stdout, "--- stderr ---", station.stderr, ""].join("\n");
}
