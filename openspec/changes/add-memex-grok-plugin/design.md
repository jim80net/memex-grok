# Design

The authoritative design lives in [`docs/superpowers/specs/2026-05-25-memex-grok-design.md`](../../../docs/superpowers/specs/2026-05-25-memex-grok-design.md). That document captures: live probe findings against grok 0.1.219, the MCP-first architecture, the wire-format adapter, dormant-hook future-readiness machinery, sync repo migration policy, coexistence guard, and the five implementation prerequisites.

This file calls out only the design-level decisions that materially shape the spec deltas in this change, with cross-references.

## Decisions

### D1. MCP server is the primary entry point, not the hook

Empirically established via probe: grok ignores `additionalContext` from hook stdout and plugin-sourced hooks did not fire in headless mode. The MCP server is the only path we can rely on today, so first-call initialization (sync-pull + index-rebuild) happens inside the server, not the SessionStart hook. The hook stays wired as a best-effort warm-up — if it fires, the user gets faster first-search latency; if it doesn't, nothing breaks.

**Affects**: `mcp-server` spec — see "First-call initialization" requirement.

### D2. Telemetry recorded implicitly inside `memex_read_skill`

The original design exposed `memex_record_match` as a separate tool the model would call after using a result. Models do not reliably make courtesy tool calls — they finish reasoning and respond. Telemetry is instead recorded inside `memex_read_skill` using a `query_id` returned by `memex_search` and threaded through. This keeps the GEPA-style query-refinement loop intact without depending on model discipline.

**Affects**: `mcp-server` spec — see "Tool surface" and "Telemetry threading" requirements.

### D3. Dormant hooks use a pluggable serializer interface

The original design said "the day grok ships `additionalContext`, flip a flag — zero code changes." This was over-confident: grok already diverges from Claude on hook input (snake_case enum values), so it may diverge on output format too. The corrected design has a `wireFormat` config option that selects a serializer from `src/hooks/injection-serializers.ts`. Adding grok's eventual format becomes a 10-20 line serializer addition, not a refactor. The match-computation code path is fully reused.

**Affects**: `hook-runtime` spec — see "Injection serializers" and "Dormancy" requirements.

### D4. Coexistence guard lives in memex-claude, not memex-grok

memex-claude is loaded by grok via `~/.claude/plugins/` for Claude-compat (verified in probe). With both installed, hooks would double-fire. The cleanest resolution is a one-line guard in memex-claude that detects `GROK_HOOK_EVENT` and exits 0. memex-grok takes no reciprocal action because running memex-grok on Claude Code is unsupported (the inverse env var would need to be set).

**Affects**: `cross-harness-integration` spec — see "Coexistence guard" requirement.

### D5. Read-only-sync mode until canonical-id migration is done

memex-claude derives sync-repo project IDs from `encodeProjectPath(cwd)`. grok derives workspace IDs from `<slug>-<hash8>` of the git remote URL. These differ for the same project, so a naive port would silently fragment the corpus. Until `canonicalProjectId()` ships in memex-core and memex-claude completes its project-id migration, memex-grok writes only to grok-local paths. Reads from the sync repo are best-effort with a case-insensitive probe falling back to legacy IDs.

**Affects**: `cross-harness-integration` spec — see "Read-only-sync mode" requirement.

### D6. Sync repo path safety prevents silent divide

memex-claude uses `~/.local/share/memex-claude/`. memex-grok prefers `~/.local/share/memex/`. If a user installs memex-grok before updating memex-claude, divergent writes accumulate in two unmerged repos. memex-grok mitigates by refusing to create the new path while the old one exists and is non-empty — it points its sync at the old path and logs a one-line migration suggestion. `memex doctor --migrate-repo` performs the rename interactively and leaves a symlink at the old path for backward compatibility.

**Affects**: `cross-harness-integration` spec — see "Sync repo path policy" and "Migration command" requirements.

### D7. Bin stub instead of post-install script

memex-claude has wrestled with cross-platform install-script issues. memex-grok ships a tiny POSIX shell stub at `bin/memex` (and `bin/memex.cmd` for Windows) that downloads + sha256-verifies the platform binary on first invocation and caches it under `~/.cache/memex-grok/<version>/<platform>/`. The plugin install path is purely declarative — `grok plugin install` does no special work.

**Affects**: `cross-harness-integration` spec — see "Binary distribution" requirement.

### D8. Bundled skills never write to grok-owned paths

grok watches `~/.grok/memory/` for file changes and reindexes on every edit. A sleep/deep-sleep skill that wrote back to MEMORY.md could trigger reindex loops or corrupt grok's index. All bundled skills read `~/.grok/memory/` and `~/.grok/skills/`, write only to the sync repo's `skills/` and `rules/` dirs.

**Affects**: `bundled-skills` spec — see "Read-only invariant" requirement.

## Open questions deferred to plan.md

1. MCP SDK choice: official `@modelcontextprotocol/sdk` vs hand-rolled slim JSON-RPC (binary-size consideration).
2. Whether a `/memex:search` slash command wraps the MCP tool for discoverability or we rely on auto-invocation.
3. Exact tool description wording (will be A/B tested against grok 4 once P1 passes).
