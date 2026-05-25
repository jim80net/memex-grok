# memex-grok — Design Spec

**Date**: 2026-05-25
**Status**: Approved for implementation planning
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
- Ships a **dormant `UserPromptSubmit` hook** that becomes the auto-injection path the day grok
  starts honoring `additionalContext` — flipped by a config flag, no refactor needed.
- Treats grok's native memory and skill systems as **complementary, not competing**: memex is the
  cross-harness sync corpus; grok-native memory remains for grok-only workflows.

The sync repo is the source of truth. Each harness has its own materializer.

## Architecture

```
              ~/.local/share/memex/             (cross-harness sync repo — was memex-claude)
                       │
                       ▼
              @jim80net/memex-core              (shared engine)
                       │
   ┌───────────────────┼───────────────────────────────────────┐
   ▼                   ▼                                       ▼
MCP server      SessionStart hook                  UserPromptSubmit hook
(always on)     (sync pull, index refresh)         (DORMANT today — future-ready)
─────────       ─────────                          ─────────
memex_search    grok plugin install               When grok honors additionalContext:
memex_read_skill triggers init                    flip flag, hookSpecificOutput emits.
memex_record_match                                MCP tool remains as the deliberate
memex_status                                      deeper-search complement.
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

Stdio JSON-RPC. Exposes four tools to the model:

| Tool | Args | Returns |
|---|---|---|
| `memex_search` | `query: string`, `top_k?: int (default 5)`, `threshold?: float (default 0.5)`, `types?: ("skill"\|"memory"\|"rule"\|"workflow"\|"session-learning"\|"tool-guidance")[]` | Array of `{name, type, location, relevance, description, best_query_index}` |
| `memex_read_skill` | `location: string` | Full skill/rule/memory content |
| `memex_record_match` | `location: string`, `query_index: int`, `session_id: string` | ack — feeds telemetry for GEPA query refinement |
| `memex_status` | (none) | `{index_size, source_counts, last_sync_at, sync_enabled}` |

Tool description (visible to the model) explicitly orients it toward semantic recall:

> "Search the user's cross-harness memex corpus — curated skills, memories, and rules indexed by
> semantic embedding. Use this when you need procedural know-how, project conventions, or
> personal preferences that may have been recorded across past sessions. Complements grok's
> built-in `memory_search` (which covers only this workspace's grok memory)."

### SessionStart hook (`memex hook`, event = `session_start`)

- Parses grok-native hook JSON from stdin (`hookEventName`, `sessionId`, `workspaceRoot`, etc.).
- Normalizes to memex-core's `HookInput` shape via `src/hooks/input.ts` adapter.
- Pulls sync repo if `config.sync.enabled && config.sync.autoPull`.
- Touches the cache mtime to invalidate; next MCP call rebuilds index.
- Writes a one-line status to stderr (visible in `grok inspect` annotations).
- Exits 0; stdout is ignored by grok today.

### UserPromptSubmit hook (`memex hook`, event = `user_prompt_submit`) — DORMANT

Wired in `hooks/hooks.json` so it's ready when grok ships `additionalContext` support, but
internally gated:

```ts
if (!config.hooks.UserPromptSubmit.injectAdditionalContext) {
  // Today: log match count to stderr only, exit 0.
  process.stderr.write(`memex: matched N — additionalContext not yet honored by grok\n`);
  return;
}
// Future: emit hookSpecificOutput with matches (same code path as memex-claude).
```

Default: `false`. Users (or `memex doctor`) flip it once grok lands support.

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
| `sleep` | Lifecycle: migrate MEMORY.md → skills, promote/demote by telemetry | Reads `~/.grok/memory/<slug-hash>/MEMORY.md` |
| `deep-sleep` | Extract learnings from past sessions | Reads `~/.grok/memory/<slug-hash>/sessions/` and grok session transcripts |
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

### Project memory mapping

memex-claude encodes `cwd` to derive a project ID. grok uses `<slug>-<hash8>` from the git remote
URL. Both must map to the same **canonical-id** in the sync repo for cross-harness portability.

`src/core/memory-mapping.ts` resolves:

1. **Grok local ID**: read git remote of cwd → `<slug>-<hash8>` (matches grok's own convention).
2. **Canonical ID**: look up `config.sync.projectMappings[<grok-local-id>]`; if absent, derive
   from git remote URL (canonical algorithm shared with memex-claude via memex-core).
3. **Sync memory dir**: `<sync-repo>/projects/<canonical-id>/memory/`.

This means a user with the same sync repo cloned on two machines — one using Claude, one using
grok — gets the same memex memories surfaced on both.

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
├── bin/                          # platform binaries downloaded post-install
│   └── memex
├── src/
│   ├── main.ts                   # entry, dispatches on argv[2]
│   ├── mcp/
│   │   ├── server.ts             # MCP stdio JSON-RPC loop
│   │   └── tools.ts              # tool implementations
│   ├── hooks/
│   │   ├── session-start.ts      # active
│   │   ├── user-prompt.ts        # dormant, gated by config
│   │   └── input.ts              # grok wire-format adapter
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
    "SessionStart": [
      { "hooks": [
        { "type": "command",
          "command": "${CLAUDE_PLUGIN_ROOT}/bin/memex hook",
          "timeout": 15 }
      ] }
    ],
    "UserPromptSubmit": [
      { "hooks": [
        { "type": "command",
          "command": "${CLAUDE_PLUGIN_ROOT}/bin/memex hook",
          "timeout": 10 }
      ] }
    ]
  }
}
```

Both hooks use `${CLAUDE_PLUGIN_ROOT}` because grok exports both `CLAUDE_PLUGIN_ROOT` and
`GROK_PLUGIN_ROOT` for plugin hooks. The Claude variant is more portable across marketplaces.

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
    "UserPromptSubmit": {
      "enabled": true,
      "injectAdditionalContext": false,  // dormant; flip when grok supports it
      "topK": 3,
      "threshold": 0.5,
      "maxInjectedChars": 8000,
      "types": ["skill", "memory", "workflow", "session-learning", "rule"]
    }
  },
  "mcp": {
    "enabled": true,
    "tools": ["memex_search", "memex_read_skill", "memex_record_match", "memex_status"]
  }
}
```

## Sync repo path migration

memex-claude currently uses `~/.local/share/memex-claude/`. memex-grok defaults to
`~/.local/share/memex/`. Both honor `config.sync.repoDir`, so users can interop today by setting
the same path on both.

A coordinated memex-claude release will:

1. Default to `~/.local/share/memex/` if it exists.
2. Fall back to `~/.local/share/memex-claude/` if only that exists (no auto-migration).
3. Surface a `memex doctor`-style suggestion to rename for clarity.

This keeps the migration **opt-in and non-destructive**.

## Future-readiness

When grok ships `additionalContext` support:

1. User sets `config.hooks.UserPromptSubmit.injectAdditionalContext: true`.
2. Existing handler emits `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit",
   "additionalContext":"…"}}` — same payload memex-claude emits today.
3. MCP tool remains valuable for deliberate deeper search.
4. Zero code changes required.

When grok ships PreToolUse output (tool-guidance):

1. Add `case "pre_tool_use"` to the hook dispatcher.
2. Reuse memex-core's existing PreToolUse handler.

When grok ships PreCompact hooks (already in event list but semantics may evolve):

1. Add `case "pre_compact"` mirroring memex-claude's handler.

## Out of scope (v1)

- **Materializing skills into `~/.grok/skills/`** — competes with grok's native skill loader and
  can collide with the user's own skills. The MCP tool is the supported way to surface skills.
- **Writing into MEMORY.md for injection** — pollutes the user's curated memory file.
- **HTTP MCP transport** — stdio only, matches grok's local-trust model.
- **memex-grok-specific sync repo** — uses the shared `~/.local/share/memex/`.
- **Cross-harness session-continuity handoff** — handoff format may diverge initially.
- **Auto-rewriting AGENTS.md from rule matches** — too invasive for v1.

## Known implementation risks

### Plugin hooks may not fire reliably

In headless probe testing (`grok -p "…"`), a plugin's `hooks/hooks.json` was correctly
recognized by `grok inspect` but its hook scripts never executed. The identical script
installed at `~/.grok/hooks/` (global scope) fired normally.

This could be a headless-mode quirk, a missing trust step, or a version-specific bug.
Implementation must validate plugin-hook firing in an interactive TTY session before declaring
the SessionStart wiring functional. If plugin hooks turn out to be unreliable, the fallback
is to ship an installer (or `memex doctor --install-hooks`) that symlinks `hooks/hooks.json`
into `~/.grok/hooks/memex-grok.json` as a global hook. The MCP server path is unaffected
either way — MCP servers from `.mcp.json` are loaded by a separate mechanism.

### `CLAUDE_PLUGIN_ROOT` expansion in plugin hooks

The hooks documentation claims grok injects both `CLAUDE_PLUGIN_ROOT` and `GROK_PLUGIN_ROOT`
for plugin-sourced hooks. We could not confirm this in testing because plugin hooks did not
fire. The implementation must verify the variable expands correctly; if only
`GROK_PLUGIN_ROOT` is reliable, switch `hooks/hooks.json` to use it (or write both forms via
a fallback script).

## Open implementation questions (deferred to plan)

1. MCP SDK choice: official `@modelcontextprotocol/sdk` vs lighter hand-rolled JSON-RPC. The
   official SDK pulls heavy deps; we may bundle our own slim implementation for binary-size
   reasons (consistent with memex-claude's footprint).
2. Platform binary download: same pattern as memex-claude (post-install script in
   `hooks/post-install.sh`, or lazy first-run download)?
3. Whether to ship a `/memex:search` slash command as a thin wrapper around the MCP tool for
   discoverability, or rely on auto-invocation.

## Success criteria

- `grok plugin install jim80net/memex-grok` installs and registers the MCP server + hooks.
- In a grok session inside a project with skills in `~/.grok/skills/`, asking a question that
  matches a skill description causes the model to invoke `memex_search`, get back the skill, and
  reference it in its response — without any human intervention beyond the question.
- A sync repo populated by memex-claude is consumed identically by memex-grok (same skills,
  rules, memories surface on both).
- The day grok ships `additionalContext` support, one config flip enables auto-injection with no
  code release required.
- `memex doctor` correctly reports MCP registration status, hook trust, and `additionalContext`
  support detection.
