import { randomBytes } from "node:crypto";
import type { SkillIndex, SkillType } from "@jim80net/memex-core";
import type { ToolHandler } from "./server.ts";
import { assertNoHostPathLeaks } from "../core/host-path-egress.ts";

export interface SearchDeps {
  index: Pick<SkillIndex, "search">;
  defaultTopK: number;
  defaultThreshold: number;
}

/**
 * Creates the `memex_search` MCP tool handler.
 *
 * Searches the user's cross-harness memex corpus (skills, rules, memories) and
 * returns a `{ query_id, results }` payload. The `query_id` is a unique opaque
 * token that callers should pass to `memex_read_skill` so telemetry can
 * attribute reads back to this query.
 */
export function makeSearchTool(deps: SearchDeps): ToolHandler {
  return {
    name: "memex_search",
    description: searchDescription(),
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language query." },
        top_k: { type: "integer", minimum: 1, maximum: 20, description: "Max results (default 5)." },
        threshold: { type: "number", minimum: 0, maximum: 1, description: "Minimum cosine similarity (default 0.5)." },
        types: {
          type: "array",
          items: {
            type: "string",
            enum: ["skill", "memory", "rule", "workflow", "session-learning", "tool-guidance"],
          },
          description: "Restrict to these entry types.",
        },
      },
      required: ["query"],
    },
    call: async (args: Record<string, unknown>) => {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) {
        return { isError: true, content: [{ type: "text" as const, text: "query must be non-empty" }] };
      }

      const topK = typeof args.top_k === "number" ? args.top_k : deps.defaultTopK;
      const threshold = typeof args.threshold === "number" ? args.threshold : deps.defaultThreshold;
      const types = Array.isArray(args.types) ? (args.types as SkillType[]) : undefined;

      const hits = await deps.index.search(query, topK, threshold, types);
      const queryId = `q-${randomBytes(6).toString("hex")}`;
      const payload = {
        query_id: queryId,
        results: hits.map((h) => ({
          name: h.skill.name,
          type: h.skill.type,
          location: h.skill.location,
          relevance: h.score,
          description: h.skill.description,
          best_query_index: h.bestQueryIndex,
        })),
      };
      const text = JSON.stringify(payload, null, 2);
      assertNoHostPathLeaks(text);
      return { content: [{ type: "text" as const, text }] };
    },
  };
}

function searchDescription(): string {
  return [
    "Search the user's cross-harness memex corpus — curated skills, rules, and",
    "long-lived preferences synced via git across machines and AI coding harnesses.",
    "Use this for procedural know-how ('how do I deploy X?'), coding conventions,",
    "recurring workflows, or personal preferences likely to have been recorded",
    "across past sessions. This is different from `memory_search`, which only",
    "covers grok's per-workspace conversational memory.",
    "",
    "Returns `{ query_id, results: [...] }`. Pass `query_id` to `memex_read_skill`",
    "when fetching content so telemetry can attribute the read to this query.",
  ].join("\n");
}