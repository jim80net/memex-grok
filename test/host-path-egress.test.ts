import { describe, expect, it } from "vitest";
import { assertNoHostPathLeaks, scrubHostPaths } from "../src/core/host-path-egress.ts";

describe("scrubHostPaths", () => {
  it("abbreviates the live home directory and any /home/<user> prefix", () => {
    const text =
      "present and runnable (/memex-test-home/.cache/memex-grok/memex-grok); deferring to /memex-test-home/.local/share/memex-claude";
    const scrubbed = scrubHostPaths(text, "/memex-test-home");
    expect(scrubbed).toBe(
      "present and runnable (~/.cache/memex-grok/memex-grok); deferring to ~/.local/share/memex-claude",
    );
    assertNoHostPathLeaks(scrubbed, "/memex-test-home");
  });
});