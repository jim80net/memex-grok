## ADDED Requirements

### Requirement: MCP server speaks stdio JSON-RPC per Model Context Protocol

The `memex mcp` subcommand SHALL implement an MCP stdio server: it reads JSON-RPC 2.0 messages line-delimited on stdin, writes responses on stdout, and reserves stderr for diagnostics. It SHALL respond to `initialize`, `tools/list`, and `tools/call` per the MCP spec.

#### Scenario: Initialize handshake returns advertised capabilities

- **WHEN** the client sends `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}`
- **THEN** the server replies with `serverInfo.name = "memex"`, a `protocolVersion`, and `capabilities.tools = {}`

#### Scenario: tools/list returns memex_search, memex_read_skill, memex_status

- **WHEN** the client sends `{"jsonrpc":"2.0","id":2,"method":"tools/list"}`
- **THEN** the response contains exactly three tools by name: `memex_search`, `memex_read_skill`, `memex_status`

### Requirement: Server lifecycle

The MCP server SHALL be spawned exactly once per grok session by the MCP loader, remain alive for the duration of the session, perform first-call initialization at most once, and exit cleanly on stdin EOF. The server SHALL NOT spawn child processes for tool calls; all tool calls SHALL be handled in the original process.

#### Scenario: Single process for the session

- **GIVEN** the MCP server starts at session begin
- **WHEN** the model issues five successive tool calls
- **THEN** the same process serves all five (verifiable by stable PID in stderr diagnostic lines), and no fork/spawn occurs per call

#### Scenario: EOF triggers clean shutdown

- **GIVEN** the MCP server is running
- **WHEN** stdin reaches EOF (grok closes the channel at session end)
- **THEN** the server flushes any pending stderr, completes any in-flight tool call, and exits 0 within 1 second

#### Scenario: Init runs at most once per process

- **GIVEN** first-call init has already run for the current process
- **WHEN** a subsequent tool call arrives
- **THEN** the init logic is skipped (no `git pull`, no full index rebuild) — only incremental cache freshness checks run

### Requirement: Tool surface

The MCP server SHALL expose exactly three tools to the model — `memex_search`, `memex_read_skill`, and `memex_status` — with the following contracts. No `memex_record_match` tool SHALL be exposed; telemetry is recorded implicitly per the "Telemetry threading" requirement.

#### Scenario: memex_search returns query_id plus results

- **WHEN** the client calls `memex_search` with `{ query: "deploy spark", top_k: 3 }`
- **THEN** the response is `{ query_id: <opaque string>, results: [{ name, type, location, relevance, description, best_query_index }, ...] }` with at most 3 entries above the threshold

#### Scenario: memex_read_skill returns full content

- **WHEN** the client calls `memex_read_skill` with `{ location: "<absolute-path-to-SKILL.md>" }`
- **THEN** the response contains the full UTF-8 content of the file

#### Scenario: memex_status reports installation state

- **WHEN** the client calls `memex_status`
- **THEN** the response includes `index_size`, `source_counts` (by type), `last_sync_at` (ISO-8601 or null), `sync_enabled` (boolean), `embedding_model` (string)

#### Scenario: memex_search returns empty results on empty corpus

- **GIVEN** the SkillIndex has zero indexed entries
- **WHEN** the client calls `memex_search` with any non-empty query
- **THEN** the response is `{ query_id: <opaque string>, results: [] }` — this is success, not an error

#### Scenario: memex_search returns empty results when no match clears threshold

- **GIVEN** the SkillIndex has entries but none score above the requested `threshold`
- **WHEN** `memex_search` is called
- **THEN** the response is `{ query_id: <opaque string>, results: [] }` — no error, no partial-result heuristic

#### Scenario: memex_search rejects empty query

- **WHEN** the client calls `memex_search` with `{ query: "" }` or whitespace-only
- **THEN** the server returns a JSON-RPC error with `code: -32602` (invalid params) and `message: "query must be non-empty"`

### Requirement: Telemetry threading via query_id

`memex_search` SHALL generate a stable per-call `query_id` and include it in the response. `memex_read_skill` SHALL accept an optional `query_id` argument; when provided, the server SHALL record a telemetry match for `(location, query_id, session_id)` so GEPA-style query refinement works without requiring a separate model-issued telemetry tool call.

#### Scenario: query_id flows from search to read

- **WHEN** the model calls `memex_search` (returns `query_id: "q-123"`), then calls `memex_read_skill` with `{ location: "/path/skill.md", query_id: "q-123" }`
- **THEN** the telemetry store records a match entry for `(location: "/path/skill.md", query_id: "q-123", session_id: <current>)`

#### Scenario: missing query_id is non-fatal

- **WHEN** the model calls `memex_read_skill` without `query_id`
- **THEN** the call succeeds and returns the content; no telemetry entry is recorded

### Requirement: First-call initialization

On the first tool call of a process lifetime (not per-request), the MCP server SHALL: (a) if `config.sync.enabled && config.sync.autoPull` and the sync repo's `.git/FETCH_HEAD` mtime is older than `config.sync.pullCacheMs` (default 5 minutes), run `git pull --rebase`; (b) rebuild the SkillIndex if any source-dir mtime changed since the cache's `built_at`. The tool call SHALL be served after init completes. Subsequent tool calls SHALL NOT repeat the init.

#### Scenario: First call triggers sync + index rebuild

- **GIVEN** sync is enabled, last pull was 1 hour ago, and a new skill was added to `~/.grok/skills/` since the last cache build
- **WHEN** the first `memex_search` call arrives
- **THEN** the server runs `git pull --rebase`, rebuilds the index (the new skill is included), and only then serves the search

#### Scenario: Subsequent calls skip init

- **GIVEN** the first call already initialized
- **WHEN** a second `memex_search` arrives within the same process
- **THEN** no sync-pull is attempted and the index is reused

#### Scenario: SessionStart hook runs init eagerly when it fires

- **GIVEN** the SessionStart hook fires before any MCP call
- **WHEN** the first MCP call arrives
- **THEN** the init work is a no-op (hook already did it)

### Requirement: Tool description differentiates from memory_search

The tool description for `memex_search` SHALL explicitly differentiate from grok's native `memory_search` to avoid the model picking arbitrarily. When the MCP server detects (via initialize-handshake metadata or a configured probe) that `memory_search` is available in the session, the description SHALL prepend a guidance line: *"Use this BEFORE `memory_search` for any question that might be answered by a durable skill or rule."*

#### Scenario: Description always includes differentiation

- **WHEN** the client calls `tools/list`
- **THEN** the description for `memex_search` contains the substring "different from `memory_search`" and explains that memex covers cross-harness durable knowledge while memory_search covers per-workspace conversational history

#### Scenario: memory_search-aware preamble when detected

- **GIVEN** the server was started in an environment where `memory_search` is known to be present
- **WHEN** the client calls `tools/list`
- **THEN** the `memex_search` description prepends "Use this BEFORE `memory_search`..."
