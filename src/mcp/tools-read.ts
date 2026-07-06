import type { ScanRootRegistry, SkillIndex } from "@jim80net/memex-core";
import type { ToolHandler } from "./server.ts";
import { assertAgentReadLocation } from "./location-handle.ts";

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
        const readLocation = await resolveReadTarget(deps, locationArg, nameArg);
        const content = await deps.index.readSkillContent(readLocation);
        const qid = typeof args.query_id === "string" ? args.query_id : null;
        if (qid) {
          try {
            await deps.recordMatch({ location: readLocation, queryId: qid, sessionId: deps.sessionId() });
          } catch {
            /* telemetry is best-effort */
          }
        }
        return { content: [{ type: "text" as const, text: content }] };
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
): Promise<string> {
  if (locationArg) {
    return assertAgentReadLocation(deps.registry, locationArg);
  }
  const hits = await deps.index.search(nameArg, 20, 0);
  const exact = hits.find((h) => h.skill.name === nameArg);
  if (!exact) {
    throw new Error(`no indexed entry with name '${nameArg}'`);
  }
  return assertAgentReadLocation(deps.registry, exact.skill.location);
}