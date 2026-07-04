# Dogfood runbook — memex-grok on the `grok-research` desk

> **🛑 BLOCKED (2026-07-04) on [#4](https://github.com/jim80net/memex-grok/issues/4).**
> A 2026-07-04 dogfood attempt registered + handshook cleanly (`grok mcp doctor`
> ✓ 3 tools, `memex doctor` exit 0) but a REAL `memex_search` **failed**: the
> compiled binary can't load its embedding backend (`@huggingface/transformers`).
> The steps below register + place the binary but are **insufficient** — every
> real tool call errors until #4 lands. Rolled back. **Do not re-run until #4 is
> fixed and a real `memex_search` returns corpus hits from the built binary.**
> The step-4 "dogfood" verification must be a real search returning hits, not a
> handshake.

**Status:** BLOCKED on #4 (see banner). When unblocked: awaiting (a) CoS veto
window and (b) a `grok-research`-idle window (coordinate with family-office).
**Reversibility:** full — `grok mcp remove` + delete the copied binary. No
operator facet (CoS's window suffices).

## What it does

Registers the memex MCP server into the `grok-research` desk's grok config so
the desk can call `memex_search`, `memex_read_skill`, `memex_status` against the
shared corpus. This is the first live consumption of memex on a Grok harness.

## Preconditions (all verified 2026-07-04)

- Built binary handshakes with grok: `grok mcp doctor` → `✓ handshake OK
  (protocol 2024-11-05), ✓ 3 tools discovered` (isolated project scope).
- `grok mcp add` is grok's native registration surface (grok 0.2.82).
- `memex doctor` reports the six checks; green once binary is installed + MCP
  registered.
- Rollback (`grok mcp remove`) tested to cleanly deregister.

## Steps

```sh
# 0. Confirm grok-research is idle (family-office) before touching its config.

# 1. Build (on the host; ~arm64/x64 auto-detected) and install the binary.
cd <memex-grok checkout>
pnpm install --frozen-lockfile && pnpm build
mkdir -p ~/.cache/memex-grok
cp "dist/$(node -e 'console.log(process.platform+"-"+process.arch)')/memex" \
   ~/.cache/memex-grok/memex-grok
chmod +x ~/.cache/memex-grok/memex-grok

# 2. Register the MCP server (user scope → available to the grok-research desk).
grok mcp add memex-grok -s user ~/.cache/memex-grok/memex-grok mcp

# 3. Verify.
grok mcp doctor          # expect: memex-grok ✓ handshake OK, ✓ 3 tools discovered
~/.cache/memex-grok/memex-grok doctor   # expect: binary OK, mcp-registration OK

# 4. Dogfood: on grok-research's next research turn, confirm it can call
#    memex_search and gets corpus hits (the live-consumption proof).
```

## Rollback

```sh
grok mcp remove memex-grok
rm -f ~/.cache/memex-grok/memex-grok
```

`grok mcp doctor` should then show 0 memex servers; the desk is back to its
prior state. Fully reversible, no residual config.

## Notes

- User scope (`~/.grok/config.toml`) surfaces the server to all grok desks; if
  we want it scoped to grok-research only, use `-s project` from that desk's
  cwd instead. Recommend user scope for the fleet-wide memory goal, but the
  dogfood can start project-scoped to limit blast radius, then widen.
- The synced corpus must be present for `memex_search` to return hits; the MCP
  server indexes the sync repo on launch (empty index = zero hits, not an error).
