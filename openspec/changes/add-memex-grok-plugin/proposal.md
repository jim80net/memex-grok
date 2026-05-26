## Why

`memex-claude` injects matched skills, memories, and rules into Claude Code conversations via a `UserPromptSubmit` hook that returns `additionalContext` on stdout. Live testing against grok 0.1.219 confirmed grok does not honor that injection mechanism today — neither the bare nor wrapped form is consumed by the model. Hook input schema also differs (camelCase keys, snake_case enum values), and plugin-sourced hooks did not fire from headless mode in our probe.

A straight repackage of memex-claude for grok will not work. But grok has a first-class MCP system the model already uses (`memory_search`, `memory_get`), and a plugin loader that recognizes Claude-style `.claude-plugin/plugin.json` + `.mcp.json` + `hooks/hooks.json`. That lets us ship a grok-native adapter that surfaces the same cross-harness corpus through a different mechanism, while keeping `@jim80net/memex-core` as the shared engine.

The point of the design is the *sync repo* — a single git-tracked corpus of skills, rules, and memories that both Claude and grok harnesses read from and write to. Once both adapters agree on a canonical project-id algorithm (separately tracked in `memex-core`), a user's curated knowledge follows them across both AI coding harnesses.

## What Changes

- **New plugin `memex-grok`** packaged as `.claude-plugin/plugin.json` + `.mcp.json` + `hooks/hooks.json` (grok recognizes all three from its claude-compat layer). Installable via `grok plugin install jim80net/memex-grok`.
- **New stdio MCP server `memex mcp`** exposes three tools: `memex_search` (query → `{query_id, results[]}`), `memex_read_skill` (location, optional query_id → full content; records telemetry implicitly), `memex_status`. The server is the **primary entry point** — it performs sync-pull + index-rebuild on first tool call, so the SessionStart hook is not on the critical path.
- **Hook dispatcher `memex hook`** with grok-native wire-format adapter. Snake_case event enums and camelCase field names are normalized to memex-core's `HookInput` shape in a single bounded module (`src/hooks/input.ts`). The `prompt` field is unwrapped from grok's `<user_query>` envelope.
- **One active hook (SessionStart, best-effort) + three dormant hooks (UserPromptSubmit, Stop, PreCompact)** wired in `hooks.json`. Dormant hooks log-only today; the day grok ships hook-driven context injection, activation is a config flip plus one new serializer in `src/hooks/injection-serializers.ts`. **NOT** a refactor.
- **Coexistence guard**: memex-claude (loaded by grok via `~/.claude/plugins/` for Claude-compat) ships a one-line patch to exit 0 when `GROK_HOOK_EVENT` is set in env. Prevents double-fire collisions.
- **Sync repo path safety**: memex-grok prefers `~/.local/share/memex/` but refuses to create it while `~/.local/share/memex-claude/` exists and is non-empty. `memex doctor --migrate-repo` performs the rename with backward-compat symlink.
- **Read-only-sync mode** until `canonicalProjectId()` from memex-core ships and the user runs the project-id migration in memex-claude. Reads can fall back to legacy project IDs; writes go to grok-local paths only.
- **Bin stub**: `bin/memex` is a small POSIX shell that downloads and verifies the platform binary into `~/.cache/memex-grok/<version>/<platform>/` on first run, then exec's it. No post-install script required.
- **Seven bundled skills** ported from memex-claude with grok-native paths: `sleep`, `deep-sleep`, `reflect`, `doctor`, `handoff`, `takeover`, `help`. All read-only against `~/.grok/memory/` and `~/.grok/skills/` — writes go to the sync repo only, never to grok-owned paths.

### Implementation prerequisites (validated before code lands)

P1. **MCP-server-from-plugin loading works** — install a probe plugin with `.mcp.json` declaring a `probe_echo` tool, confirm the model can call it from an interactive grok session and the server is spawned exactly once.
P2. **Plugin hook firing in interactive TTY** — re-run the headless probe interactively. If hooks fire only in TTY mode, SessionStart remains best-effort. If they fire in neither mode, `memex doctor --install-hooks` falls back to symlinking into `~/.grok/hooks/`.
P3. **`CLAUDE_PLUGIN_ROOT` expansion** — confirm the variable expands in plugin hooks. If only `GROK_PLUGIN_ROOT` works, the build substitutes.
P4. **`canonicalProjectId()` in memex-core** — defined, released, and memex-claude updated with migration. Until then, memex-grok ships in read-only-sync mode.
P5. **Coexistence guard in memex-claude** — patched to exit on `GROK_HOOK_EVENT`.

P1 and P2 are validated in an exploratory subtask before any feature code. P3 follows P2. P4 and P5 are tracked in coordinated change requests against memex-core and memex-claude respectively.

## Capabilities

### New Capabilities

- `mcp-server`: Stdio MCP server exposing `memex_search`, `memex_read_skill`, `memex_status`. Includes first-call initialization (sync-pull, index-rebuild) and tool-description policy that explicitly differentiates from grok's native `memory_search`.
- `hook-runtime`: The `memex hook` dispatcher, the grok-native wire-format input adapter, the dormancy machinery for UserPromptSubmit / Stop / PreCompact, and the pluggable injection serializer interface for future activation.
- `cross-harness-integration`: The contracts that make memex-grok and memex-claude cooperate — read-only-sync mode while pre-canonical-id, sync repo path safety policy with `--migrate-repo`, coexistence guard on `GROK_HOOK_EVENT`, and binary-distribution via the POSIX shell stub.
- `bundled-skills`: The seven skills shipped with the plugin (`sleep`, `deep-sleep`, `reflect`, `doctor`, `handoff`, `takeover`, `help`), with the **read-only invariant** against grok-owned paths.

### Modified Capabilities

<!-- None — openspec/specs/ is empty (no baseline); all four capabilities are introduced here. -->

## Impact

- **Affected code (new repo)**: `src/main.ts`, `src/mcp/{server,tools}.ts`, `src/hooks/{session-start,user-prompt,stop,pre-compact,input,injection-serializers}.ts`, `src/cli/{sync,doctor,index-cmd}.ts`, `src/core/{config,paths,memory-mapping}.ts`, `build.ts`, plus 7 skill directories and the three plugin manifest files.
- **Affected on-disk state**: `~/.grok/memex.json` (config, optional), `~/.cache/memex-grok/` (binary download cache), `~/.local/share/memex/` (sync repo — shared with memex-claude post-migration).
- **External dependencies (cross-repo)**:
  - `memex-core`: must ship `canonicalProjectId()` (separate openspec change in that repo). Without it, memex-grok runs in read-only-sync mode.
  - `memex-claude`: must ship a `GROK_HOOK_EVENT` guard and adopt `canonicalProjectId` with a one-shot migration (separate change in that repo).
- **No new runtime dependencies** beyond what memex-core/memex-claude already pull in.
- **Documentation**: `README.md`, `CONTRIBUTING.md`, `USAGE.md` for the new repo. `memex-claude` README gets a cross-link.
