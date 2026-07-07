# P3 — Plugin env-var expansion

**Date:** 2026-05-26
**Grok version:** 0.1.219 (c9b7cdec2)

## Status

**SKIPPED for hook context** — P2 reports that plugin hooks do not fire in headless mode, so we could not observe what `CLAUDE_PLUGIN_ROOT` / `GROK_PLUGIN_ROOT` resolve to inside a plugin hook script.

**PARTIAL PASS for MCP-server context** — `${CLAUDE_PLUGIN_ROOT}` clearly DOES expand for plugin-sourced MCP server `command`/`args` fields, demonstrated by P1: the probe MCP server's `bin/echo-server.sh` was located and executed by `bash "${CLAUDE_PLUGIN_ROOT}/bin/echo-server.sh"`. If the variable had not expanded, the bash command would have failed with `No such file or directory`.

## Implications for the plan

For Plan 1 (MCP server only): **`${CLAUDE_PLUGIN_ROOT}` works in `.mcp.json`** — no build-time substitution needed. Plan 1's `.mcp.json` ships as written.

For Plan 2 (hooks): when TTY hook firing is confirmed (by the user or a later probe), re-run this check by adding `env | grep -E 'PLUGIN_ROOT' >> /tmp/p3-env.log` inside the hook script. If only `GROK_PLUGIN_ROOT` is set in hook context, Plan 2 ships `hooks/hooks.json` with `${GROK_PLUGIN_ROOT}` (via build-time substitution, since `.mcp.json` and `hooks/hooks.json` are different files).

## Procedure for completion (deferred to Plan 2)

```bash
# Once plugin hooks are confirmed to fire (Plan 2 prerequisite):
# Modify the probe.sh from P2 to log env:
cat >> /tmp/probe-hook-plugin/bin/probe.sh <<'EOF'
env | grep -E 'PLUGIN_ROOT' >> /tmp/p3-env.log
EOF
# Reinstall, run grok, read /tmp/p3-env.log
```
