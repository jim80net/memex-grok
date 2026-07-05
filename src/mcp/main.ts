import type { Readable, Writable } from "node:stream";
import { join } from "node:path";
import {
  SkillIndex,
  loadTelemetry,
  saveTelemetry,
  recordMatch as coreRecordMatch,
  withFileLock,
} from "@jim80net/memex-core";
import { loadConfig } from "../core/config.ts";
import { getGrokPaths } from "../core/paths.ts";
import { buildScanDirs } from "../core/index-init.ts";
import { CompiledLocalEmbeddingProvider } from "../core/compiled-embedding.ts";
import { runMcpServer } from "./server.ts";
import { makeMemexTools } from "./tools.ts";
import { OnceInit } from "./init.ts";
import { LocationHandleCodec } from "./location-handle.ts";

export interface RunMemexMcpOptions {
  stdin: Readable;
  stdout: Writable;
  cwd?: string;
}

/**
 * Wire config, index, telemetry, and tools into a running MCP server.
 *
 * Initialisation (index build + embedding model load) is deferred to the
 * first tools/call via OnceInit so the server responds to initialize and
 * tools/list immediately even before the index is ready.
 */
export async function runMemexMcp(opts: RunMemexMcpOptions): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const config = await loadConfig();
  const paths = getGrokPaths();
  const provider = new CompiledLocalEmbeddingProvider(config.embeddingModel, paths.modelsDir);
  const cachePath = join(paths.cacheDir, "memex-cache.json");
  const index = new SkillIndex(config, provider, cachePath);
  const scanDirs = buildScanDirs(cwd, config);
  const locations = LocationHandleCodec.forSession(cwd, config, paths);

  const init = new OnceInit(async () => {
    await index.build(scanDirs);
  });

  // Per-process session ID (no grok-supplied id in stdio MCP).
  const sessionId = `mcp-${process.pid}-${Date.now()}`;
  const lastSyncAt: string | null = null; // Plan 3 wires real sync state.

  const tools = makeMemexTools({
    config,
    index,
    locations,
    getIndexStats: () => ({
      // SkillIndex exposes .skillCount but not .all(); sourceCounts degrades to {} in Plan 1.
      size: index.skillCount,
      sourceCounts: {} as Record<string, number>,
    }),
    getLastSyncAt: () => lastSyncAt,
    recordMatch: async ({ location, queryId, sessionId: sid }) => {
      try {
        await withFileLock(paths.telemetryPath, async () => {
          const telemetry = await loadTelemetry(paths.telemetryPath);
          // For Plan 1 we approximate bestQueryIndex with 0; Plan 2 will thread
          // real index via an in-memory map keyed by queryId.
          coreRecordMatch(telemetry, location, sid, 0);
          await saveTelemetry(paths.telemetryPath, telemetry);
        });
      } catch {
        // best-effort telemetry; never let it break a tool call
      }
    },
    sessionId: () => sessionId,
  });

  // Ensure init runs on any tools/call before the handler executes.
  const wrappedTools = tools.map((t) => ({
    ...t,
    call: async (args: Record<string, unknown>) => {
      await init.ensure();
      return t.call(args);
    },
  }));

  await runMcpServer({ stdin: opts.stdin, stdout: opts.stdout, tools: wrappedTools });
}
