## ADDED Requirements

### Requirement: Project-id resolution honors memex-core canonical algorithm

`src/core/memory-mapping.ts` SHALL resolve a project's sync-repo identifier by calling `canonicalProjectId(cwd)` from `@jim80net/memex-core`. It SHALL honor explicit overrides from `config.sync.projectMappings[<local-id>] = <canonical-id>` (taking precedence over the algorithm).

#### Scenario: Project with git remote uses canonical algorithm

- **GIVEN** a cwd inside a git repo whose `origin` is `git@github.com:jim80net/memex-grok.git`
- **WHEN** `resolveCanonicalId(cwd, config)` is called with no overrides
- **THEN** the result is the value returned by `memex-core`'s `canonicalProjectId(cwd)` for the same cwd

#### Scenario: Manual override wins

- **GIVEN** `config.sync.projectMappings = { "<grok-local-id-for-cwd>": "my-org/my-project" }`
- **WHEN** `resolveCanonicalId(cwd, config)` is called
- **THEN** the result is `"my-org/my-project"` regardless of what `canonicalProjectId` would return

### Requirement: Read-only-sync mode until canonical-id migration completes

memex-grok SHALL detect whether the sync repo's project-id schema has been migrated (via the same `.memex-sync/version.json` marker memex-core writes). If the marker indicates schema version < required, memex-grok SHALL operate in read-only-sync mode: reads from `<sync-repo>/projects/` are best-effort (with case-insensitive fallback to legacy IDs), writes go only to grok-local paths.

#### Scenario: Pre-migration repo is readable, not writable

- **GIVEN** the sync repo's `.memex-sync/version.json` reports an unmigrated schema
- **WHEN** the user invokes a bundled skill that would normally write a new entry under `<sync-repo>/projects/`
- **THEN** the entry is written to the corresponding grok-local path instead, and `memex doctor` reports that the user should run `memex-claude doctor --migrate-project-ids` (or equivalent) to enable writes

#### Scenario: Post-migration repo is fully read/write

- **GIVEN** the sync repo's `.memex-sync/version.json` reports the required schema version
- **WHEN** the user invokes a bundled skill that writes
- **THEN** the write goes to `<sync-repo>/projects/<canonical-id>/...` and is git-committed normally

#### Scenario: Reader fallback finds legacy IDs in pre-migration repo

- **GIVEN** the sync repo contains a legacy `<sync-repo>/projects/<old-encoded-id>/memory/notes.md` and no canonical counterpart
- **WHEN** the SkillIndex scans the sync repo for the current cwd
- **THEN** the legacy notes.md is included in the index (case-insensitive probe)

### Requirement: Sync repo path policy

memex-grok SHALL prefer `~/.local/share/memex/` for the sync repo. It SHALL NOT create that directory if `~/.local/share/memex-claude/` exists and is a non-empty git repository — instead it SHALL transparently use the existing `memex-claude/` path and log a one-line suggestion to run `memex doctor --migrate-repo`. The `config.sync.repoDir` setting SHALL override the default.

#### Scenario: Neither path exists — new install

- **GIVEN** neither `~/.local/share/memex/` nor `~/.local/share/memex-claude/` exists
- **WHEN** sync is enabled and a sync operation initializes the repo
- **THEN** the repo is created at `~/.local/share/memex/`

#### Scenario: Only memex-claude path exists — coexist, suggest migration

- **GIVEN** `~/.local/share/memex-claude/` exists with at least one commit, `~/.local/share/memex/` does not exist
- **WHEN** memex-grok starts and computes the effective sync path
- **THEN** the effective path is `~/.local/share/memex-claude/` and stderr contains a one-line note suggesting `memex doctor --migrate-repo`

#### Scenario: Both paths exist — config.sync.repoDir wins or warn

- **GIVEN** both paths exist
- **WHEN** memex-grok starts
- **THEN** if `config.sync.repoDir` is set, it is honored; otherwise the user-facing log warns that two paths exist and recommends consolidation

#### Scenario: Explicit config override

- **GIVEN** `config.sync.repoDir = "/custom/sync/path"`
- **WHEN** any sync operation runs
- **THEN** that path is used regardless of which defaults exist

### Requirement: Migration command renames sync repo safely

`memex doctor --migrate-repo` SHALL perform an interactive, reversible rename of `~/.local/share/memex-claude/` to `~/.local/share/memex/`, leaving a symbolic link at the old path pointing to the new location. The command SHALL refuse to run destructively (no `rm -rf` of either path) and SHALL preserve all git history.

#### Scenario: Migration prompts before acting

- **WHEN** `memex doctor --migrate-repo` runs with both paths absent
- **THEN** it prints a no-op message and exits 0

#### Scenario: Migration renames and symlinks

- **GIVEN** `~/.local/share/memex-claude/` exists with git history and `~/.local/share/memex/` does not exist
- **WHEN** `memex doctor --migrate-repo` is run and the user confirms
- **THEN** the directory is renamed (via `git mv` for tracked content, or `mv` for the workdir as appropriate) to `~/.local/share/memex/`, and a symbolic link is created at `~/.local/share/memex-claude/` pointing to `~/.local/share/memex/`

#### Scenario: Migration refuses when destination has unrelated content

- **GIVEN** `~/.local/share/memex/` exists and is not a symlink to `memex-claude/`
- **WHEN** `memex doctor --migrate-repo` is run
- **THEN** the command refuses with an error explaining the situation; no files are touched

### Requirement: Coexistence guard relies on memex-claude detecting GROK_HOOK_EVENT

memex-grok SHALL NOT include any guard for being launched on Claude Code (that scenario is unsupported). The reciprocal guard — memex-claude exiting 0 when `GROK_HOOK_EVENT` is set — is tracked as a coordinated change against `jim80net/memex-claude` (prerequisite P5 in `proposal.md`). `memex doctor` SHALL detect whether memex-claude is installed in the grok environment and report whether the deferral is active (by inspecting the memex-claude version for the guard).

#### Scenario: Doctor reports memex-claude not installed

- **GIVEN** no memex-claude plugin is discoverable via `grok inspect --json`
- **WHEN** `memex doctor` runs
- **THEN** the output includes `memex-claude: not installed (no coexistence concern)`

#### Scenario: Doctor reports memex-claude with deferral active

- **GIVEN** memex-claude is installed and reports a version >= the guard release
- **WHEN** `memex doctor` runs
- **THEN** the output includes `memex-claude: installed, defers on GROK_HOOK_EVENT (OK)`

#### Scenario: Doctor reports memex-claude pre-guard version

- **GIVEN** memex-claude is installed at a version older than the guard release
- **WHEN** `memex doctor` runs
- **THEN** the output includes `memex-claude: installed, but version <X> does NOT defer — hooks may double-fire; please upgrade memex-claude to >= <guard-version>`

### Requirement: Binary distribution via POSIX shell stub

`bin/memex` (and `bin/memex.cmd` on Windows) SHALL be a small committed script — NOT a binary. On invocation it SHALL: detect the platform, check for the cached platform binary at `${XDG_CACHE_HOME:-$HOME/.cache}/memex-grok/<version>/<platform>/memex`, download + sha256-verify it from the GitHub release if missing, then exec the cached binary with the original arguments. The stub SHALL NOT require any post-install hook to run; it is sufficient for `grok plugin install` to put the stub in place.

#### Scenario: Cached binary is used directly

- **GIVEN** the platform binary already exists in the cache with the right sha256
- **WHEN** `bin/memex mcp` is invoked
- **THEN** the stub exec's the cached binary with `mcp` as its argument; no network access occurs

#### Scenario: First-run downloads and verifies

- **GIVEN** the cache is empty
- **WHEN** `bin/memex mcp` is invoked
- **THEN** the stub downloads the binary for the detected platform from the release URL, verifies its sha256 against a `sha256sums` file shipped at the same URL, places it in the cache, and exec's it

#### Scenario: Sha256 mismatch aborts

- **GIVEN** the downloaded binary's sha256 does not match the expected value
- **WHEN** the stub runs
- **THEN** the stub deletes the partial download, writes a clear error to stderr, and exits non-zero — it does NOT exec a possibly-tampered binary

### Requirement: Doctor command reports installation health

`memex doctor` SHALL output a structured health report covering at minimum: binary presence and version, MCP server registration in `grok inspect --json`, hook registration and firing state, `${CLAUDE_PLUGIN_ROOT}` expansion status, sync repo location and schema-version state, and memex-claude coexistence deferral state.

#### Scenario: Doctor exits 0 when healthy

- **GIVEN** all checks pass
- **WHEN** `memex doctor` runs
- **THEN** every line is prefixed with `OK:` and the process exits 0

#### Scenario: Doctor exits non-zero on degraded state

- **GIVEN** at least one critical check fails (e.g., binary missing, MCP not registered)
- **WHEN** `memex doctor` runs
- **THEN** failing lines are prefixed with `FAIL:`, advisory lines with `WARN:`, and the process exits 1 if any FAIL is present
