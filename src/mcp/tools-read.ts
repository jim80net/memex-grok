import type { ScanRootRegistry, SkillIndex } from "@jim80net/memex-core";
import type { ToolHandler } from "./server.ts";
import { assertNoHostPathLeaks, scrubHostPaths } from "../core/host-path-egress.ts";
import { assertAgentReadLocation } from "./location-handle.ts";
import type { QueryResultMap } from "./query-result-map.ts";

export interface RecordMatchArgs {
  location: string;
  queryId: string;
  sessionId: string;
}

export interface ReadSkillDeps {
  index: Pick<SkillIndex, "readSkillContent" | "search">;
  registry: ScanRootRegistry;
  recordMatch: (args: RecordMatchArgs) => void | Promise<void>;
  sessionId: () => string;
  queryResults?: QueryResultMap;
}

/**
 * Creates the `memex_read_skill` MCP tool handler.
 *
 * Reads the full content of a skill, rule, or memory by portable handle.
 * When `query_id` is supplied, fires a best-effort telemetry record that
 * links this read back to the originating search query.
 */
export function makeReadSkillTool(deps: ReadSkillDeps): ToolHandler {
  return {
    name: "memex_read_skill",
    description: [
      "Read the full content of a skill, rule, or memory by `location` (portable handle returned from",
      "`memex_search`) or by `name`. If `query_id` is provided, the read is recorded as a telemetry match",
      "for the originating search — this keeps the GEPA query-refinement loop running and",
      "improves future relevance ranking. Always pass the `query_id` from the search that",
      "led you here.",
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "Portable handle from memex_search (memex://…); absolute paths are rejected.",
        },
        name: { type: "string", description: "Skill/rule/memory name from memex_search (alternative to location)." },
        query_id: { type: "string", description: "The query_id from the memex_search call that surfaced this result." },
      },
      required: [],
      additionalProperties: false,
    },
    call: async (args: Record<string, unknown>) => {
      const locationArg = typeof args.location === "string" ? args.location.trim() : "";
      const nameArg = typeof args.name === "string" ? args.name.trim() : "";
      if (!locationArg && !nameArg) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "provide location (handle from memex_search) or name" }],
        };
      }
      try {
        const queryId = typeof args.query_id === "string" ? args.query_id.trim() : "";
        const readLocation = await resolveReadTarget(deps, locationArg, nameArg, queryId);
        const content = await deps.index.readSkillContent(readLocation);
        const qid = queryId || null;
        if (qid) {
          try {
            await deps.recordMatch({ location: readLocation, queryId: qid, sessionId: deps.sessionId() });
          } catch {
            /* telemetry is best-effort */
          }
        }
        const scrubbed = scrubHostPaths(content);
        assertNoHostPathLeaks(scrubbed);
        return { content: [{ type: "text" as const, text: scrubbed }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { isError: true, content: [{ type: "text" as const, text: msg }] };
      }
    },
  };
}

async function resolveReadTarget(
  deps: ReadSkillDeps,
  locationArg: string,
  nameArg: string,
  queryId: string,
): Promise<string> {
  if (locationArg) {
    return assertAgentReadLocation(deps.registry, locationArg);
  }
  if (queryId) {
    if (!deps.queryResults) {
      throw new Error(`unknown query_id '${queryId}'`);
    }
    return assertAgentReadLocation(deps.registry, deps.queryResults.lookup(queryId, nameArg));
  }
  const hits = await deps.index.search(nameArg, 20, 0);
  const exact = hits.filter((h) => h.skill.name === nameArg);
  if (exact.length === 0) {
    throw new Error(`no indexed entry with name '${nameArg}'`);
  }
  const locations = [...new Set(exact.map((h) => h.skill.location))];
  if (locations.length > 1) {
    throw new Error(`ambiguous name '${nameArg}' (${exact.length} exact matches)`);
  }
  return assertAgentReadLocation(deps.registry, locations[0]!);
}
