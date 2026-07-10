#!/usr/bin/env node
const VERSION = process.env.MEMEX_GROK_VERSION ?? "0.0.0-dev";
const BUILD_STAMP = process.env.MEMEX_GROK_BUILD_STAMP ?? VERSION;

const USAGE = `usage: memex <subcommand> [args]

subcommands:
  mcp                Run the stdio MCP server (used by .mcp.json).
  doctor [--json]    Diagnose installation health.
  init [--cwd PATH] [--strict] [--dry-run] [--json]
                     Ensure origin + project ~/.grok/rules as origin symlinks.
  sync [--cwd PATH] [--strict] [--dry-run] [--json]
                     Pull origin (if remote) + re-project harness rules.
  --version, -v      Print version and exit.

planned (not in this chapter):
  hook               Hook dispatcher (Plan 2).
  index --rebuild    Force index rebuild (Plan 3 remainder).
`;

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    process.stderr.write(USAGE);
    return 1;
  }
  const sub = argv[0];
  if (sub === "--version" || sub === "-v") {
    process.stdout.write(BUILD_STAMP + "\n");
    return 0;
  }
  if (sub === "mcp") {
    const { runMemexMcp } = await import("./mcp/main.ts");
    await runMemexMcp({ stdin: process.stdin, stdout: process.stdout });
    return 0;
  }
  if (sub === "doctor") {
    const { runDoctor } = await import("./cli/doctor.ts");
    return runDoctor(argv.slice(1));
  }
  if (sub === "init") {
    const { runInit } = await import("./cli/init.ts");
    return runInit(argv.slice(1));
  }
  if (sub === "sync") {
    const { runSync } = await import("./cli/sync.ts");
    return runSync(argv.slice(1));
  }
  if (sub === "hook" || sub === "index") {
    process.stderr.write(`memex: '${sub}' not yet implemented (deferred to a later plan)\n`);
    return 1;
  }
  process.stderr.write(`memex: unknown subcommand '${sub}'\n\n${USAGE}`);
  return 1;
}

main().then((code) => process.exit(code)).catch((err) => {
  process.stderr.write(`memex: fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
});
