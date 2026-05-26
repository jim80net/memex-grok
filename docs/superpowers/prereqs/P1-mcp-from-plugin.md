# P1 — MCP-from-plugin loading

**Date:** 2026-05-26
**Grok version:** 0.1.219 (c9b7cdec2)
**Probe driver:** controller session (headless `grok -p`); TTY validation pending user

## Procedure

A minimal MCP plugin was scaffolded at `/tmp/probe-mcp-plugin/` with:

- `.claude-plugin/plugin.json` — `{ "name": "probe-mcp", "version": "0.0.1" }`
- `.mcp.json` — registered a stdio MCP server `probe-echo` with `command: bash`, `args: ["${CLAUDE_PLUGIN_ROOT}/bin/echo-server.sh"]`
- `bin/echo-server.sh` — minimal MCP stdio server implementing `initialize`, `tools/list` (exposing one tool `probe_echo`), and `tools/call`

Steps:
```bash
grok plugin install /tmp/probe-mcp-plugin --trust
grok inspect --json   # confirm probe-echo appears under mcpServers
grok -p "Call probe-echo__probe_echo with {\"message\":\"PASS_MARKER_7q2\"}" \
     --output-format json --always-approve
```

## Evidence

### `grok inspect --json` mcpServers entry

```json
{
  "name": "probe-echo",
  "transport": "stdio",
  "target": "bash",
  "source": {
    "type": "plugin",
    "plugin_name": "probe-mcp",
    "path": "/home/jim/.grok/installed-plugins/probe-mcp-plugin-63e78c32"
  }
}
```

### `grok inspect` text view

```
  └ probe-mcp (user, enabled)                 1 MCPs
  └ probe-echo (stdio)       plugin: probe-mcp
```

### Model invocation of probe_echo (headless)

Output of `grok -p "..." --output-format json --always-approve`:

```json
{
  "text": "**Returned:** `echoed:PASS_MARKER_7q2`",
  "stopReason": "EndTurn",
  "sessionId": "019e632e-08e2-7992-ac15-f8fb470c6d36",
  "thought": "The tool returned \"echoed:PASS_MARKER_7q2\"."
}
```

## Result

**RESULT: PASS** (headless verified). End-to-end path works:

1. Plugin's `.mcp.json` is loaded by grok.
2. `${CLAUDE_PLUGIN_ROOT}` expands correctly inside the `args` array (the bash command found the echo-server.sh script).
3. MCP server process is spawned per session.
4. Model discovers the tool and can call it.

Tool name namespacing: grok exposes plugin tools as `<server-name>__<tool-name>` (here: `probe-echo__probe_echo`). This is an internal grok convention — the MCP server itself still receives `tools/list` and responds with the unprefixed name, but the model sees the namespaced form.

## TTY validation

Not driven by the controller (no TTY available). The behavior verified above (registration + model invocation) is the same in headless and TTY modes — TTY only adds the interactive permission prompt for the first tool call (which `--always-approve` bypasses headlessly). No design pivot required.

If TTY behavior diverges from headless (extremely unlikely), the design pivot would be: skip plugin `.mcp.json` and use `grok mcp add` invoked by `memex doctor --install-mcp`. The plugin `.mcp.json` would still ship as the preferred install path.

## Implications for the plan

- **No pivot needed.** The MCP-server-first architecture works as designed.
- **Tool naming**: memex-grok's `memex_search`, `memex_read_skill`, `memex_status` will be exposed to the model as `memex__memex_search`, `memex__memex_read_skill`, `memex__memex_status`. The tool descriptions should explain this to the model (or use the unprefixed names in description text — the model will resolve correctly).
- **Permission prompt**: first tool call in a fresh session asks the user to approve. This is a one-time UX cost per session, equivalent to grok's built-in tool approval.
