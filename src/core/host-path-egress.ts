import { homedir } from "node:os";

/**
 * Scrub host-specific absolute paths from user-facing egress text.
 * Shared by MCP tool output and `memex doctor` (issue #13).
 */
export function scrubHostPaths(text: string, home = homedir()): string {
  let out = text;
  if (home) {
    out = out.replaceAll(home, "~");
  }
  // Any remaining /home/<user> prefix → tilde (covers paths outside live $HOME in tests).
  out = out.replace(/\/home\/[^/\s)]+/g, "~");
  return out;
}

/** Fail-closed guard: no surfaced text may leak /home/ or the live home directory. */
export function assertNoHostPathLeaks(text: string, home = homedir()): void {
  if (text.includes("/home/")) {
    throw new Error("output leaks /home/ path");
  }
  if (home && text.includes(home)) {
    throw new Error("output leaks user home path");
  }
}