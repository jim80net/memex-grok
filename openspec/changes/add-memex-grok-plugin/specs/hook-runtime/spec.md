## ADDED Requirements

### Requirement: Grok wire-format adapter normalizes input

The hook input adapter (`src/hooks/input.ts`) SHALL accept grok's hook JSON envelope on stdin and produce a normalized `HookInput` object compatible with `@jim80net/memex-core`. It SHALL:

1. Map snake_case event values to PascalCase (`session_start` → `SessionStart`, `user_prompt_submit` → `UserPromptSubmit`, `pre_tool_use` → `PreToolUse`, `post_tool_use` → `PostToolUse`, `stop` → `Stop`, `pre_compact` → `PreCompact`, `session_end` → `SessionEnd`, `notification` → `Notification`).
2. Map camelCase field names to snake_case (`sessionId` → `session_id`, `toolName` → `tool_name`, `toolInput` → `tool_input`, etc.).
3. Preserve grok-only fields (`workspaceRoot`, `promptId`) without modification on the output object.
4. Unwrap the `prompt` field from any enclosing `<user_query>…</user_query>` envelope.

#### Scenario: UserPromptSubmit input is normalized

- **WHEN** the adapter receives `{"hookEventName":"user_prompt_submit","sessionId":"abc","cwd":"/repo","workspaceRoot":"/repo","promptId":"p1","prompt":"<user_query>\nhi\n</user_query>"}`
- **THEN** it returns `{ hook_event_name: "UserPromptSubmit", session_id: "abc", cwd: "/repo", workspaceRoot: "/repo", promptId: "p1", prompt: "hi" }`

#### Scenario: PreToolUse input preserves tool fields

- **WHEN** the adapter receives `{"hookEventName":"pre_tool_use","sessionId":"abc","toolName":"run_terminal_cmd","toolInput":{"command":"ls"}}`
- **THEN** it returns `{ hook_event_name: "PreToolUse", session_id: "abc", tool_name: "run_terminal_cmd", tool_input: { command: "ls" } }`

#### Scenario: Unknown event name is rejected

- **WHEN** the adapter receives an event name not in the mapping table
- **THEN** it writes a stderr error and exits non-zero (so the grok hook runner records a failure annotation)

### Requirement: Hook dispatcher routes by normalized event name

The `memex hook` subcommand SHALL read the grok hook envelope from stdin, pass it through the adapter, then dispatch to the appropriate handler by the normalized `hook_event_name`. Unknown events SHALL exit 0 with a stderr note (do not block the grok runner).

#### Scenario: SessionStart dispatches to session-start handler

- **WHEN** stdin contains a `session_start` envelope
- **THEN** `src/hooks/session-start.ts` runs and the process exits 0

#### Scenario: UserPromptSubmit dispatches when config enabled

- **WHEN** stdin contains a `user_prompt_submit` envelope and `config.hooks.UserPromptSubmit.enabled === true`
- **THEN** `src/hooks/user-prompt.ts` runs

#### Scenario: UserPromptSubmit short-circuits when config disabled

- **WHEN** stdin contains a `user_prompt_submit` envelope and `config.hooks.UserPromptSubmit.enabled === false`
- **THEN** the dispatcher exits 0 without running the handler

### Requirement: SessionStart hook is best-effort

The SessionStart hook handler SHALL eagerly perform the same sync-pull and cache-invalidation work the MCP server would otherwise do on first call. The MCP server SHALL function correctly even if the hook never fires. Hook failure SHALL NOT prevent the MCP server from serving subsequent tool calls.

#### Scenario: Hook fires and warms cache

- **WHEN** the SessionStart hook runs and sync is enabled
- **THEN** the sync repo is pulled (subject to `pullCacheMs` gating), the cache mtime is touched, and the next MCP `memex_search` skips its own init

#### Scenario: Hook never fires — MCP still works

- **GIVEN** plugin hooks do not fire in this grok version
- **WHEN** the client issues `memex_search` against the MCP server
- **THEN** the MCP server performs first-call init itself and serves the search

### Requirement: Dormant hooks log only when their flag is false

UserPromptSubmit, Stop, and PreCompact hook handlers SHALL be config-gated. When their `enabled` or `injectAdditionalContext` (UserPromptSubmit only) flag is false, the handler SHALL compute matches (so telemetry can still log them) but emit nothing to stdout beyond an empty `{}`, and write a single one-line summary to stderr.

#### Scenario: Dormant UserPromptSubmit logs match count

- **GIVEN** `config.hooks.UserPromptSubmit.injectAdditionalContext === false` and the corpus has 2 skills matching the prompt
- **WHEN** the dispatcher runs the handler
- **THEN** stderr contains a line like `memex: matched 2 — context injection not yet honored by grok` and stdout is empty (or `{}`)

#### Scenario: Dormant Stop hook is a no-op until enabled

- **GIVEN** `config.hooks.Stop.enabled === false`
- **WHEN** a `stop` event arrives
- **THEN** the handler exits 0 immediately with a stderr note `memex: Stop handler dormant`; no extraction or rule emission runs

### Requirement: Injection serializers are pluggable by wireFormat

`src/hooks/injection-serializers.ts` SHALL expose a `serialize(matches, wireFormat)` function that selects an implementation by name. The default registered name is `claude_hook_specific_output` (today's Claude convention: `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"…"}}`). Adding support for grok's eventual injection format SHALL be a new entry in the registry (typically 10–20 lines), not a modification of existing call sites.

#### Scenario: claude_hook_specific_output serializer wraps correctly

- **WHEN** `serialize([{ name: "deploy", description: "..." }], "claude_hook_specific_output")` is called
- **THEN** the returned string parses as JSON, has key `hookSpecificOutput.hookEventName === "UserPromptSubmit"`, and the `additionalContext` value contains the skill descriptions

#### Scenario: Unknown wireFormat raises

- **WHEN** `serialize(matches, "no_such_format")` is called
- **THEN** the function throws an Error naming the unknown format and listing registered names

#### Scenario: Activation is one config flip plus one serializer entry

- **GIVEN** a hypothetical grok release introduces a wire format `grok_native_v1` requiring `{"contextAddendum":"…"}` payloads
- **WHEN** a new entry is added to the registry mapping `"grok_native_v1"` → serializer function, and the user sets `config.hooks.UserPromptSubmit.wireFormat: "grok_native_v1"` + `injectAdditionalContext: true`
- **THEN** the existing handler in `src/hooks/user-prompt.ts` requires no changes; it calls `serialize(matches, config.wireFormat)` and emits the result
