# memex-grok — Design Spec

**Date**: 2026-05-25
**Status**: Approved pending prerequisite validation (see §Implementation prerequisites)
**Related**: [memex-claude](https://github.com/jim80net/memex-claude), [@jim80net/memex-core](https://github.com/jim80net/memex-core)

## Goal

Bring memex's semantic-search-driven skill / memory / rule disclosure to grok-tui, with a shared
backend sync repo that transcends the AI coding harness. The sync repo is canonical; per-harness
adapters (memex-claude, memex-grok) materialize and consume that corpus through whatever
mechanisms each harness offers.

## Context

`memex-claude` injects matched skills, memories, and rules into Claude Code conversations via the
`UserPromptSubmit` hook, returning a JSON payload with `additionalContext` on stdout. That
mechanism is the linchpin of the user experience.

Live testing against grok 0.1.219 confirmed:

1. **`additionalContext` is not honored by grok.** Both the bare form (`{"additionalContext":"…"}`)
   and the Claude-wrapped form (`{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit",
   "additionalContext":"…"}}`) were emitted from a hook — the model saw neither in the resulting
   turn.
2. **Hook input schema differs.** grok emits `hookEventName: "user_prompt_submit"` (camelCase key,
   snake_case enum value) where Claude emits `hook_event_name: "UserPromptSubmit"`. Other fields
   are similarly camelCased (`sessionId`, `workspaceRoot`, `promptId`).
3. **Plugin hooks did not fire in headless mode** during testing — only global
   `~/.grok/hooks/*.json` entries executed. Whether this is a bug, a trust-flow gap, or
   intentional is unclear, but plugin hooks cannot be relied on today.
4. **Tool-name aliases auto-map** (`Bash`↔`run_terminal_cmd`, `Edit`↔`search_replace`,
   `Read`↔`read_file`), so PreToolUse matchers using Claude names will work.
5. **grok has a built-in semantic memory system** with SQLite FTS5 + vec0 hybrid search over
   `~/.grok/memory/<slug-hash>/`. It auto-injects relevant memory on the first turn and exposes
   `memory_search` / `memory_get` tools to the model.

These findings rule out a straight repackage of memex-claude for grok.

## Approach

Build memex-grok as a **separate plugin** (not a unified adapter, not a Claude-shim) that:

- Shares `@jim80net/memex-core` with memex-claude for SkillIndex, embeddings, sync, and telemetry.
- Exposes a **stdio MCP server** (`memex`) to grok's model, mirroring grok's own
  `memory_search`/`memory_get` pattern. The model deliberately invokes search when relevant.
- Ships **dormant hooks** (`UserPromptSubmit`, `Stop`, `PreCompact`) that become the
  auto-injection path when grok adds hook-driven context injection — activated by config flags,
  with one new serializer for whatever wire format grok adopts. The match-computation logic is
  fully reused; only serialization changes.
- Treats grok's native memory and skill systems as **complementary, not competing**: memex is the
  cross-harness sync corpus; grok-native memory remains for grok-only workflows.

The sync repo is the source of truth. Each harness has its own materializer.

## Architecture

```
            ~/.local/share/memex/         (cross-harness sync repo — was memex-claude)
                     │
                     ▼
            @jim80net/memex-core          (shared engine: SkillIndex, embeddings, sync,
                     │                     canonicalProjectId)
   ┌─────────────────┼───────────────────────────────────────────────────┐
   ▼                 ▼                                                   ▼
MCP server     SessionStart hook                    UserPromptSubmit / Stop / PreCompact
(PRIMARY)      (best-effort warm-up)                (DORMANT — future-ready)
─────────      ─────────                            ─────────
memex_search   if plugin hooks fire,                Wired in hooks.json; gated by config.
memex_read_skill  pull sync repo eagerly            When grok ships injection (any wire
memex_status   and warm the cache.                  format), add serializer + flip flag.
               If they don't, MCP server
First-call init  picks up the work on
performs sync    first tool call. No
pull + index     user-visible degradation.
rebuild — does
not depend on
SessionStart.
```

## Components

### The `memex` binary

One executable, dispatched by `argv[2]`:

| Subcommand | Purpose |
|---|---|
| `memex mcp` | Stdio MCP server (long-running per session) |
| `memex hook` | Reads hook JSON from stdin, dispatches by event |
| `memex sync` | One-shot pull/push of sync repo |
| `memex doctor` | Diagnose install |
| `memex index --rebuild` | Force reindex |

Built with Bun, self-contained per-platform binary, same packaging pattern as memex-claude.

### MCP server (`memex mcp`)

Stdio JSON-RPC. The MCP server is the **primary entry point** for memex on grok — it is also
responsible for sync-repo pull and index refresh on first call (the SessionStart hook is best-
effort, see below). Exposes three tools to the model:

| Tool | Args | Returns |
|---|---|---|
| `memex_search` | `query: string`, `top_k?: int (default 5)`, `threshold?: float (default 0.5)`, `types?: ("skill"\|"memory"\|"rule"\|"workflow"\|"session-learning"\|"tool-guidance")[]` | `{query_id: string, results: Array<{name, type, location, relevance, description, best_query_index}>}` |
| `memex_read_skill` | `location: string`, `query_id?: string` | Full skill/rule/memory content. Internally records a telemetry match for `(location, query_id, session_id)` so GEPA-style query refinement works without requiring a separate model-issued tool call. |
| `memex_status` | (none) | `{index_size, source_counts, last_sync_at, sync_enabled, embedding_model}` |

`memex_record_match` from earlier drafts is removed — model-issued telemetry calls were judged
unreliable (models do not consistently make courtesy tool calls after using a result). Telemetry
is now recorded implicitly when the model reads a matched skill.

Tool descriptions (visible to the model) must clearly differentiate from grok's native
`memory_search` to avoid the model picking arbitrarily:

> **`memex_search`**: Search the user's cross-harness memex corpus — curated skills, rules, and
> long-lived preferences synced via git across machines and AI coding harnesses. Use this for
> procedural know-how ("how do I deploy X?"), coding conventions, recurring workflows, or
> personal preferences likely to have been recorded across past sessions. **This is different
> from `memory_search`**, which only covers grok's per-workspace conversational memory.

If memex-grok determines at startup that grok's `memory_search` is available, it prepends a
note in the tool description: *"Use this BEFORE `memory_search` for any question that might be
answered by a durable skill or rule."*

### First-call initialization (sync + index)

On the first MCP tool call of a session:

1. If `config.sync.enabled && config.sync.autoPull` and mtime of sync repo's `.git/FETCH_HEAD`
   is older than `config.sync.pullCacheMs` (default 5 min), run `git pull --rebase`.
2. Rebuild the SkillIndex if any source-dir mtime changed since the cache's `built_at`.
3. Serve the tool call.

This means the system functions whether or not the SessionStart hook fires. The hook, when it
fires, only warms up the cache — it is not on the critical path.

### SessionStart hook (`memex hook`, event = `session_start`) — BEST-EFFORT

The probe found plugin-sourced hooks did not fire in grok 0.1.219 headless mode. The hook is
still wired (in case it fires interactively or in future versions), but the **first-call
initialization in the MCP server is the authoritative path** for sync-pull and indexing.

When (if) this hook fires:
- Parses grok-native hook JSON from stdin (`hookEventName`, `sessionId`, `workspaceRoot`, etc.).
- Normalizes to memex-core's `HookInput` shape via `src/hooks/input.ts` adapter.
- Performs the same sync-pull + cache-invalidation that first-call MCP would do, eagerly.
- Writes a one-line status to stderr (visible in `grok inspect` annotations).
- Exits 0; stdout is ignored by grok today.

If the hook does not fire, the MCP server picks up the work transparently — no user-visible
degradation, just a one-time latency hit on the first `memex_search` of the session.

### UserPromptSubmit hook (`memex hook`, event = `user_prompt_submit`) — DORMANT

Wired in `hooks/hooks.json` and ready to activate when grok ships hook-driven context injection.
Internally gated:

```ts
if (!config.hooks.UserPromptSubmit.injectAdditionalContext) {
  // Today: log match count to stderr only, exit 0.
  process.stderr.write(`memex: matched N — context injection not yet honored by grok\n`);
  return;
}
// Future: serialize matches in whatever wire format grok adopts.
emitInjection(matches, config.hooks.UserPromptSubmit.wireFormat);
```

Default: `false`. The `wireFormat` config defaults to `"claude_hook_specific_output"` (today's
Claude convention) but is overridable. When grok publishes its injection spec, the appropriate
serializer is added to `src/hooks/injection-serializers.ts` and users select it via config.

### Dormant Stop and PreCompact hooks

Wired in `hooks/hooks.json` alongside UserPromptSubmit. Today: log-only. When grok confirms
these events fire reliably from plugin hooks and supports any associated stdout semantics, the
handlers (ported from memex-claude) activate via config flags. Same dormancy/activation
pattern as UserPromptSubmit.

### Hook input adapter (`src/hooks/input.ts`)

The single place where grok's wire format is translated:

```ts
// Grok wire format:
//   { hookEventName: "user_prompt_submit", sessionId, cwd, workspaceRoot,
//     timestamp, promptId, prompt }
// Memex-core HookInput:
//   { hook_event_name: "UserPromptSubmit", session_id, cwd, prompt, ... }
```

Snake_case event names are mapped to PascalCase enum values via a static table. The `prompt`
field is unwrapped from its `<user_query>…</user_query>` envelope (grok wraps prompts).

Event mapping:

| grok wire (`hookEventName`) | memex-core (`hook_event_name`) |
|---|---|
| `session_start` | `SessionStart` |
| `user_prompt_submit` | `UserPromptSubmit` |
| `pre_tool_use` | `PreToolUse` |
| `post_tool_use` | `PostToolUse` |
| `stop` | `Stop` |
| `pre_compact` | `PreCompact` |
| `session_end` | `SessionEnd` |
| `notification` | `Notification` |

Field mapping:

| grok | memex-core |
|---|---|
| `sessionId` | `session_id` |
| `cwd` | `cwd` |
| `workspaceRoot` | (new field — preserved) |
| `promptId` | (new field — preserved) |
| `prompt` (wrapped in `<user_query>`) | `prompt` (unwrapped) |
| `toolName` | `tool_name` |
| `toolInput` | `tool_input` |
| `reason` (Stop) | `reason` |
| `source` (SessionStart) | `source` |

### Bundled skills (`skills/`)

Ported from memex-claude, adjusted for grok-native paths:

| Skill | Purpose | grok-specific changes |
|---|---|---|
| `sleep` | Lifecycle: extract entries from MEMORY.md into searchable skills, promote/demote by telemetry | **Read-only** against `~/.grok/memory/<slug-hash>/MEMORY.md`; all writes go to the sync repo's `skills/` dir. Never modifies grok-owned files (grok's file watcher would reindex on every edit and could trigger reindex loops). |
| `deep-sleep` | Extract learnings from past sessions | **Read-only** against `~/.grok/memory/<slug-hash>/sessions/` and grok session transcripts. Writes go to sync repo. |
| `reflect` | Single-session learning extraction | Same |
| `doctor` | Install diagnosis | Checks `~/.grok/` paths, MCP registration, hook trust |
| `handoff` | Create continuation plan | grok session format |
| `takeover` | Resume from handoff | Same |
| `help` | User-facing help | Mentions MCP tools |

Skills live in `skills/` (auto-discovered by grok as plugin skills).

## Data sources & paths

`SkillIndex` scans these for grok:

| Source | Path(s) | Notes |
|---|---|---|
| Global skills | `~/.grok/skills/*/SKILL.md`, `~/.claude/skills/*/SKILL.md` | grok itself also reads `~/.claude/skills/`; we mirror to maximize portability |
| Project skills | `<cwd>/.grok/skills/*/SKILL.md`, `<cwd>/.claude/skills/*/SKILL.md` | Both |
| Rules (memex concept) | `~/.grok/rules/*.md`, `<cwd>/.grok/rules/*.md` | New convention — grok has no native rules dir; AGENTS.md is a separate layer |
| Memory (memex concept) | `~/.grok/memory/<slug-hash>/MEMORY.md`, plus `sessions/*.md` | Workspace-scoped, hash derived from git remote URL |
| Sync repo | `~/.local/share/memex/{skills,rules,projects/<canonical-id>/memory}` | Same shape as memex-claude's sync repo |

### Project memory mapping — CRITICAL PREREQUISITE

memex-claude today derives its sync-repo project ID by calling `encodeProjectPath(cwd)` from
memex-core, which encodes the absolute filesystem path. grok identifies a workspace by
`<slug>-<hash8>` derived from the git remote URL. **These two algorithms produce different IDs
for the same project** — meaning a naive port would silently fragment the corpus into two
unmerged buckets under `<sync-repo>/projects/`.

**Prerequisite (blocks any sync-repo writes from memex-grok):**

A canonical project-id algorithm must be defined in `@jim80net/memex-core` and adopted by both
harnesses before memex-grok writes to the sync repo. The algorithm:

1. If a git remote `origin` exists, derive ID from a normalized form of the remote URL (strip
   protocol, lowercase host, strip `.git`, replace non-alphanumerics with `-`, append short
   hash). This matches grok's existing convention but is harness-agnostic.
2. If no git remote, fall back to `encodeProjectPath(cwd)` (matches memex-claude's current
   behavior for non-git projects).
3. Always honor an explicit `config.sync.projectMappings[<local-id>] = <canonical-id>` override
   for users with renamed/moved projects.

**Rollout order (mandatory):**

1. Add `canonicalProjectId()` to memex-core and release a new minor version.
2. Release memex-claude with a migration that reads the OLD `encodeProjectPath`-keyed dirs and
   moves them under the new canonical IDs (with a `memex doctor --migrate-project-ids` command).
3. Only after step 2 is shipped and the user has migrated, memex-grok ships v0.1.0 writing under
   the new canonical IDs.

Until the user runs the migration, memex-grok operates in **read-only-sync mode**: it can index
and surface entries from the sync repo (preferring matches under canonical IDs but falling back
to legacy IDs if present), but does not write back to `projects/<id>/memory/`. Writes go to
grok-local paths only. `memex doctor` reports this state and links to the migration command.

`src/core/memory-mapping.ts` resolves:

1. **Grok local ID**: read git remote of cwd → `<slug>-<hash8>` (matches grok's own convention).
2. **Canonical ID**: call `canonicalProjectId(cwd)` from memex-core. Honors
   `config.sync.projectMappings` overrides.
3. **Sync memory dir**: `<sync-repo>/projects/<canonical-id>/memory/`.

## Plugin layout

```
memex-grok/
├── .claude-plugin/
│   ├── plugin.json
│   └── marketplace.json
├── .mcp.json
├── hooks/
│   └── hooks.json
├── skills/
│   ├── sleep/SKILL.md
│   ├── deep-sleep/SKILL.md
│   ├── reflect/SKILL.md
│   ├── doctor/SKILL.md
│   ├── handoff/SKILL.md
│   ├── takeover/SKILL.md
│   └── help/SKILL.md
├── bin/
│   ├── memex                     # POSIX shell stub; downloads platform binary on first run
│   └── memex.cmd                 # Windows variant
├── src/
│   ├── main.ts                   # entry, dispatches on argv[2]
│   ├── mcp/
│   │   ├── server.ts             # MCP stdio JSON-RPC loop
│   │   └── tools.ts              # tool implementations
│   ├── hooks/
│   │   ├── session-start.ts      # best-effort warm-up
│   │   ├── user-prompt.ts        # dormant, gated by config
│   │   ├── stop.ts               # dormant, gated by config
│   │   ├── pre-compact.ts        # dormant, gated by config
│   │   ├── input.ts              # grok wire-format adapter (input)
│   │   └── injection-serializers.ts  # output serializers per wireFormat
│   ├── cli/
│   │   ├── sync.ts
│   │   ├── doctor.ts
│   │   └── index-cmd.ts
│   └── core/
│       ├── config.ts             # GrokRouterConfig extends MemexCoreConfig
│       ├── paths.ts              # ~/.grok-rooted paths
│       └── memory-mapping.ts     # grok ↔ sync canonical-id
├── build.ts                      # bun build --compile, platform matrix
├── package.json
├── tsconfig.json
├── README.md
├── CONTRIBUTING.md
└── USAGE.md
```

### `.claude-plugin/plugin.json`

```json
{
  "name": "memex-grok",
  "version": "0.1.0",
  "description": "Memex skill/memory/rule router for grok — semantic context via MCP and shared sync repo",
  "author": { "name": "Jim Park", "url": "https://github.com/jim80net" },
  "repository": "https://github.com/jim80net/memex-grok",
  "license": "MIT",
  "skills": "./skills/"
}
```

### `.mcp.json`

```json
{
  "mcpServers": {
    "memex": {
      "command": "${CLAUDE_PLUGIN_ROOT}/bin/memex",
      "args": ["mcp"]
    }
  }
}
```

### `hooks/hooks.json`

```json
{
  "hooks": {
    "SessionStart":      [ { "hooks": [ { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/bin/memex hook", "timeout": 15 } ] } ],
    "UserPromptSubmit":  [ { "hooks": [ { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/bin/memex hook", "timeout": 10 } ] } ],
    "Stop":              [ { "hooks": [ { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/bin/memex hook", "timeout": 30 } ] } ],
    "PreCompact":        [ { "hooks": [ { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/bin/memex hook", "timeout": 10 } ] } ]
  }
}
```

All four hooks point at the same `memex hook` dispatcher. SessionStart is best-effort
initialization; UserPromptSubmit, Stop, and PreCompact are dormant in v1 (config-gated). The
hooks are wired now so activation is a config change rather than a release.

The `${CLAUDE_PLUGIN_ROOT}` variable: the hooks documentation claims grok exports both
`CLAUDE_PLUGIN_ROOT` and `GROK_PLUGIN_ROOT` for plugin hooks. The Claude variant is more
portable across the Claude/grok plugin ecosystems. If validation reveals only `GROK_PLUGIN_ROOT`
is set, the build emits an alternate `hooks.json` with `${GROK_PLUGIN_ROOT}` substituted.

### Bin stub

`bin/memex` is a small POSIX shell stub committed to the repo. On invocation, if the platform
binary is not yet downloaded into `${HOME}/.cache/memex-grok/<version>/<platform>/memex`, it
downloads and verifies (sha256 sum from the release) before exec'ing it. This makes
`grok plugin install` work without a post-install script and avoids the cross-platform install-
script headaches memex-claude has dealt with. The Windows variant ships as `bin/memex.cmd`.

## Config

`~/.grok/memex.json` (default location, overridable via `MEMEX_CONFIG` env var):

```jsonc
{
  "enabled": true,
  "embeddingModel": "Xenova/all-MiniLM-L6-v2",
  "skillDirs": [],
  "sync": {
    "enabled": false,
    "repoDir": "~/.local/share/memex",   // configurable; new clean default
    "autoPull": true,
    "autoCommitPush": true,
    "projectMappings": {}
  },
  "hooks": {
    "SessionStart":    { "enabled": true },
    "UserPromptSubmit": {
      "enabled": true,
      "injectAdditionalContext": false,    // dormant; flip when grok ships injection
      "wireFormat": "claude_hook_specific_output",  // future: "grok_native_v1" etc.
      "topK": 3,
      "threshold": 0.5,
      "maxInjectedChars": 8000,
      "types": ["skill", "memory", "workflow", "session-learning", "rule"]
    },
    "Stop":             { "enabled": false, "extractLearnings": true, "behavioralRules": true },
    "PreCompact":       { "enabled": false }
  },
  "mcp": {
    "enabled": true,
    "tools": ["memex_search", "memex_read_skill", "memex_status"]
  }
}
```

## Sync repo path migration

memex-claude currently uses `~/.local/share/memex-claude/`. memex-grok prefers
`~/.local/share/memex/` (harness-agnostic). Both honor `config.sync.repoDir`, so users can
interop today by setting the same path on both.

**The risk to avoid:** a user installs memex-grok before updating memex-claude, ends up with two
unmerged repos at `~/.local/share/memex-claude/` and `~/.local/share/memex/`, and accumulates
divergent writes that are hard to reconcile.

**memex-grok's safety policy:**

1. At first run, if `~/.local/share/memex-claude/` exists and is a non-empty git repo, **do not
   create `~/.local/share/memex/`**. Instead, set the effective sync repo to the existing
   `memex-claude/` directory and log a one-line suggestion to run `memex doctor --migrate-repo`.
2. `memex doctor --migrate-repo` performs `git mv` (or `mv` for the workdir) of
   `~/.local/share/memex-claude/` to `~/.local/share/memex/`, leaving a symlink at the old path
   for backward compatibility. The operation is interactive (asks for confirmation) and
   reversible (no destructive removal).
3. After migration, the symlink keeps any not-yet-updated memex-claude install reading from the
   same data.

**memex-claude's coordinated release (separate change request, tracked under the same effort):**

1. Default sync repo: `~/.local/share/memex/` if it exists or is a symlink target; else fall
   back to `~/.local/share/memex-claude/`.
2. Surface `memex doctor`-style suggestion to migrate.
3. No auto-rename — the user runs `memex doctor --migrate-repo` from either harness.

This keeps the migration **opt-in, non-destructive, and consistent across harnesses**.

## Coexistence with memex-claude on grok

grok reads `~/.claude/plugins/` for compatibility. A user with memex-claude already installed
in Claude will have it visible to grok as well — verified in the probe (`grok inspect --json`
showed `memex-claude` enabled). With both memex-claude and memex-grok installed in grok, hooks
would double-fire and both would race to read/write the same telemetry and cache files.

**Resolution:**

memex-claude grows a grok-detection guard at the top of its entrypoint. If `GROK_HOOK_EVENT` is
present in the process environment (only set by grok's hook runner), memex-claude exits 0
immediately with a stderr line: `memex-claude: deferring to memex-grok on this harness`. This is
a one-line change to memex-claude, shipped as a patch release coordinated with memex-grok v0.1.0.

memex-grok takes no reciprocal action — if a user is running memex-grok on Claude Code (which
would require setting `CLAUDE_HOOK_*` env vars), that is unsupported and outside the design.

The `memex doctor` command in both harnesses reports whether the other is installed and whether
the deferral is active.

## Future-readiness

When grok ships hook-driven context injection (whatever the wire format):

1. The `wireFormat` config option grows a new value (e.g. `"grok_native_v1"`).
2. A new serializer is added to `src/hooks/injection-serializers.ts` — typically a 10-20 line
   function that takes the matches and returns the payload string.
3. User sets `config.hooks.UserPromptSubmit.injectAdditionalContext: true` and (if not the
   default) `wireFormat: "grok_native_v1"`.
4. The MCP tool remains valuable as the deliberate deeper-search complement.

The match-computation code path is fully reused. Only the serialization layer changes — bounded
to one file. This is the precise scope of "future-readiness" the design guarantees.

**What is NOT guaranteed:** that grok will adopt Claude's `hookSpecificOutput.additionalContext`
wire format verbatim. The probe already showed grok diverges from Claude on input keys (snake
vs PascalCase enum values, camelCase field names). Output divergence is plausible.

When grok ships PreToolUse output (tool-guidance):

1. Add `case "pre_tool_use"` to the hook dispatcher.
2. Reuse memex-core's existing PreToolUse handler.

When grok ships Stop or PreCompact hooks that fire from plugin scope:

1. Activate the dormant handlers (already wired) via config flags.

## Out of scope (v1)

- **Materializing skills into `~/.grok/skills/`** — competes with grok's native skill loader and
  can collide with the user's own skills. The MCP tool is the supported way to surface skills.
- **Writing into MEMORY.md for injection** — pollutes the user's curated memory file.
- **HTTP MCP transport** — stdio only, matches grok's local-trust model.
- **memex-grok-specific sync repo** — uses the shared `~/.local/share/memex/`.
- **Cross-harness session-continuity handoff** — handoff format may diverge initially.
- **Auto-rewriting AGENTS.md from rule matches** — too invasive for v1.

## Implementation prerequisites (must pass before coding starts)

These items must be validated against a live grok session before implementation begins.
Failures here change the design, not just the implementation.

### P1. MCP-server-from-plugin loading works

Install a trivial probe plugin with a `.mcp.json` declaring a stdio server with one
`probe_echo` tool. In an interactive grok session, confirm:
- `grok inspect --json` lists the server under `mcpServers`
- Asking the model to "call probe_echo with message 'hi'" succeeds and returns the echo
- The server process is spawned exactly once per session

**If this fails:** the design pivots to a user-installed MCP via `~/.grok/.mcp.json` or
`grok mcp add` invoked by the installer. The plugin still ships the `.mcp.json` as a fallback.

### P2. Plugin hook firing in interactive TTY

The headless probe showed plugin hooks did not fire. Re-test in an interactive grok session
(real TTY). If hooks fire interactively but not headlessly, the SessionStart hook remains
best-effort and the MCP first-call path is the actual workhorse (already specified). If hooks
fire in neither mode, the doctor command must offer to install `~/.grok/hooks/memex-grok.json`
as a global-scope symlink fallback.

### P3. `CLAUDE_PLUGIN_ROOT` / `GROK_PLUGIN_ROOT` expansion in plugin hooks

Once P2 establishes hooks fire, confirm which variables expand. If only `GROK_PLUGIN_ROOT`
works, switch `hooks/hooks.json` to use it (build script can substitute).

### P4. Canonical project-id algorithm in memex-core

`canonicalProjectId()` defined, tested, and released in memex-core. memex-claude updated to
use it (with migration). Without this, memex-grok ships in read-only-sync mode only.

### P5. Coexistence guard in memex-claude

memex-claude patched to exit 0 when `GROK_HOOK_EVENT` is set in its environment.

## Open implementation questions (resolved in plan)

1. MCP SDK choice: official `@modelcontextprotocol/sdk` vs lighter hand-rolled JSON-RPC. The
   official SDK pulls heavy deps; we may bundle our own slim implementation for binary-size
   reasons (consistent with memex-claude's footprint).
2. Whether to ship a `/memex:search` slash command as a thin wrapper around the MCP tool for
   discoverability, or rely on auto-invocation.

## Success criteria

- `grok plugin install jim80net/memex-grok --trust` installs the plugin and registers the MCP
  server (and hooks, to whatever degree grok supports plugin hooks).
- In a grok session inside a project with skills in `~/.grok/skills/`, asking a question that
  matches a skill description causes the model to invoke `memex_search`, get back the skill,
  and reference it in its response — without any human intervention beyond the question.
- A sync repo populated by memex-claude is consumed identically by memex-grok (same skills,
  rules, memories surface on both) after both harnesses have adopted the shared
  `canonicalProjectId` algorithm.
- Installing both memex-claude and memex-grok on grok does not double-fire hooks (memex-claude
  detects grok env and defers).
- The day grok ships hook-driven context injection (whatever wire format), enabling
  auto-injection is a one-file serializer addition plus a config flip, with no architectural
  refactor.
- `memex doctor` reports: MCP registration status, hook firing behavior, `CLAUDE_PLUGIN_ROOT`
  expansion status, sync repo location, canonical-id migration state, and coexistence-deferral
  status.
