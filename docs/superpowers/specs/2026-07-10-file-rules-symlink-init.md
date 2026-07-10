# memex-grok addendum — file-shaped rules via shared-origin symlinks

**Date:** 2026-07-10  
**Status:** design gated (#30) + core `@jim80net/memex-core@0.6.0` freeze — **implementation in progress / adapter PR**  

**Authority:** operator product steer + flotilla brief `file-rules-shared-origin-2026-07-10.md` (`flotilla-dispatch-c29001c1`)  
**Parent design:** [`2026-05-25-memex-grok-design.md`](./2026-05-25-memex-grok-design.md) (D1 MCP-primary, D3 dormant hooks, D5/D6 sync safety)  
**Core peer:** memex-core design `design/shared-origin-sync-profile.md` (**expected; may land in parallel** — grok **must not** invent a parallel origin layout)  
**Scope:** memex-grok only. Author ≠ merger; surface PRs to **memex** for gate/merge.

---

## 0. Bottom line

Grok cannot rely on opportunistic live injection (verified; D1/D3; doctor WARN today). This chapter makes **rules first-class files** under harness dirs (user `~/.grok/rules`, project `.grok/rules`), **materialized as symlinks into a shared memex origin** so provenance is `readlink`-obvious. **Memory stays tool-call first-class** via MCP (`memex_search` / `memex_read_skill` / `memex_status`). Hooks inject remains **dormant by design**. memex-hermes **#21 inject-gap is not the primary design** for this chapter and must not drive new inject surfaces here.

**Impl gate:** designs (core + this addendum) pass memex systems-review → core ships origin + sync-profile primitives with tests → grok ships `init`/`sync` projection + doctor checks → dogfood on **grok-research** → MCP live loop regressions still green.

---

## 1. Why this addendum (problem today)

Verified against the current tree on `main` (`20e216a` family):

| Gap | Code / evidence |
|-----|-----------------|
| Hooks inject dormant | `src/cli/doctor.ts` `checkHooks()` — WARN: “dormant by design (D1/D3) — MCP is the primary surface” |
| Plan 3 sync stubbed | `src/main.ts`: `sync` / `index` / `hook` → “not yet implemented” |
| Rules dirs listed, not managed as origin→symlink | `src/core/paths.ts`: `globalRulesDirs = [~/.grok/rules]`; `getProjectRulesDirs(cwd) = [cwd/.grok/rules]` — scan only |
| Sync repo is a **read path for the index**, not a harness projection | `src/core/index-init.ts`: if `config.sync.enabled`, appends `syncRepoDir/rules` to `ruleDirs`; does **not** write into `~/.grok/rules` |
| Default sync path + legacy deferral | `paths.ts` `syncRepoDir = ~/.local/share/memex`; doctor defers to `~/.local/share/memex-claude` when canonical path missing (D6) |
| Config “sync profile” is thin | `GrokSyncConfig` = core `SyncConfig` + optional `repoDir`; `enabled` defaults **false**; no origin/projection fields |

Operator product direction for this chapter supersedes “inject-first” framing for Grok: **file rules + MCP memory** are the load-bearing surfaces.

---

## 2. Goals and non-goals

### Goals (Grok adapter slice)

| ID | Goal |
|----|------|
| **G1** | When harness rules are missing **and** a sync profile is set: **init** the harness rules dir and **symlink** entries from shared origin → harness path so `readlink` shows origin. |
| **G2** | Never copy-only without an origin pointer; never clobber real (non-link) files — **fail closed / WARN-skip**. |
| **G3** | Doctor checks: origin present, projected rules are links into origin, conflict reporting, messaging that **memory = tools you call** (not inject). |
| **G4** | Depend on **memex-core** shared-origin + sync-profile primitives — **do not fork** a parallel origin layout in memex-grok. |
| **G5** | Preserve MCP live-loop regression tests as acceptance (`test/integration/launch-path.test.ts` and related MCP suite). |

### Non-goals (this chapter)

- Skill/rule **refinement feedback loops** (operator deferred; leave seams open).
- Full fleet-memory **centroid / audience** decision (memex-hermes #20 still awaiting-auth) — origin starts **host-local private**; do not dump private constitution into a shareable remote until decided.
- Replacing MCP with filesystem-only memory for Grok.
- New inject path / reopening hermes #21 as primary Grok design.
- Mass-migrating other adapters (claude/codex/hermes/openclaw) — alignment tickets after grok+core land.
- Whole Plan 3 memoryDirs / project write path (still gated by D5 canonical-id policy where writes apply); this chapter focuses **rules projection**, not memory corpus writes into harness dirs.

---

## 3. Dependency on memex-core (contract boundary)

memex-grok is a **thin projection adapter**. Core owns origin truth; grok owns harness paths and CLI/doctor UX.

### 3.1 Core must provide (do not reimplement in grok)

Exact names/paths are owned by the core design; grok **consumes** these shapes:

1. **`originRoot` resolution**  
   Canonical shared origin on disk (git-backed sync corpus or local-only). Layout subtrees at least: `rules/`, `skills/`, and eventually scope buckets from three-tier SCOPE (`fleet/`, `flotillas/…`, `projects/…`) — core owns the tree.

2. **`SyncProfile` (or extension of `SyncConfig`)** — harness-neutral fields such as:
   - `enabled: boolean`
   - `repo?: string` (remote; optional for local-only origin)
   - origin path override
   - **projection enable flags** (which harnesses / which artifact classes: rules, skills)
   - project mappings (existing)
   - autoPull / autoCommitPush (existing)

3. **Lifecycle FS ops (pure, testable without a harness):**
   - Ensure origin exists / is a git repo (today: `initSyncRepo` in `src/sync.ts` — extend, don’t parallel).
   - **Materialize entry into origin** (write rule under origin; optional commit if git-backed) — refinement loops later.
   - **Symlink policy primitives:** create link if target absent; if destination is already a correct link → no-op; if destination is a real file/dir or a wrong link → **conflict** result (no clobber).
   - Golden tests in core for symlink policy (pure FS).

4. **Provenance helpers** (optional but preferred): “is this path a link into `originRoot`?” for doctor/adapters.

### 3.2 Grok must not

- Invent `~/.memex-grok-origin` or a second rules corpus.
- Copy origin content into `~/.grok/rules` without links.
- Treat inject as a substitute for projection.
- Change MCP tool semantics as part of this chapter (search/read/status remain).

### 3.3 Sequencing

```
memex-core design (shared-origin + SyncProfile)  ──gate──►  core impl + tests
        │                                                         │
        ▼                                                         ▼
memex-grok this addendum  ──gate──►  grok impl on published core API
        │
        └── coordinate freeze-SHA with memex XO when core contract ships
```

**Blocker marker:** if core design is not opened/PR’d, grok design can still merge as **intent + adapter mapping**, but **implementation PRs are blocked** until core primitives exist at a pin-able version (`@jim80net/memex-core`).

---

## 4. Answers to brief open questions (§6)

These are **Grok-side recommendations** for the dual design; core may tighten names but must not strand existing dogfood paths without a migration story.

### Q1 — Origin default path: `~/.memex` vs `~/.local/share/memex`?

**Recommendation: keep XDG-style `~/.local/share/memex` as the default origin root.**

Evidence:

- `getGrokPaths().syncRepoDir` already uses `~/.local/share/memex` (`src/core/paths.ts`).
- Parent design D6 and doctor legacy path already coordinate around that tree + `~/.local/share/memex-claude`.
- Introducing bare `~/.memex` as a *third* default creates another silent-divide risk (exactly what D6 prevents).

Core may expose a logical name `originRoot` whose default is `~/.local/share/memex`, with optional override. If core standardizes on `~/.memex` later, migration is a core concern (symlink or doctor migrate), not a grok-only rename.

### Q2 — Symlink granularity: whole `rules/` dir vs per-file?

**Recommendation: per-entry links under an owned harness directory; not a single wholesale dir-replace of `~/.grok/rules`.**

| Policy | Rationale |
|--------|-----------|
| Ensure harness dir exists (`mkdir -p ~/.grok/rules`, `mkdir -p <cwd>/.grok/rules`) | Init when missing |
| For each **managed** origin entry selected by profile/scope: `ln -s` (or relative link) into harness dir | `readlink` → origin; mixed local-only files can coexist if not managed |
| Never `rm` a non-link destination | Clobber protection |
| Optional future: whole-dir link **only** if dir is absent (not if empty with locals) | Documented escape hatch; not v1 default |

Managed set for v1: **global/fleet rules** → `~/.grok/rules`; **desk/project rules** → `<cwd>/.grok/rules`. Exact origin subpaths come from core SCOPE layout when present; until three-tier lands, origin `rules/` projects to user harness rules, and `projects/<id>/rules/` (if present) to project harness rules.

### Q3 — User `~/.grok/rules` vs project `.grok/rules`?

**Both.** Profile selects **which origin scopes** project where:

| Harness path | Origin source (proposed) |
|--------------|--------------------------|
| `~/.grok/rules/*` | Origin fleet/global `rules/` (and/or root `rules/` until SCOPE layout ships) |
| `<cwd>/.grok/rules/*` | Origin `projects/<canonical-id>/rules/` when resolvable; else skip project projection with doctor WARN |

Skills projection (`~/.grok/skills`, project `.grok/skills`) is the **same pattern** but can ship after rules if needed to keep the first PR small; design allows it.

### Q4 — Interaction with `~/.local/share/memex-claude`?

**Reuse D6; do not invent dual origins.**

1. Effective origin = `config.sync.repoDir` override, else `paths.syncRepoDir` (`~/.local/share/memex`), else if missing and legacy `~/.local/share/memex-claude` exists → **effective origin = legacy** (doctor WARN + migrate messaging).
2. Projection always links into the **effective** origin.
3. `memex doctor --migrate-repo` remains the opt-in rename path (Plan 3 / parent design); this chapter does not re-specify migrate mechanics beyond “origin is single”.

### Q5 — What does “sync profile set” mean?

**v1 definition (Grok):** a profile is **set** when:

```text
config.sync.enabled === true
  AND effective origin is resolvable (path exists OR can be created by initSyncRepo when repo is configured)
  AND projection for rules is not explicitly disabled (default: enabled when sync.enabled)
```

Sources of truth (priority):

1. `MEMEX_CONFIG` / `~/.grok/memex.json` `sync` block (primary).
2. Env overrides only for path/debug (`MEMEX_CONFIG`, optional future `MEMEX_ORIGIN` if core defines it) — not a second schema.
3. Flotilla desk binding — **out of scope for v1**; may set the same `memex.json` fields at desk provision time later.

`sync.enabled: false` (today’s default) → **no init/symlink automation**; doctor continues advisory messaging. Dogfood desks flip `enabled: true` and set `repo` / origin as needed.

---

## 5. CLI: `memex init` and `memex sync`

Today (`src/main.ts`): only `mcp`, `doctor`, `--version` are live; `sync` is a stub.

### 5.1 `memex init` (new)

**Purpose:** one-shot ensure origin + project harness rules (and optionally skills) as symlinks. Safe to re-run (idempotent).

**Steps (conceptual):**

1. Load config (`loadConfig()`).
2. If profile not set → print guidance (enable `sync.enabled` / set origin); exit 0 with non-action or exit 2 with “profile not set” (choose **exit 0 + clear message** for ergonomics; doctor carries WARN).
3. Resolve **effective origin** via core helper (honor D6 legacy).
4. Call core: ensure origin (init/clone/migrate marker as core defines).
5. Ensure harness dirs:
   - user: `~/.grok/rules` (from `getGrokPaths().globalRulesDirs[0]`)
   - project: `getProjectRulesDirs(cwd)[0]` when cwd provided (default `process.cwd()`)
6. For each managed origin entry → core symlink op into harness dir.
7. Print summary: created / already-linked / **conflicts** (paths that were real files).
8. Exit **1** if any conflict when `--strict`; default exit **0** with conflicts listed (operator-visible; doctor will WARN). Prefer `--strict` in CI/dogfood scripts.

**Flags (proposed):** `--cwd <path>`, `--strict`, `--json`, `--dry-run`.

### 5.2 `memex sync` (un-stub Plan 3 slice for this chapter)

**Purpose:** pull origin (if remote configured) then **re-project** symlinks (init projection). Not a full memory write path.

**Steps:**

1. Same profile gate as init.
2. Core `syncPull` (existing) / refresh origin.
3. Re-run projection (same as init steps 5–7).
4. Do **not** require index rebuild for success; optional note that next MCP call rebuilds index on mtime (existing first-call init).

**Out of this chapter’s sync:** auto-commit of new local rules into origin, GEPA refinement, Stop-hook learnings.

### 5.3 Usage surface update

```
subcommands:
  mcp
  doctor [--json]
  init [--cwd] [--strict] [--dry-run] [--json]   # this chapter
  sync [--cwd] [--strict] [--dry-run] [--json]   # this chapter (pull + project)
  --version
planned later:
  hook, index --rebuild, full write-path sync
```

---

## 6. Index / scan interaction (avoid double-counting)

Today `buildScanDirs` may list both `~/.grok/rules` **and** `origin/rules` when `sync.enabled`.

**When projection mode is active** (profile set + rules projection on):

- **Scan harness rule dirs only** for the projected scopes (links resolve to origin content).
- **Do not also append raw `origin/rules`** for the same entries (prevents duplicate index hits).
- Until projection has been run, first MCP call may still see empty harness dirs — **first-call path** should either:
  - (preferred) call the same projection helper once (idempotent), or
  - fall back to scanning origin directly **only if** harness rules dir is missing/empty and no conflicts, with a stderr one-liner “projection not yet run; scanning origin directly — run `memex init`”.

Documented invariant: **one content blob → one index entry**.

MCP tools and portable-location handles continue to resolve through existing location machinery; symlink targets that live under origin remain valid read targets for `memex_read_skill`.

---

## 7. Doctor checks (this chapter)

Add / extend checks in `src/cli/doctor.ts` (still severity OK/WARN/FAIL; WARN-only → exit 0).

| Check name | When | Severity guidance | Message intent |
|------------|------|-------------------|----------------|
| `shared-origin` | always | OK if effective origin exists; WARN if missing and profile set; WARN if legacy deferral | Origin present / legacy / not initialized |
| `rules-projection-user` | profile set | OK if managed entries are symlinks into origin; WARN if dir missing (“run memex init”); WARN listing **real-file conflicts** | Links + no clobber |
| `rules-projection-project` | profile set + cwd/project context available | same as user for `.grok/rules` | Project links |
| `hooks` | always | WARN (unchanged) | Dormant by design D1/D3 |
| `memory-surface` | always (new or folded into hooks/mcp messaging) | OK if MCP tools enabled in config; WARN if `mcp.enabled === false` | **“memory = MCP tools you call (memex_search / memex_read_skill / memex_status), not inject”** |

Host-path egress: all new messages must pass existing `scrubHostPaths` / `assertNoHostPathLeaks` (issue #13 family).

Do **not** FAIL the install solely because projection was never run — that is advisory until dogfood SLAs say otherwise. FAIL remains for broken binary etc.

---

## 8. Config shape (adapter-facing; core owns canonical types)

Illustrative `~/.grok/memex.json` after this chapter (fields beyond today’s `SyncConfig` land when core exports them; grok may temporarily accept a thin local extension **only** if core pin lags — prefer waiting for core):

```jsonc
{
  "sync": {
    "enabled": true,
    "repo": "git@github.com:example/memex-corpus.git", // optional
    "repoDir": null,          // override origin root; default ~/.local/share/memex
    "autoPull": true,
    "autoCommitPush": false,  // writes into origin still careful under D5
    "projectMappings": {},
    // core SyncProfile extensions (names illustrative):
    "projectRules": true,     // project ~/.? .grok/rules projection
    "projectSkills": false    // optional follow-on
  },
  "mcp": {
    "enabled": true,
    "tools": ["memex_search", "memex_read_skill", "memex_status"]
  },
  "hooks": {
    "UserPromptSubmit": {
      "injectAdditionalContext": false   // STAYS false; not this chapter
    }
  }
}
```

**Invariant:** nothing in this chapter sets `injectAdditionalContext: true` or adds a new inject serializer path.

---

## 9. Explicit non-design: inject / #21

| Item | Stance |
|------|--------|
| hermes #21 inject-gap | Non-primary for Grok; may remain a future **push** experiment on other harnesses |
| UserPromptSubmit inject | Remains dormant (D1/D3); doctor wording reinforced |
| New ambient inject | **Out of scope** — reject in review if it appears |
| Memory delivery | MCP tool calls the model chooses |

---

## 10. Dogfood plan — grok-research

**Target desk:** fleet desk **grok-research** (operator dogfood host; Grok harness).

### 10.1 Preconditions

- Designs gated (this PR + core shared-origin design).
- Core release pin with symlink primitives; memex-grok depends on that version.
- Desk `memex.json` (or `MEMEX_CONFIG`) with `sync.enabled: true` and origin resolvable.
- MCP already registered for the desk project (existing doctor mcp-registration WARN if wrong cwd).

### 10.2 Procedure

1. Confirm baseline: `memex doctor --json` — hooks WARN (dormant); MCP OK when run from desk cwd.
2. Place or confirm at least one rule under origin (e.g. `rules/dogfood-rule.md`) via core lifecycle or manual file in origin.
3. `memex init --strict` from desk workspace.
4. Prove provenance:
   ```bash
   ls -la ~/.grok/rules
   readlink -f ~/.grok/rules/dogfood-rule.md   # → under effective origin
   ```
5. Conflict drill: create a real file at a managed name → `memex init` must not overwrite; doctor WARN lists conflict.
6. MCP loop (acceptance):
   - `memex_status` reports healthy index / sync flags.
   - `memex_search` finds the dogfood rule (or skill) content.
   - `memex_read_skill` returns body (symlink target readable).
7. Run package tests including `test/integration/launch-path.test.ts` (built binary MCP handshake + search).
8. Record results in flotilla brief or desk notes (paths scrubbed).

### 10.3 Success criteria (chapter done for grok)

- [ ] Design gated by memex.
- [ ] Impl shipped: init/sync projection + doctor checks.
- [ ] Dogfood desk: `readlink` → origin for managed rules.
- [ ] MCP regression suite green; live dogfood search/read works.
- [ ] No new inject path in tree.
- [ ] Alignment ticket filed for other adapters (not necessarily implemented).

---

## 11. Implementation sketch (post-gate only)

Ordered for minimal risk; **do not start until designs pass**.

1. **Pin memex-core** version exporting origin + symlink policy + SyncProfile fields.
2. **`src/core/projection.ts`** (name flexible): thin wrapper calling core FS ops with `getGrokPaths()` / project dirs.
3. **`src/cli/init.ts`**, extend **`src/cli/sync.ts`**; wire `main.ts`.
4. **Doctor checks** + unit tests with temp dirs and fake origin (no live grok required).
5. **`buildScanDirs` projection-aware** scan policy + tests (`index-init.test.ts`).
6. **Docs:** README/USAGE doctor messaging; one-line parent design pointer to this addendum.
7. **Dogfood** §10; fix only projection bugs found (no inject “fixes”).

---

## 12. Test plan (acceptance)

| Layer | Coverage |
|-------|----------|
| Unit | symlink create / idempotent re-run / real-file conflict / wrong-link conflict |
| Unit | doctor origin + projection + memory-surface messaging (scrubbed paths) |
| Unit | buildScanDirs no double-count when projected |
| Integration | existing launch-path MCP initialize + `memex_search` still pass with fixture skills |
| Manual dogfood | §10 on grok-research |

---

## 13. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Core design lag | Grok design merges as intent; **impl blocked** on core pin |
| Double-index via origin + harness | §6 scan policy |
| Clobber user rules | fail-closed symlink policy; doctor conflict list |
| Path proliferation (`~/.memex` vs XDG) | §4 Q1 — stick to existing sync root |
| Operators expect inject to “just work” | doctor + help copy: memory = tools |
| Symlinks on Windows | core policy must define junction/copy fallback; grok inherits; dogfood is Linux first |

---

## 14. Relationship to parent design decisions

| Decision | This chapter |
|----------|--------------|
| **D1** MCP primary | Reinforced — memory surface remains MCP |
| **D3** dormant hooks | Unchanged; still WARN |
| **D5** read-only-sync / canonical id | Projection of **existing origin rules** does not require project memory writes; project-scoped origin paths still use core `resolveProjectId` when available |
| **D6** single sync repo path | Origin = effective sync repo; no third tree |
| **D8** no writes to grok-owned memory | Projection writes **only symlinks** under `.grok/rules` (and later skills); never mutates `~/.grok/memory/` |
| **D9** three-tier SCOPE | Origin layout owned by core; grok maps fleet→user rules, project→cwd rules |

---

## 15. Coordination / backlog settle markers

### For memex (flotilla XO)

- Gate this design PR (systems-review bar).
- Gate memex-core `shared-origin-sync-profile` design; sequence core impl before grok impl.
- Freeze-SHA when core contract publishes.
- Hold other adapter sub-XOs on standby until grok dogfood proves projection.

### ## Backlog

| Marker | Item | Owner |
|--------|------|-------|
| `[blocked] settle: core-design` | memex-core shared-origin + SyncProfile design not yet verified in-tree at time of this draft (`design/` had centroid/scope/portable-location only). Grok impl blocked on core primitives. | memex-core + memex gate |
| `[blocked] settle: impl-after-design-gate` | No `memex init` / projection code until both designs pass memex gate. | memex-grok |
| `[awaiting] settle: dogfood-desk-binding` | Confirm grok-research desk path + who sets `sync.enabled` on host (provision vs manual). | memex / operator |
| `[follow-on] settle: skills-projection` | Same symlink model for `~/.grok/skills` after rules path proven. | memex-grok |
| `[follow-on] settle: adapter-alignment` | Tickets for claude/codex/hermes/openclaw once grok+core green. | memex |
| `[non-goal] settle: inject-21` | hermes #21 inject-gap explicitly **not** primary for this chapter. | — |

---

## 16. References (read for this draft)

- Flotilla brief: `~/workspace/memex-flotilla/briefs/file-rules-shared-origin-2026-07-10.md`
- Flotilla: `briefs/grok-adapter-scope-architecture.md` (filesystem + MCP; no inject)
- Parent: `docs/superpowers/specs/2026-05-25-memex-grok-design.md`
- Openspec decisions: `openspec/changes/add-memex-grok-plugin/design.md` (D1–D9)
- Code: `src/core/paths.ts`, `src/core/config.ts`, `src/core/index-init.ts`, `src/cli/doctor.ts`, `src/main.ts`
- Core today: `SyncConfig` / `initSyncRepo` / `syncPull` in `@jim80net/memex-core` (`types.ts`, `sync.ts`) — **no shared-origin projection API yet**
- Core SCOPE: `memex-core/design/knowledge-scope-three-tier.md`
