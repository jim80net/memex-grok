> Detailed step-by-step instructions (with full code, test fixtures, and commit messages) will live in [`plan.md`](./plan.md) after writing-plans runs. This file is the high-level checklist that openspec uses to track progress.

## 0. Prerequisites — must pass before any feature code

- [ ] 0.1 Validate P1: install a trivial probe plugin with `.mcp.json` declaring a `probe_echo` stdio MCP server; in an interactive grok session, confirm `grok inspect --json` lists it under `mcpServers` and the model can call it. If this fails, branch to fallback design (user-installed MCP via `~/.grok/.mcp.json`).
- [ ] 0.2 Validate P2: re-run the headless plugin-hook probe in an interactive TTY session. Document whether plugin hooks fire interactively. If they fire in neither mode, `memex doctor --install-hooks` will fall back to symlinking into `~/.grok/hooks/`.
- [ ] 0.3 Validate P3: once hooks fire (P2), confirm `${CLAUDE_PLUGIN_ROOT}` expands inside plugin hook scripts. If only `${GROK_PLUGIN_ROOT}` works, configure the build to substitute.
- [ ] 0.4 Track P4 (memex-core `canonicalProjectId`) in a coordinated change request against `jim80net/memex-core`; tag this change as blocked-on until it ships.
- [ ] 0.5 Track P5 (memex-claude `GROK_HOOK_EVENT` guard) in a coordinated change request against `jim80net/memex-claude`; tag this change as blocked-on until it ships.

## 1. Repo bootstrap

- [ ] 1.1 Create `package.json`, `tsconfig.json`, `build.ts`, `.npmrc`, `.gitignore` following memex-claude's layout. Pin `@jim80net/memex-core` to a version that has `canonicalProjectId`.
- [ ] 1.2 Create `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`.
- [ ] 1.3 Create empty `bin/memex` and `bin/memex.cmd` stubs (real implementation in §5).

## 2. Core scaffolding (cross-harness-integration spec — partial)

- [ ] 2.1 Create `src/core/paths.ts` exporting `getGrokPaths()` returning `~/.grok`-rooted paths plus `~/.local/share/memex` as the preferred sync repo. Tests first (cross-harness-integration spec → "Sync repo path policy").
- [ ] 2.2 Create `src/core/config.ts` defining `GrokRouterConfig` extending `MemexCoreConfig`, with `loadConfig()` reading `~/.grok/memex.json`. Tests for defaults + merge behavior first.
- [ ] 2.3 Create `src/core/memory-mapping.ts` calling `canonicalProjectId()` from memex-core and honoring `config.sync.projectMappings` overrides. Tests for the three resolution paths first (cross-harness-integration spec → "Project-id resolution honors memex-core canonical algorithm").

## 3. Hook runtime (hook-runtime spec)

- [ ] 3.1 Create `src/hooks/input.ts` with grok-wire-format → memex-core HookInput adapter: snake_case event enum table, camelCase → snake_case field mapping, `<user_query>` unwrap. Tests for each event + each field first (hook-runtime spec → "Grok wire-format adapter normalizes input").
- [ ] 3.2 Create `src/hooks/session-start.ts` (best-effort warm-up: sync-pull + cache-invalidate). Tests for the no-sync-enabled, sync-enabled-up-to-date, sync-enabled-needs-pull paths first (hook-runtime spec → "SessionStart hook is best-effort").
- [ ] 3.3 Create `src/hooks/injection-serializers.ts` with the `claude_hook_specific_output` serializer wired but unreachable (no grok format yet). Test that the registry returns the right serializer by name and that unknown names raise (hook-runtime spec → "Injection serializers are pluggable by wireFormat").
- [ ] 3.4 Create `src/hooks/user-prompt.ts`, `src/hooks/stop.ts`, `src/hooks/pre-compact.ts` — all dormant, all log-only when their config flag is false. Test the gating (hook-runtime spec → "Dormant hooks log only when their flag is false").
- [ ] 3.5 Create `src/main.ts` dispatching by `argv[2]` (`mcp`, `hook`, `sync`, `doctor`, `index`); for `hook`, dispatch by `hookEventName` after running through `input.ts` (hook-runtime spec → "Hook dispatcher routes by normalized event name").

## 4. MCP server (mcp-server spec)

- [ ] 4.1 Create `src/mcp/server.ts` with stdio JSON-RPC framing. Tests for initialize handshake, list_tools, call_tool first (mcp-server spec → "MCP server speaks stdio JSON-RPC").
- [ ] 4.2 Create `src/mcp/tools.ts` with the three tool implementations: `memex_search`, `memex_read_skill` (with `query_id` telemetry threading), `memex_status`. Tests for each tool first (mcp-server spec → "Tool surface", "Telemetry threading").
- [ ] 4.3 Implement first-call initialization inside `src/mcp/server.ts`: sync-pull (mtime-gated by `pullCacheMs`) + index-rebuild on first tool call of a process. Tests for the gating logic first (mcp-server spec → "First-call initialization").
- [ ] 4.4 Wire grok-native `memory_search` detection into the tool description (prepends "Use this BEFORE memory_search…" note when detected). Test the description rendering both ways (mcp-server spec → "Tool description differentiates from memory_search").

## 5. Bin stub + binary distribution (cross-harness-integration spec — continued)

- [ ] 5.1 Implement `bin/memex` POSIX shell stub: resolves platform, checks `~/.cache/memex-grok/<version>/<platform>/memex`, downloads + sha256-verifies if missing, exec's. Tests via a tmp `XDG_CACHE_HOME` fixture (cross-harness-integration spec → "Binary distribution").
- [ ] 5.2 Implement `bin/memex.cmd` for Windows with equivalent behavior.
- [ ] 5.3 Update `build.ts` to produce per-platform binaries under `dist/<platform>/` and a sha256sums file consumed by the stub.

## 6. Plugin manifests + hooks (cross-harness-integration spec)

- [ ] 6.1 Write `.mcp.json` declaring the `memex` server with `command: "${CLAUDE_PLUGIN_ROOT}/bin/memex"`, `args: ["mcp"]`. If P3 mandates `GROK_PLUGIN_ROOT`, the build emits the alternate form.
- [ ] 6.2 Write `hooks/hooks.json` declaring all four events (SessionStart active, UserPromptSubmit/Stop/PreCompact dormant) pointing at `${CLAUDE_PLUGIN_ROOT}/bin/memex hook`.

## 7. CLI commands (cross-harness-integration spec)

- [ ] 7.1 Implement `src/cli/doctor.ts` — checks: binary present and runnable, MCP registration (`grok inspect --json`), hook registration, sync repo location, canonical-id migration state, memex-claude coexistence-deferral state. Tests for each check first (cross-harness-integration spec → "Doctor command reports installation health").
- [ ] 7.2 Implement `src/cli/doctor.ts --migrate-repo` — interactive rename of `~/.local/share/memex-claude/` to `~/.local/share/memex/` with backward-compat symlink (cross-harness-integration spec → "Migration command renames sync repo safely").
- [ ] 7.3 Implement `src/cli/doctor.ts --install-hooks` — symlinks `hooks/hooks.json` into `~/.grok/hooks/memex-grok.json` as a global-scope fallback when plugin hooks don't fire (gated by `--force` if plugin hooks already fire).
- [ ] 7.4 Implement `src/cli/sync.ts` — one-shot `memex sync` for manual pull/push.
- [ ] 7.5 Implement `src/cli/index-cmd.ts` — `memex index --rebuild` to force reindex.

## 8. Bundled skills (bundled-skills spec)

- [ ] 8.1 Port `skills/sleep/SKILL.md` with read-only invariant against `~/.grok/memory/`; all writes to sync repo's `skills/` (bundled-skills spec → "Skills are read-only against grok-owned paths", "Sleep skill extracts MEMORY.md entries into searchable skills").
- [ ] 8.2 Port `skills/deep-sleep/SKILL.md` reading `~/.grok/memory/<slug>/sessions/` and grok session transcripts (bundled-skills spec → "Deep-sleep extracts learnings from past sessions").
- [ ] 8.3 Port `skills/reflect/SKILL.md` for single-session learning extraction.
- [ ] 8.4 Port `skills/doctor/SKILL.md` invoking `memex doctor`.
- [ ] 8.5 Port `skills/handoff/SKILL.md` adapted to grok session format.
- [ ] 8.6 Port `skills/takeover/SKILL.md` adapted to grok session format.
- [ ] 8.7 Port `skills/help/SKILL.md` referencing MCP tools.

## 9. End-to-end validation

- [ ] 9.1 Install `grok plugin install ./` from a local checkout, run an interactive grok session, ask a question that should match a fixture skill, verify the model calls `memex_search` and references the result.
- [ ] 9.2 Cross-harness test: populate a fixture skill via memex-claude session; confirm memex-grok session surfaces the same skill.
- [ ] 9.3 Coexistence test: install both memex-claude and memex-grok on grok; confirm hooks fire from memex-grok only (memex-claude exits on `GROK_HOOK_EVENT`).
- [ ] 9.4 Sync-repo-migration test: with both `~/.local/share/memex-claude/` and `~/.local/share/memex/` absent, install memex-claude (creates old path), then install memex-grok (defers to old path, suggests migration); run `memex doctor --migrate-repo`, confirm rename + symlink.

## 10. Release coordination

- [ ] 10.1 Tag v0.1.0 only after memex-core P4 and memex-claude P5 are shipped.
- [ ] 10.2 Publish to grok plugin marketplace with `grok plugin tag --push`.
- [ ] 10.3 Update README cross-links between memex-grok and memex-claude.
- [ ] 10.4 Archive this openspec change.
