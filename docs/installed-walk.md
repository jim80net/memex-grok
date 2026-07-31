# Canonical installed-product walk

The repository owns one versioned capture pipeline for the installed Memex/Grok
consumer. Evidence directories contain outputs only; never copy executable walk
scripts into a prior or future evidence package.

```sh
FLOTILLA_SELF=memex-grok pnpm walk:installed -- \
  --nonce evening-walk-YYYYMMDDThhmmZ \
  --out /absolute/private/state/path \
  --registered-cwd /path/where/grok-mcp-is-registered
```

The output path must be absent or empty and outside this public checkout. The
command runs capture → cached-Chromium render → validation → finalization and
does not deploy. Set `MEMEX_PLAYWRIGHT_PYTHON` when the cached Playwright Python
is not `/tmp/pw-venv/bin/python`. An optional built ancestor checkout can be
supplied with `--older-source` for the deployed-newer/source-older doctor state.

## Hard gates

The package records the harness commit and accepts it only when it shares proven
Git ancestry with `origin/main`; a feature commit may be ahead or behind, but an
unrelated history fails. It uses semantic coverage requirements rather than
pinning a daily station count, frame count, or one expected source SHA.
Finalization also requires the current checkout, captured CLI provenance,
render manifest, and validation report to name the same full commit, so a
between-phase checkout change cannot relabel older evidence.

The following remain fail-closed:

- installed binary version equals the installed stamp;
- every captured CLI exit contract;
- all currently registered schema probes and both security-path probes;
- handle/name equality, portable locations, and no host-path tool output;
- exact rendered text, horizontal geometry, and final-PNG opaque prefix pixels.

Finalization rejects package-owned references to other adapters, grading files,
or presentation artifacts. Raw product output is not scanned for those words:
it is byte-preserved evidence and may legitimately contain arbitrary corpus text.

## Independent seeing authority

Finalization creates one pending authority slot for `seeing-verdict.md` and the
derived `<walk-nonce>-seeing` nonce. After an independent reviewer writes that
file, the reviewer binds it with their own `FLOTILLA_SELF`:

```sh
FLOTILLA_SELF=reviewer-seat pnpm walk:review -- \
  --nonce evening-walk-YYYYMMDDThhmmZ \
  --out /absolute/private/state/path \
  --dispatch-nonce flotilla-dispatch-...
```

The reviewer identity is derived from the fleet's canonical durable
consumed-dispatch registry, not from caller-supplied acknowledgement text or a
caller-selected `FLOTILLA_ROSTER`. The source-owned command fixes that trust
anchor to the canonical fleet coordination checkout. Binding
requires exactly one post-capture `durable-ack` sent by the Memex coordinator;
`FLOTILLA_SELF` must agree with its recipient. It also fails when the reviewer
is the capture owner, the verdict names zero or multiple reviewers, another
reviewer already owns the slot, nonces conflict, or supersession is unresolved.
The binding records the full receipt and verdict SHA-256. `walk-provenance.json` and the later
`seeing-verdict.md` are intentionally excluded from the immutable raw-evidence
inventory; every capture, render source, PNG, assertion, and report remains
hash-bound.
