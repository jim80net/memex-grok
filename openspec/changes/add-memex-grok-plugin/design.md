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

**Why**: memex-claude derives sync-repo project IDs from `encodeProjectPath(cwd)`; grok would naturally derive from git remote slug+hash. These produce different IDs for the same project. Writing under different IDs silently fragments the corpus. Coordinating both harnesses on the canonical algorithm in memex-core, and shipping the algorithm before memex-grok's first write, is the only way to avoid this trap.

**Affects**: `cross-harness-integration` spec — see "Read-only-sync mode" requirement.

### D6. Sync repo path safety prevents silent divide

**Why**: A user who installs memex-grok before updating memex-claude would accumulate divergent writes in `~/.local/share/memex-claude/` and `~/.local/share/memex/`. The two repos are not auto-merged later. Preferring the existing `memex-claude/` path on first run keeps everything in one place until the user opts in to the rename via `memex doctor --migrate-repo`.

**Affects**: `cross-harness-integration` spec — see "Sync repo path policy" and "Migration command" requirements.

### D7. Bin stub instead of post-install script

**Why**: memex-claude's cross-platform install scripts have been a maintenance burden (Windows quoting, sudo paths, npm vs pnpm vs bun differences). A POSIX shell stub committed to the repo, doing lazy download + sha256 verify on first invocation, makes `grok plugin install` purely declarative and shifts platform-dispatch logic into one small, testable script.

**Affects**: `cross-harness-integration` spec — see "Binary distribution" requirement.

### D8. Bundled skills never write to grok-owned paths

grok watches `~/.grok/memory/` for file changes and reindexes on every edit. A sleep/deep-sleep skill that wrote back to MEMORY.md could trigger reindex loops or corrupt grok's index. All bundled skills read `~/.grok/memory/` and `~/.grok/skills/`, write only to the sync repo's `skills/` and `rules/` dirs.

**Affects**: `bundled-skills` spec — see "Read-only invariant" requirement.

### D9. Three-tier SCOPE — desk / flotilla / fleet (memex-core owns resolution)

**Operator directive (2026-07-04):** Grok's only reliable memex surfaces are filesystem sync and MCP tools — not hook injection. Rules, skills, and standing memory must apply at different breadths. memex-core resolves scope at index time; adapters stay thin.

| Scope | Corpus path | Applies to |
|-------|-------------|------------|
| Desk (project) | `projects/<canonical-id>/` | One git repo / worktree |
| Flotilla | `flotillas/<flotilla-id>/` | All desks under one project-XO |
| Fleet (global/user) | `fleet/` | Operator standing rules + constitution |

Precedence on ID collision: **fleet < flotilla < desk** (narrower wins). Grok reaches fleet/flotilla TRUSTED rules only via synced files the MCP server indexes — never via hook `additionalContext`.

**Affects**: `mcp-server` spec — index build must union applicable scope dirs (once memex-core ships the layout); `cross-harness-integration` spec — read paths honor scope union; bundled skills write to the correct scope bucket.

**Authoritative design:** `memex-core/design/knowledge-scope-three-tier.md`

## Open questions deferred to plan.md

1. MCP SDK choice: official `@modelcontextprotocol/sdk` vs hand-rolled slim JSON-RPC (binary-size consideration).
2. Whether a `/memex:search` slash command wraps the MCP tool for discoverability or we rely on auto-invocation.
3. Exact tool description wording (will be A/B tested against grok 4 once P1 passes).
