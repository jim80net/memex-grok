import { describe, expect, it } from "vitest";
import { assertNoHostPathLeaks, scrubHostPaths } from "../src/core/host-path-egress.ts";

describe("scrubHostPaths", () => {
  it("abbreviates the live home directory and any /home/<user> prefix", () => {
    const text =
      "present and runnable (/home/jim/.cache/memex-grok/memex-grok); deferring to /home/jim/.local/share/memex-claude";
    const scrubbed = scrubHostPaths(text, "/home/jim");
    expect(scrubbed).toBe(
      "present and runnable (~/.cache/memex-grok/memex-grok); deferring to ~/.local/share/memex-claude",
    );
    assertNoHostPathLeaks(scrubbed, "/home/jim");
  });
});