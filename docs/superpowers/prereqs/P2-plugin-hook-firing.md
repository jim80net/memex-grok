# P2 — Plugin hook firing

**Date:** 2026-05-26
**Grok version:** 0.1.219 (c9b7cdec2)
**Probe driver:** controller session (headless `grok -p`); TTY validation pending user

## Procedure

A minimal hook plugin was scaffolded at `/tmp/probe-hook-plugin/` with:

- `.claude-plugin/plugin.json` — `{ "name": "probe-hooks", "version": "0.0.1" }`
- `hooks/hooks.json` — declared `SessionStart`, `UserPromptSubmit`, and `Stop` hooks all pointing at `bash "${CLAUDE_PLUGIN_ROOT}/bin/probe.sh"` with timeout 10
- `bin/probe.sh` — appends `(timestamp, GROK_HOOK_EVENT, CLAUDE_PLUGIN_ROOT, GROK_PLUGIN_ROOT, stdin)` to `/tmp/p2-probe.log` on each invocation

Steps:
```bash
grok plugin install /tmp/probe-hook-plugin --trust
grok inspect --json | jq '.hooks[] | select(.source.plugin_name=="probe-hooks")'
> /tmp/p2-probe.log
grok -p "say hi" --output-format plain --always-approve
wc -l /tmp/p2-probe.log    # check whether the hook fired
```

## Evidence

### `grok inspect --json` hook entry for probe-hooks

```json
{
  "event": "(plugin)",
  "hookType": "file",
  "target": "$HOME/.grok/installed-plugins/probe-hook-plugin-d7c3c213/hooks/hooks.json",
  "source": {
    "type": "plugin",
    "plugin_name": "probe-hooks",
    "path": "$HOME/.grok/installed-plugins/probe-hook-plugin-d7c3c213"
  }
}
```

Note: `event` is the literal string `"(plugin)"` (not a real event name), `hookType` is `"file"` rather than `"command"`. This is grok's way of saying "the hooks.json file is recognized" — but it has NOT been parsed into per-event command entries (compare to user-scoped `~/.grok/hooks/*.json` files, which show one entry per event with `hookType: "command"`).

### Probe log after a headless session

```
$ ls -la /tmp/p2-probe.log
-rw-r--r-- 1 jim jim 0 May 26 00:27 /tmp/p2-probe.log
```

Zero bytes. The hook script was not invoked.

By contrast, the same `bin/probe.sh` script installed at `~/.grok/hooks/memex-probe.json` (global scope) fires reliably for every event (verified in an earlier session — logs `session_start`, `user_prompt_submit`, `stop` entries). Only the plugin-scoped wiring is silent.

## Result

**RESULT: PLUGIN HOOKS DO NOT FIRE IN HEADLESS** in grok 0.1.219. TTY mode unverified by controller.

The asymmetry between MCP servers (which fire fine — see P1) and hooks (which don't) in plugin scope is grok-internal behavior. It could be:

- A version-specific bug.
- Headless-mode-only behavior (the hooks modal `Ctrl+L` may require interactive context to register plugin hooks).
- Intentional: plugin hooks may require an explicit `/plugins trust` step beyond `--trust` at install time.

## Implications for the plan

The plan's architecture **already accommodates this**: the `SessionStart` hook is declared best-effort, and first-call initialization in the MCP server is the authoritative path for sync-pull and index rebuild. If plugin hooks turn out to never fire in any mode, `memex doctor --install-hooks` (planned for Plan 2) will symlink a `hooks.json` into `~/.grok/hooks/` as a global fallback.

For Plan 1 (this plan), the failure mode means no Plan-1-scope code path depends on plugin hooks firing — Plan 1 ships only the MCP server. Plan 2 will revisit this with TTY-mode validation as a hard prerequisite for its own scope.

## TTY validation

The user should run the procedure above (Step 3: `grok` interactive — type a prompt, exit) and report whether `/tmp/p2-probe.log` accumulates entries. If hooks fire in TTY but not headless, Plan 2 ships hooks as primary with a doctor warning when the user runs `grok -p` (`hook-driven cache warm-up disabled in headless mode`). If hooks fire in neither mode, Plan 2 ships the global-hook fallback by default.
