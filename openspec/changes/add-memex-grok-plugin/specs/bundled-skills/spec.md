## ADDED Requirements

### Requirement: Skills are read-only against grok-owned paths

All bundled skills SHALL treat `~/.grok/memory/`, `~/.grok/sessions/`, and any other grok-owned state directory as read-only. Skills SHALL NOT modify files under those paths. All persistent outputs (extracted skills, rule files, learning summaries) SHALL be written to the sync repo (`<sync-repo>/skills/`, `<sync-repo>/rules/`, `<sync-repo>/projects/<canonical-id>/...`) or, in read-only-sync mode, to grok-local sibling paths under `~/.grok/memex/`.

#### Scenario: Sleep skill reads but does not modify MEMORY.md

- **WHEN** the user invokes the `sleep` skill against a workspace with a populated `~/.grok/memory/<slug>/MEMORY.md`
- **THEN** the skill reads the MEMORY.md, extracts entries, writes new skills to the sync repo (or `~/.grok/memex/skills/` in read-only-sync mode), and the MEMORY.md file's mtime is unchanged

#### Scenario: Deep-sleep does not modify session transcripts

- **WHEN** the user invokes `deep-sleep` against `~/.grok/memory/<slug>/sessions/`
- **THEN** session log files are read but not modified; extracted learnings are written to the sync repo

### Requirement: Sleep extracts MEMORY.md entries into searchable skills

The `sleep` skill SHALL parse `~/.grok/memory/<slug>/MEMORY.md` headings as discrete entries, identify candidates for promotion to skills (criteria: repeated reference, telemetry hit count above threshold, or explicit user marker), and write each promoted entry as a new `SKILL.md` under `<sync-repo>/skills/<topic>/`. Entries that remain in MEMORY.md SHALL be untouched.

#### Scenario: Promotion threshold creates a skill

- **GIVEN** a MEMORY.md entry under `## Debugging` has been matched by `memex_search` at least 5 times (per telemetry)
- **WHEN** `sleep` runs
- **THEN** a new `<sync-repo>/skills/debugging-<topic-slug>/SKILL.md` is created with the entry's content, a generated `description`, and `queries` derived from the matching telemetry queries

#### Scenario: Low-hit entries are left in MEMORY.md

- **GIVEN** an entry has 0 telemetry hits
- **WHEN** `sleep` runs with the default threshold of 3
- **THEN** the entry stays in MEMORY.md and no skill is created

### Requirement: Deep-sleep extracts learnings from past sessions

The `deep-sleep` skill SHALL read `~/.grok/memory/<slug>/sessions/*.md` files (per grok's session format), surface recurring patterns and unaddressed user corrections, and propose them as new entries for MEMORY.md or as new skills in the sync repo. The user SHALL confirm proposals interactively before any write.

#### Scenario: Recurring pattern is proposed as a skill

- **GIVEN** three sessions under `sessions/` all contain the user correcting the same tool-use pattern
- **WHEN** `deep-sleep` runs
- **THEN** the skill summarizes the pattern, proposes a new skill draft, and asks the user "Promote to sync repo? [y/N]"

#### Scenario: User declines proposal

- **WHEN** the user answers `N` to a proposal
- **THEN** no file is written

### Requirement: Doctor skill delegates to the binary

The `doctor` skill SHALL be a thin wrapper that invokes the `memex doctor` CLI and presents the output to the user. It SHALL NOT duplicate health-check logic.

#### Scenario: Doctor skill runs the CLI

- **WHEN** the user invokes the `doctor` skill
- **THEN** the skill runs `memex doctor` and displays its output verbatim

### Requirement: Handoff and takeover persist to the sync repo

The `handoff` skill SHALL produce a continuation plan document at `<sync-repo>/projects/<canonical-id>/handoffs/<ISO-timestamp>.md` (or `~/.grok/memex/projects/<grok-local-id>/handoffs/<ISO-timestamp>.md` in read-only-sync mode). The `takeover` skill SHALL locate the most recent handoff under that path, read it, and present the plan for the user to execute. Writing to the sync repo means handoffs created in one harness can be picked up in another, preserving cross-harness session continuity.

#### Scenario: Handoff writes to sync repo when writable

- **GIVEN** sync is enabled and the marker indicates a post-migration schema
- **WHEN** the user invokes `handoff` at the end of a session
- **THEN** a new file is written at `<sync-repo>/projects/<canonical-id>/handoffs/<ISO-timestamp>.md` containing the continuation plan; no files under `~/.grok/memory/` are modified

#### Scenario: Handoff falls back to grok-local when read-only-sync

- **GIVEN** sync is enabled but the marker indicates read-only-sync mode
- **WHEN** the user invokes `handoff`
- **THEN** the file is written at `~/.grok/memex/projects/<grok-local-id>/handoffs/<ISO-timestamp>.md`; no files under `~/.grok/memory/` are modified

#### Scenario: Takeover reads the latest handoff

- **WHEN** the user invokes `takeover` at the start of a new session
- **THEN** the skill searches both `<sync-repo>/projects/<canonical-id>/handoffs/` (if accessible) and `~/.grok/memex/projects/<grok-local-id>/handoffs/`, picks the most recent timestamp across both, presents its content, and prompts the user to proceed

#### Scenario: Cross-harness handoff is readable from grok

- **GIVEN** memex-claude wrote a handoff at `<sync-repo>/projects/<canonical-id>/handoffs/2026-05-25T12:00:00Z.md` during a Claude session
- **WHEN** the user opens a grok session in the same project and invokes `takeover`
- **THEN** the same handoff file is found, read, and presented

### Requirement: Help skill documents MCP tools

The `help` skill SHALL document the three MCP tools (`memex_search`, `memex_read_skill`, `memex_status`) and the bundled skills (`sleep`, `deep-sleep`, `reflect`, `doctor`, `handoff`, `takeover`). It SHALL also show how to find and edit the config at `~/.grok/memex.json`.

#### Scenario: Help lists tools and skills

- **WHEN** the user invokes the `help` skill
- **THEN** the output enumerates all three MCP tools (with their signatures) and all seven bundled skills (with one-line descriptions), and points to the config file path
