#!/usr/bin/env node
const VERSION = process.env.MEMEX_GROK_VERSION ?? "0.0.0-dev";
const BUILD_STAMP = process.env.MEMEX_GROK_BUILD_STAMP ?? VERSION;

const USAGE = `usage: memex <subcommand> [args]

subcommands:
  mcp                Run the stdio MCP server (used by .mcp.json).
  doctor [--json]    Diagnose installation health.
  selfcheck [--json] Verify doctor, live MCP tools, security, and path egress.
  search [options] QUERY
                     Search memex with compact ranked rows (--raw for MCP JSON).
  read [options] NAME|HANDLE
                     Read bounded pages (--full or --raw for complete content).
  init [--cwd PATH] [--strict] [--dry-run] [--json]
                     Ensure origin + project ~/.grok/rules as origin symlinks.
  sync [--cwd PATH] [--strict] [--dry-run] [--json]
                     Pull origin (if remote) + re-project harness rules.
  --help, -h         Print this help and exit.
  --version, -v      Print version and exit.

planned (not in this chapter):
  hook               Hook dispatcher (Plan 2).
  index --rebuild    Force index rebuild (Plan 3 remainder).
`;

type ArgContract = {
  flags: ReadonlySet<string>;
  valueFlags?: ReadonlySet<string>;
  allowPositionals?: boolean;
};

const SUBCOMMAND_ARGS: Readonly<Record<string, ArgContract>> = {
  mcp: { flags: new Set() },
  doctor: { flags: new Set(["--json"]) },
  selfcheck: { flags: new Set(["--json"]) },
  search: {
    flags: new Set(["--raw", "--help", "-h"]),
    valueFlags: new Set(["--top-k", "--threshold", "--type"]),
    allowPositionals: true,
  },
  read: {
    flags: new Set(["--raw", "--full", "--help", "-h"]),
    valueFlags: new Set(["--page", "--page-size"]),
    allowPositionals: true,
  },
  init: {
    flags: new Set(["--strict", "--dry-run", "--json"]),
    valueFlags: new Set(["--cwd"]),
  },
  sync: {
    flags: new Set(["--strict", "--dry-run", "--json"]),
    valueFlags: new Set(["--cwd"]),
  },
  hook: { flags: new Set() },
  index: { flags: new Set(["--rebuild"]) },
};

function validateSubcommandArgs(subcommand: string, args: string[]): string | null {
  const contract = SUBCOMMAND_ARGS[subcommand];
  if (!contract) return null;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (contract.flags.has(arg)) continue;
    if (contract.valueFlags?.has(arg)) {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        return `'${arg}' requires a value`;
      }
      index++;
      continue;
    }
    const equals = arg.indexOf("=");
    if (equals > 0 && contract.valueFlags?.has(arg.slice(0, equals))) {
      if (equals === arg.length - 1) return `'${arg.slice(0, equals)}' requires a value`;
      continue;
    }
    if (contract.allowPositionals && !arg.startsWith("-")) continue;
    return `unsupported argument '${arg}'`;
  }
  return null;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    process.stderr.write(USAGE);
    return 1;
  }
  const sub = argv[0];
  if (sub === "--help" || sub === "-h") {
    if (argv.length > 1) {
      process.stderr.write(`memex: ${sub}: unsupported argument '${argv[1]}'\n`);
      return 1;
    }
    process.stdout.write(USAGE);
    return 0;
  }
  if (sub === "--version" || sub === "-v") {
    if (argv.length > 1) {
      process.stderr.write(`memex: ${sub}: unsupported argument '${argv[1]}'\n`);
      return 1;
    }
    process.stdout.write(BUILD_STAMP + "\n");
    return 0;
  }
  const argumentError = validateSubcommandArgs(sub!, argv.slice(1));
  if (argumentError) {
    process.stderr.write(`memex: ${sub}: ${argumentError}\n`);
    return 1;
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
  if (sub === "selfcheck") {
    const { runSelfcheck } = await import("./cli/selfcheck.ts");
    return runSelfcheck(argv.slice(1));
  }
  if (sub === "search") {
    const { runSearch } = await import("./cli/inspect.ts");
    return runSearch(argv.slice(1));
  }
  if (sub === "read") {
    const { runRead } = await import("./cli/inspect.ts");
    return runRead(argv.slice(1));
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
