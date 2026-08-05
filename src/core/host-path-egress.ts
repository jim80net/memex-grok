import { homedir } from "node:os";

export const POSIX_HOME_PREFIX = ["", "home", ""].join("/");
const POSIX_HOME_PATTERN = new RegExp(`${POSIX_HOME_PREFIX}[^/\\s)]+`, "g");

/**
 * Scrub host-specific absolute paths from user-facing egress text.
 * Shared by MCP tool output and `memex doctor` (issue #13).
 */
export function scrubHostPaths(text: string, home = homedir()): string {
  let out = text;
  if (home) {
    out = out.replaceAll(home, "~");
  }
  // Any remaining generic POSIX user-home prefix → tilde (covers paths outside live $HOME in tests).
  out = out.replace(POSIX_HOME_PATTERN, "~");
  return out;
}

/** Fail-closed guard: no surfaced text may leak a POSIX user-home prefix or the live home directory. */
export function assertNoHostPathLeaks(text: string, home = homedir()): void {
  if (text.includes(POSIX_HOME_PREFIX)) {
    throw new Error(`output leaks ${POSIX_HOME_PREFIX} path`);
  }
  if (home && text.includes(home)) {
    throw new Error("output leaks user home path");
  }
}
