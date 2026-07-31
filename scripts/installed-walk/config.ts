import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

export interface WalkConfig {
  nonce: string;
  out: string;
  source: string;
  registeredCwd: string;
  wrongCwd: string;
  olderSource: string;
  binary: string;
  stamp: string;
  harnessCommit: string;
  captureOwner: string;
}

export function loadConfig(
  argv = process.argv.slice(2),
  options: { allowPopulatedOut?: boolean } = {},
): WalkConfig {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag?.startsWith("--")) fail(`unexpected argument '${flag}'`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`missing value for '${flag}'`);
    if (values.has(flag)) fail(`duplicate argument '${flag}'`);
    values.set(flag, value);
    index += 1;
  }
  const allowed = new Set(["--nonce", "--out", "--registered-cwd", "--older-source"]);
  for (const flag of values.keys()) if (!allowed.has(flag)) fail(`unknown argument '${flag}'`);

  const nonce = values.get("--nonce");
  const outArg = values.get("--out");
  if (!nonce || !/^[A-Za-z0-9][A-Za-z0-9._:-]{5,127}$/.test(nonce)) {
    fail("--nonce must be a 6-128 character portable identifier");
  }
  if (!outArg || !isAbsolute(outArg)) fail("--out must be an absolute path");

  const source = realpathSync(resolve(import.meta.dirname, "../.."));
  const out = resolve(outArg);
  if (out === source || out.startsWith(`${source}/`)) {
    fail("--out must be outside the public source checkout");
  }
  if (!options.allowPopulatedOut && existsSync(out) && readdirSync(out).length > 0) {
    fail(`--out must be absent or empty for immutable capture: ${out}`);
  }
  mkdirSync(out, { recursive: true });

  const binary = process.env.MEMEX_GROK_BINARY ?? `${homedir()}/.cache/memex-grok/memex-grok`;
  const stamp = process.env.MEMEX_GROK_STAMP ?? `${homedir()}/.cache/memex-grok/.stamp`;
  const registeredCwd = resolve(
    values.get("--registered-cwd") ?? process.env.MEMEX_GROK_REGISTERED_CWD ?? process.cwd(),
  );
  const olderSource = resolve(values.get("--older-source") ?? source);
  const captureOwner = process.env.FLOTILLA_SELF?.trim();
  if (!captureOwner) fail("FLOTILLA_SELF is required to bind capture provenance");

  return {
    nonce,
    out,
    source,
    registeredCwd,
    wrongCwd: source,
    olderSource,
    binary,
    stamp,
    harnessCommit: git(source, ["rev-parse", "HEAD"]),
    captureOwner,
  };
}

export function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function fail(message: string): never {
  throw new Error(`${message}\nusage: pnpm walk:installed --nonce NONCE --out /absolute/path [--registered-cwd PATH] [--older-source PATH]`);
}
