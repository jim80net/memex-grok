# Dogfood runbook — memex-grok on the `grok-research` desk

> **✅ UNBLOCKED (2026-07-04) — [#4](https://github.com/jim80net/memex-grok/issues/4)
> fix verified.** The `5f7ac34` fix (static-import `CompiledLocalEmbeddingProvider`
> so bun bundles transformers) was verified end-to-end: a REAL `memex_search`
> against the freshly built binary returns corpus hits (3 hits, deploy-sim from a
> clean install dir). The first dogfood attempt (rolled back) failed because the
> binary couldn't load its embedding backend; that is fixed. The steps below are
> **corrected** — they now copy the onnx `.so` and set `LD_LIBRARY_PATH` (the two
> deploy details the earlier attempt and the test harness masked).

**Status:** READY. Awaiting a fresh `grok-research`-idle window + family-office
re-confirm (per their "re-confirm before touching grok-research, only after a
real search returns hits" — that bar is now met). **Reversibility:** full —
`grok mcp remove memex-grok` + delete the install dir. No operator facet.

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

## Steps (corrected 2026-07-04 after the #4 fix)

Two runtime deps the naive install misses — both required or `memex_search` fails:
1. **`libonnxruntime.so.1` must sit in the install dir** (emitted next to the
   binary by `pnpm build`; copy it too, not just the binary).
2. **`LD_LIBRARY_PATH` must include the install dir** so the binary finds that
   `.so` — pass it into the MCP registration via `-e` (the binary is not yet
   self-locating; an `$ORIGIN` rpath would remove this — tracked follow-up).

```sh
# 0. Confirm grok-research is idle (family-office) before touching its config.
GROK_CWD=<grok-research cwd>        # e.g. the desk's worktree root
INSTALL="$HOME/.cache/memex-grok"

# 1. Build and install BOTH the binary AND the onnx shared lib.
cd <memex-grok checkout>
pnpm install --frozen-lockfile && pnpm build
mkdir -p "$INSTALL"
PLAT="$(node -e 'console.log(process.platform+"-"+process.arch)')"
cp "dist/$PLAT/memex" "$INSTALL/memex-grok"
cp "dist/$PLAT/libonnxruntime.so.1" "$INSTALL/"     # REQUIRED — do not skip
chmod +x "$INSTALL/memex-grok"

# 2. Register PROJECT-scope in grok-research's cwd (one-desk blast radius),
#    with LD_LIBRARY_PATH so the embedding backend loads.
cd "$GROK_CWD"
grok mcp add memex-grok -s project -e LD_LIBRARY_PATH="$INSTALL" \
  "$INSTALL/memex-grok" mcp

# 3. Verify — handshake AND a real search (a discovered tool is not a working tool).
grok mcp doctor                          # memex-grok ✓ handshake OK, ✓ 3 tools
LD_LIBRARY_PATH="$INSTALL" "$INSTALL/memex-grok" doctor   # exit 0
# real search must return hits (this is the acceptance bar, not the handshake):
printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"p","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"memex_search","arguments":{"query":"standard development flow","threshold":0.3}}}' \
  | LD_LIBRARY_PATH="$INSTALL" "$INSTALL/memex-grok" mcp   # expect results[] non-empty

# 4. Dogfood: after family-office rotates grok-research's session, confirm it
#    calls memex_search and gets hits (the live-consumption proof).
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
