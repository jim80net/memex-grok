# memex-grok

Grok adapter for [memex](https://github.com/jim80net/memex-core) — consistent rules, skills, and standing memory across harnesses via a shared git corpus.

## Harness constraint

Grok **cannot inject into the prompt from hook responses** (verified: `additionalContext` is ignored; plugin hooks unreliable in headless mode). memex-grok therefore delivers knowledge through:

1. **Filesystem sync** — shared corpus (`fleet/`, `flotillas/`, `projects/`)
2. **MCP tools** — `memex_search`, `memex_read_skill`, `memex_status` (primary path)

Hooks are wired as dormant / best-effort warm-up only.

## Self-verification

After deployment, run the installed entrypoint to verify the complete memory path:

```sh
~/.cache/memex-grok/memex-grok selfcheck
~/.cache/memex-grok/memex-grok selfcheck --json
```

`selfcheck` reuses the doctor checks, starts the same executable as an MCP server,
performs a threshold-zero search and read round-trip, probes forbidden reads, and
checks tool output for host-path leaks. It exits zero only when every step passes.

## Operator inspection

The installed CLI provides a compact human view over the same MCP tools without
changing their JSON-RPC contract:

```sh
~/.cache/memex-grok/memex-grok search --threshold 0 "standard development flow"
~/.cache/memex-grok/memex-grok read standard-development-flow
~/.cache/memex-grok/memex-grok read standard-development-flow --page 2
~/.cache/memex-grok/memex-grok read standard-development-flow --full
```

Search descriptions are normalized to bounded one-line teasers. Reads default to
2,000-character pages (configurable from 200–4,000 with `--page-size`) and print
an explicit continuation command. Use `search --raw` for the unchanged MCP search
JSON or `read --raw` for exact full MCP content.

## Three-tier scope

memex-core owns scope resolution; this adapter consumes it:

| Scope | Path | Examples |
|-------|------|----------|
| Desk | `projects/<canonical-id>/` | Repo-specific skills and rules |
| Flotilla | `flotillas/<flotilla-id>/` | Project-XO subtree shared knowledge |
| Fleet | `fleet/` | Operator standing rules and constitution |

See `memex-core/design/knowledge-scope-three-tier.md`.

## Status

Specification and openspec change in `openspec/changes/add-memex-grok-plugin/`. Implementation owned by the memex flotilla XO. Open PRs: foundation + MCP server.

## Related

- [memex-claude](https://github.com/jim80net/memex-claude) — Claude adapter (hook injection)
- [memex-core](https://github.com/jim80net/memex-core) — shared engine
- Design spec: `docs/superpowers/specs/2026-05-25-memex-grok-design.md`
