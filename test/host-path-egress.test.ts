import { describe, expect, it } from "vitest";
import { assertNoHostPathLeaks, POSIX_HOME_PREFIX, scrubHostPaths } from "../src/core/host-path-egress.ts";

const ABSOLUTE_HOME_FIXTURE = `${POSIX_HOME_PREFIX}example-user`;

describe("scrubHostPaths", () => {
  it("abbreviates the live home directory and any generic POSIX home prefix", () => {
    const text =
      `present and runnable (${ABSOLUTE_HOME_FIXTURE}/.cache/memex-grok/memex-grok); deferring to ${ABSOLUTE_HOME_FIXTURE}/.local/share/memex-claude`;
    const scrubbed = scrubHostPaths(text, ABSOLUTE_HOME_FIXTURE);
    expect(scrubbed).toBe(
      "present and runnable (~/.cache/memex-grok/memex-grok); deferring to ~/.local/share/memex-claude",
    );
    assertNoHostPathLeaks(scrubbed, ABSOLUTE_HOME_FIXTURE);
  });
});
