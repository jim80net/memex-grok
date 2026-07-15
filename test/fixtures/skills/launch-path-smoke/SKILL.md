---
name: launch-path-smoke-skill
description: Standard development flow for shipping memex changes via brainstorm design review TDD
queries:
  - standard development flow
  - ship memex changes
---

Follow brainstorm, design, review trio, TDD, then PR. Verify the built artifact through
the same deployed entrypoint users invoke, exercise a real search and read round-trip,
and keep security rejection plus path-egress checks in the acceptance gate.
