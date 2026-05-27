import type { SkillIndex } from "@jim80net/memex-core";
import type { ToolHandler } from "./server.ts";

export interface RecordMatchArgs {
  location: string;
  queryId: string;
  sessionId: string;
}

export interface ReadSkillDeps {
  index: Pick<SkillIndex, "readSkillContent">;
  recordMatch: (args: RecordMatchArgs) => void | Promise<void>;
  sessionId: () => string;
}

/**
 * Creates the `memex_read_skill` MCP tool handler.
 *
 * Reads the full content of a skill, rule, or memory by location path.
 * When `query_id` is supplied, fires a best-effort telemetry record that
 * links this read back to the originating search query — keeping the GEPA
 * query-refinement loop running and improving future relevance ranking.
 */
export function makeReadSkillTool(deps: ReadSkillDeps): ToolHandler {
  return {
    name: "memex_read_skill",
    description: [
      "Read the full content of a skill, rule, or memory by `location` (path returned from",
      "`memex_search`). If `query_id` is provided, the read is recorded as a telemetry match",
      "for the originating search — this keeps the GEPA query-refinement loop running and",
      "improves future relevance ranking. Always pass the `query_id` from the search that",
      "led you here.",
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        location: { type: "string", description: "Absolute path to the skill/rule/memory file." },
        query_id: { type: "string", description: "The query_id from the memex_search call that surfaced this result." },
      },
      required: ["location"],
    },
    call: async (args: Record<string, unknown>) => {
      const location = typeof args.location === "string" ? args.location : "";
      if (!location) {
        return { isError: true, content: [{ type: "text" as const, text: "location must be a non-empty string" }] };
      }
      try {
        const content = await deps.index.readSkillContent(location);
        const qid = typeof args.query_id === "string" ? args.query_id : null;
        if (qid) {
          try { await deps.recordMatch({ location, queryId: qid, sessionId: deps.sessionId() }); }
          catch { /* telemetry is best-effort */ }
        }
        return { content: [{ type: "text" as const, text: content }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { isError: true, content: [{ type: "text" as const, text: msg }] };
      }
    },
  };
}
