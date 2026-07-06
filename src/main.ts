#!/usr/bin/env node
const VERSION = process.env.MEMEX_GROK_VERSION ?? "0.0.0-dev";
const BUILD_STAMP = process.env.MEMEX_GROK_BUILD_STAMP ?? VERSION;

const USAGE = `usage: memex <subcommand> [args]

subcommands:
  mcp                Run the stdio MCP server (used by .mcp.json).
  doctor [--json]    Diagnose installation health.
  --version, -v      Print version and exit.

planned (not in Plan 1):
  hook               Hook dispatcher (Plan 2).
  sync               One-shot sync pull/push (Plan 3).
  index --rebuild    Force index rebuild (Plan 3).
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
  if (sub === "hook" || sub === "sync" || sub === "index") {
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
