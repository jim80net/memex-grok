# memex-grok Foundation Implementation Plan (Plan 1 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up memex-grok as an installable grok plugin whose stdio MCP server exposes `memex_search`, `memex_read_skill`, and `memex_status` against the user's local `~/.grok/skills/` and `~/.claude/skills/` directories. Sync-repo writes, dormant injection hooks, and bundled skills are deferred to Plans 2–4.

**Architecture:** TypeScript source under `src/`, compiled by Bun to a single per-platform binary via `build.ts` (mirroring memex-claude). Plugin shipped via `.claude-plugin/plugin.json` + `.mcp.json`. A POSIX shell stub at `bin/memex` lazily downloads the platform binary on first invocation. The MCP server is the only runtime path in Plan 1; hook wiring is deferred to Plan 2.

**Tech Stack:** TypeScript (ES2022, bundler module resolution), Bun (build + single-file compile), `@jim80net/memex-core` ≥0.3.1 (SkillIndex, LocalEmbeddingProvider, paths), pnpm 9, vitest 3 (tests), tsc (typecheck only — `noEmit: true`).

**Reference spec:** `openspec/changes/add-memex-grok-plugin/` (proposal.md, design.md, specs/{mcp-server,cross-harness-integration}/spec.md). Full design: `docs/superpowers/specs/2026-05-25-memex-grok-design.md`.

**Companion plans (not in scope here):**
- Plan 2: Hook runtime (input adapter, dispatcher, SessionStart, dormant hooks)
- Plan 3: Sync repo integration (canonicalProjectId, read-only-sync mode, --migrate-repo) — blocked on memex-core P4
- Plan 4: Bundled skills — blocked on Plan 3

---

## Phase 0: Prerequisite validation

These tasks produce evidence docs under `docs/superpowers/prereqs/`. Do not proceed to Phase 1 until each prerequisite either passes or its failure is documented and the plan is updated to reflect the design pivot.

### Task 0.1: Validate P1 — MCP server from plugin

**Files:**
- Create: `tmp/probe-mcp-plugin/.claude-plugin/plugin.json`
- Create: `tmp/probe-mcp-plugin/.mcp.json`
- Create: `tmp/probe-mcp-plugin/bin/echo-server.sh`
- Create: `docs/superpowers/prereqs/P1-mcp-from-plugin.md`

- [ ] **Step 1: Create the probe plugin manifest**

```bash
mkdir -p tmp/probe-mcp-plugin/.claude-plugin tmp/probe-mcp-plugin/bin
```

`tmp/probe-mcp-plugin/.claude-plugin/plugin.json`:
```json
{
  "name": "probe-mcp",
  "version": "0.0.1",
  "description": "Probe MCP loading from plugin"
}
```

- [ ] **Step 2: Create the MCP server manifest**

`tmp/probe-mcp-plugin/.mcp.json`:
```json
{
  "mcpServers": {
    "probe-echo": {
      "command": "bash",
      "args": ["${CLAUDE_PLUGIN_ROOT}/bin/echo-server.sh"]
    }
  }
}
```

- [ ] **Step 3: Create a minimal stdio MCP echo server**

`tmp/probe-mcp-plugin/bin/echo-server.sh`:
```bash
#!/usr/bin/env bash
# Minimal MCP stdio server implementing initialize, tools/list, tools/call (probe_echo)
set -u
log() { echo "$1" >&2; }
respond() {
  local id="$1" body="$2"
  printf '{"jsonrpc":"2.0","id":%s,"result":%s}\n' "$id" "$body"
}
while IFS= read -r line; do
  log "probe-mcp: << $line"
  id=$(echo "$line" | python3 -c "import sys,json;print(json.loads(sys.stdin.read()).get('id','null'))" 2>/dev/null)
  method=$(echo "$line" | python3 -c "import sys,json;print(json.loads(sys.stdin.read()).get('method',''))" 2>/dev/null)
  case "$method" in
    initialize)
      respond "$id" '{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"probe-echo","version":"0.0.1"}}'
      ;;
    notifications/initialized)
      ;; # no response
    tools/list)
      respond "$id" '{"tools":[{"name":"probe_echo","description":"Echo the provided message back to the caller.","inputSchema":{"type":"object","properties":{"message":{"type":"string"}},"required":["message"]}}]}'
      ;;
    tools/call)
      msg=$(echo "$line" | python3 -c "import sys,json;d=json.loads(sys.stdin.read());print(d['params']['arguments']['message'])")
      respond "$id" "{\"content\":[{\"type\":\"text\",\"text\":\"echoed:${msg}\"}]}"
      ;;
    *)
      respond "$id" 'null'
      ;;
  esac
done
```

```bash
chmod +x tmp/probe-mcp-plugin/bin/echo-server.sh
```

- [ ] **Step 4: Install the probe plugin and confirm registration**

Run:
```bash
grok plugin install ./tmp/probe-mcp-plugin --trust
grok inspect --json | python3 -c "import json,sys;d=json.load(sys.stdin);print(json.dumps([s for s in d.get('mcpServers',[]) if 'probe' in str(s).lower()],indent=2))"
```

Expected: at least one entry mentioning `probe-echo`. Capture the output.

- [ ] **Step 5: Drive an interactive session that calls the probe tool**

In an interactive TTY (not headless), run `grok` from any directory and at the prompt enter:

```
Use the probe_echo tool with {"message":"PASS_MARKER_7q2"} and tell me what it returned.
```

Expected: the model invokes `probe_echo` and reports `echoed:PASS_MARKER_7q2`.

- [ ] **Step 6: Write the deliverable doc**

`docs/superpowers/prereqs/P1-mcp-from-plugin.md`:
```markdown
# P1 — MCP-from-plugin loading

**Date:** YYYY-MM-DD
**Grok version:** <output of `grok --version`>

## Procedure

<paste commands from Steps 4–5>

## Evidence

### `grok inspect --json` mcpServers entry
```
<paste the JSON>
```

### Model invocation of probe_echo

> <paste the model's response>

## Result

RESULT: PASS

The `memex-grok` plugin's `.mcp.json` will be loaded by `grok` and the model will be able to invoke our MCP tools. No design pivot needed.
```

If the evidence does NOT contain `echoed:PASS_MARKER_7q2`, write `RESULT: FAIL` and add a section "Design pivot" detailing the alternate path (user-installed MCP via `~/.grok/.mcp.json` registered by `memex doctor --install-mcp`). Halt the plan and revise before continuing.

- [ ] **Step 7: Cleanup the probe**

Run:
```bash
grok plugin uninstall probe-mcp --confirm
rm -rf tmp/probe-mcp-plugin
```

(`rm -rf` is acceptable here because `tmp/probe-mcp-plugin` was created fresh in Step 1 and contains no user data.)

- [ ] **Step 8: Commit the prereq deliverable**

```bash
git add docs/superpowers/prereqs/P1-mcp-from-plugin.md
git commit -m "docs(prereqs): record P1 — MCP-from-plugin loading"
```

---

### Task 0.2: Validate P2 — plugin hook firing in TTY

**Files:**
- Create: `tmp/probe-hook-plugin/.claude-plugin/plugin.json`
- Create: `tmp/probe-hook-plugin/hooks/hooks.json`
- Create: `tmp/probe-hook-plugin/bin/probe.sh`
- Create: `docs/superpowers/prereqs/P2-plugin-hook-firing.md`

- [ ] **Step 1: Create the probe hook plugin**

```bash
mkdir -p tmp/probe-hook-plugin/.claude-plugin tmp/probe-hook-plugin/hooks tmp/probe-hook-plugin/bin
```

`tmp/probe-hook-plugin/.claude-plugin/plugin.json`:
```json
{
  "name": "probe-hooks",
  "version": "0.0.1",
  "description": "Probe plugin-hook firing"
}
```

`tmp/probe-hook-plugin/hooks/hooks.json`:
```json
{
  "hooks": {
    "SessionStart":     [{ "hooks": [{ "type": "command", "command": "bash \"${CLAUDE_PLUGIN_ROOT}/bin/probe.sh\"", "timeout": 10 }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "bash \"${CLAUDE_PLUGIN_ROOT}/bin/probe.sh\"", "timeout": 10 }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "bash \"${CLAUDE_PLUGIN_ROOT}/bin/probe.sh\"", "timeout": 10 }] }]
  }
}
```

`tmp/probe-hook-plugin/bin/probe.sh`:
```bash
#!/usr/bin/env bash
set -u
LOG=/tmp/p2-probe.log
STDIN=$(cat)
{
  printf '=====\nTS=%s\nGROK_HOOK_EVENT=%s\nCLAUDE_PLUGIN_ROOT=%s\nGROK_PLUGIN_ROOT=%s\nSTDIN=%s\n' \
    "$(date -u +%FT%TZ)" "${GROK_HOOK_EVENT:-<unset>}" "${CLAUDE_PLUGIN_ROOT:-<unset>}" "${GROK_PLUGIN_ROOT:-<unset>}" "$STDIN"
} >> "$LOG"
exit 0
```

```bash
chmod +x tmp/probe-hook-plugin/bin/probe.sh
```

- [ ] **Step 2: Install and clear the log**

Run:
```bash
grok plugin install ./tmp/probe-hook-plugin --trust
> /tmp/p2-probe.log
```

- [ ] **Step 3: Run an interactive TTY session**

Open `grok` in a real terminal, send one short prompt (e.g. `say hi`), exit normally (`/exit`).

- [ ] **Step 4: Inspect the log**

```bash
wc -l /tmp/p2-probe.log
cat /tmp/p2-probe.log
```

Record which events fired (look for `GROK_HOOK_EVENT=session_start`, `user_prompt_submit`, `stop`) and whether `CLAUDE_PLUGIN_ROOT` / `GROK_PLUGIN_ROOT` expanded.

- [ ] **Step 5: Repeat in headless mode for comparison**

```bash
> /tmp/p2-probe.log
grok -p "say hi" --output-format plain
cat /tmp/p2-probe.log
```

- [ ] **Step 6: Write the deliverable doc**

`docs/superpowers/prereqs/P2-plugin-hook-firing.md`:
```markdown
# P2 — Plugin hook firing

**Date:** YYYY-MM-DD
**Grok version:** <`grok --version`>

## TTY mode

<paste log contents>

Events that fired: <list>

## Headless mode

<paste log contents>

Events that fired: <list>

## Result

RESULT: TTY-only | both | neither

## Implications for Plan 2

- If `TTY-only` or `both`: SessionStart hook is a viable warm-up path (best-effort).
- If `neither`: Plan 2 ships `memex doctor --install-hooks` as the primary install path, symlinking `hooks/hooks.json` content into `~/.grok/hooks/memex-grok.json` (global scope).
```

- [ ] **Step 7: Cleanup**

```bash
grok plugin uninstall probe-hooks --confirm
rm -f tmp/probe-hook-plugin/.claude-plugin/plugin.json tmp/probe-hook-plugin/hooks/hooks.json tmp/probe-hook-plugin/bin/probe.sh
rmdir tmp/probe-hook-plugin/.claude-plugin tmp/probe-hook-plugin/hooks tmp/probe-hook-plugin/bin tmp/probe-hook-plugin
rmdir tmp 2>/dev/null || true
rm -f /tmp/p2-probe.log
```

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/prereqs/P2-plugin-hook-firing.md
git commit -m "docs(prereqs): record P2 — plugin hook firing"
```

---

### Task 0.3: Validate P3 — `${CLAUDE_PLUGIN_ROOT}` expansion in plugin hooks

**Files:**
- Create: `docs/superpowers/prereqs/P3-plugin-env-vars.md`

- [ ] **Step 1: Check applicability**

If P2 result was `neither`, skip this task — there are no plugin hooks to probe. Write a one-line `docs/superpowers/prereqs/P3-plugin-env-vars.md` saying `SKIPPED: P2 reports plugin hooks do not fire` and commit.

If P2 was `TTY-only` or `both`, proceed.

- [ ] **Step 2: Read the P2 evidence**

Re-read `/tmp/p2-probe.log` from Task 0.2 (if you cleaned it up, re-run Task 0.2 steps 1–5). Note the values logged for `CLAUDE_PLUGIN_ROOT` and `GROK_PLUGIN_ROOT`.

- [ ] **Step 3: Write the deliverable doc**

`docs/superpowers/prereqs/P3-plugin-env-vars.md`:
```markdown
# P3 — Plugin env-var expansion

**Date:** YYYY-MM-DD

## Evidence

| Variable | Value observed in plugin hook |
|---|---|
| `CLAUDE_PLUGIN_ROOT` | <paste> |
| `GROK_PLUGIN_ROOT`   | <paste> |

## Result

RESULT: CLAUDE_PLUGIN_ROOT works | GROK_PLUGIN_ROOT only | neither

## Implications

- If `CLAUDE_PLUGIN_ROOT` works: `hooks/hooks.json` and `.mcp.json` in memex-grok use `${CLAUDE_PLUGIN_ROOT}` as written (no build substitution).
- If only `GROK_PLUGIN_ROOT`: `build.ts` substitutes `${CLAUDE_PLUGIN_ROOT}` → `${GROK_PLUGIN_ROOT}` in the shipped `.mcp.json` and `hooks/hooks.json`.
- If neither: hooks must use the absolute path that the `--install-hooks` doctor command writes; `.mcp.json` falls back to user-installed MCP via `grok mcp add`.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/prereqs/P3-plugin-env-vars.md
git commit -m "docs(prereqs): record P3 — plugin env-var expansion"
```

---

## Phase 1: Repo bootstrap

### Task 1: Package + tooling config

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.npmrc`, `stubs/sharp/{package.json,index.js}`, `src/main.ts`

> **Note:** the `src/main.ts` placeholder is included here so `pnpm typecheck` has at least one matching input file. Without it, `tsc --noEmit` errors with `TS18003: No inputs were found in config file`. Task 2 re-uses this same placeholder.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "memex-grok",
  "version": "0.1.0-alpha.0",
  "description": "Memex skill/memory/rule router for grok — semantic context via MCP and a shared cross-harness sync repo",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/jim80net/memex-grok"
  },
  "type": "module",
  "scripts": {
    "build": "bun run build.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  },
  "dependencies": {
    "@jim80net/memex-core": "^0.3.1",
    "@huggingface/transformers": "^3.8.1"
  },
  "packageManager": "pnpm@9.15.0",
  "pnpm": {
    "overrides": {
      "sharp": "link:./stubs/sharp"
    }
  }
}
```

> The `sharp` override + stub mirrors memex-claude — `@huggingface/transformers` pulls sharp but we never use image embeddings, and Bun's single-file compile chokes on sharp's native bindings.

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true
  },
  "include": ["src/**/*", "test/**/*", "scripts/**/*"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/.claude/worktrees/**",
      "**/tmp/**",
    ],
  },
});
```

- [ ] **Step 4: Write `.gitignore`** (extends the bootstrap `.worktrees/` entry already in place)

```
node_modules/
dist/
*.tsbuildinfo
.env
.env.*
.claude/settings.local.json
tmp/
.worktrees/

# Prebuilt binary (downloaded by bin/install.sh, not checked in)
bin/memex.bin
bin/memex.exe
bin/*.so*
bin/*.dylib
bin/*.dll
bin/.install-*
bin/.install.log
bin/.installing.lock
```

- [ ] **Step 5: Write `.npmrc`**

```
onnxruntime-node-install-cuda=skip
```

- [ ] **Step 6: Write sharp stub**

```bash
mkdir -p stubs/sharp
```

`stubs/sharp/package.json`:
```json
{
  "name": "sharp",
  "version": "0.0.0",
  "main": "index.js"
}
```

`stubs/sharp/index.js`:
```js
module.exports = {};
```

- [ ] **Step 7: Create `src/main.ts` placeholder**

```bash
mkdir -p src
```

`src/main.ts`:
```ts
#!/usr/bin/env node
// Placeholder — real dispatcher comes in Task 15.
console.error("memex-grok: not yet implemented");
process.exit(1);
```

This satisfies tsc's input-glob check. Task 2 re-uses this file as the build entry point; Task 15 replaces its contents with the real dispatcher.

- [ ] **Step 8: Install and verify tooling**

Run:
```bash
pnpm install
pnpm typecheck
```

Expected: both succeed without errors. `node_modules/` is created, `pnpm-lock.yaml` is generated, `tsc --noEmit` exits 0 against `src/main.ts`.

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore .npmrc stubs/ src/main.ts pnpm-lock.yaml
git commit -m "chore: bootstrap package, typescript, vitest, and pnpm config

Includes src/main.ts placeholder so pnpm typecheck has an input file;
the real dispatcher lands in Task 15."
```

---

### Task 2: Build script

**Files:**
- Create: `build.ts`

- [ ] **Step 1: Write `build.ts`**

Port memex-claude's `build.ts` near-verbatim — same ONNX bundling, same sharp-stub gymnastics, same platform matrix. The only difference is the binary name (`memex` stays; the repo identity is implicit in CHANGELOG/package.json).

```ts
#!/usr/bin/env bun
/**
 * Build script for memex-grok standalone binaries.
 *
 * Compiles src/main.ts into a self-contained executable via `bun build --compile`.
 * Sharp is stubbed (we only use text embeddings). The ONNX runtime shared library
 * is copied alongside the binary so the embedding model can load.
 *
 * Usage:
 *   bun run build.ts                         # current platform
 *   bun run build.ts --target bun-linux-x64  # cross-compile
 */
import { mkdirSync, cpSync, rmSync, symlinkSync, readlinkSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { platform, arch } from "node:os";

function resolveOnnxBase(): string {
  const pnpmBase = "node_modules/.pnpm";
  if (existsSync(pnpmBase)) {
    const entries = readdirSync(pnpmBase);
    const onnxDir = entries.find((e) => e.startsWith("onnxruntime-node@"));
    if (onnxDir) {
      return join(pnpmBase, onnxDir, "node_modules/onnxruntime-node/bin/napi-v3");
    }
  }
  return "node_modules/onnxruntime-node/bin/napi-v3";
}

const ONNX_BASE = resolveOnnxBase();
const SHARP_SYMLINK = "node_modules/.pnpm/@huggingface+transformers@3.8.1/node_modules/sharp";

interface PlatformFiles { onnxDir: string; sharedLibs: string[]; binaryName: string; }

const PLATFORMS: Record<string, PlatformFiles> = {
  "linux-x64":    { onnxDir: join(ONNX_BASE, "linux/x64"),    sharedLibs: ["libonnxruntime.so.1", "libonnxruntime_providers_shared.so"], binaryName: "memex" },
  "linux-arm64":  { onnxDir: join(ONNX_BASE, "linux/arm64"),  sharedLibs: ["libonnxruntime.so.1"],                                       binaryName: "memex" },
  "darwin-x64":   { onnxDir: join(ONNX_BASE, "darwin/x64"),   sharedLibs: ["libonnxruntime.1.21.0.dylib"],                                binaryName: "memex" },
  "darwin-arm64": { onnxDir: join(ONNX_BASE, "darwin/arm64"), sharedLibs: ["libonnxruntime.1.21.0.dylib"],                                binaryName: "memex" },
  "win32-x64":    { onnxDir: join(ONNX_BASE, "win32/x64"),    sharedLibs: ["onnxruntime.dll", "DirectML.dll"],                           binaryName: "memex.exe" },
  "win32-arm64":  { onnxDir: join(ONNX_BASE, "win32/arm64"),  sharedLibs: ["onnxruntime.dll", "DirectML.dll"],                           binaryName: "memex.exe" },
};

function detectPlatformKey(): string {
  const key = `${platform()}-${arch()}`;
  if (!(key in PLATFORMS)) { console.error(`Unsupported platform: ${key}`); process.exit(1); }
  return key;
}

function parseBunTarget(target: string): string {
  const m = target.match(/^bun-(linux|darwin|win(?:dows|32))-(x64|arm64)$/);
  if (!m) { console.error(`Invalid target: ${target}`); process.exit(1); }
  return `${m[1] === "windows" ? "win32" : m[1]}-${m[2]}`;
}

const targetArg = process.argv.find((a) => a.startsWith("--target"));
let targetFlag: string | undefined;
let platformKey: string;
if (targetArg) {
  const idx = process.argv.indexOf(targetArg);
  targetFlag = targetArg.includes("=") ? targetArg.split("=")[1] : process.argv[idx + 1];
  platformKey = parseBunTarget(targetFlag);
} else {
  platformKey = detectPlatformKey();
}

const platConfig = PLATFORMS[platformKey];
const outDir = join("dist", platformKey);
console.log(`Building memex-grok for ${platformKey}...`);

// Stub sharp so bun doesn't try to bundle native bindings
let sharpOrigTarget: string | null = null;
if (existsSync(SHARP_SYMLINK)) {
  try { sharpOrigTarget = readlinkSync(SHARP_SYMLINK); } catch { /* not a symlink */ }
  rmSync(SHARP_SYMLINK, { recursive: true, force: true });
}
mkdirSync(SHARP_SYMLINK, { recursive: true });
Bun.write(join(SHARP_SYMLINK, "package.json"), JSON.stringify({ name: "sharp", version: "0.0.0", main: "index.js" }));
Bun.write(join(SHARP_SYMLINK, "index.js"), "module.exports = {};");

try {
  const pkgVersion = JSON.parse(readFileSync("package.json", "utf-8")).version;
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, platConfig.binaryName);
  const args = ["build", "--compile", "src/main.ts", "--outfile", outFile, "--define", `process.env.MEMEX_GROK_VERSION='"${pkgVersion}"'`];
  if (targetFlag) args.push("--target", targetFlag);
  execSync(`bun ${args.join(" ")}`, { stdio: "inherit" });

  for (const lib of platConfig.sharedLibs) {
    const src = join(platConfig.onnxDir, lib);
    const dest = join(outDir, lib);
    if (existsSync(src)) { cpSync(src, dest); console.log(`  Copied ${lib}`); }
    else { console.warn(`  Warning: ${src} not found, skipping`); }
  }
  console.log(`\nBuild complete: ${outDir}/`);
} finally {
  rmSync(SHARP_SYMLINK, { recursive: true, force: true });
  if (sharpOrigTarget) { symlinkSync(sharpOrigTarget, SHARP_SYMLINK); }
}
```

- [ ] **Step 2: Verify `src/main.ts` placeholder is present**

Task 1 already created this file. Confirm:

```bash
test -f src/main.ts && head -4 src/main.ts
```

Expected output:
```
#!/usr/bin/env node
// Placeholder — real dispatcher comes in Task 15.
console.error("memex-grok: not yet implemented");
process.exit(1);
```

If the file is missing or differs, re-create it with the contents above before proceeding.

- [ ] **Step 3: Run the build to verify the toolchain works**

Run:
```bash
pnpm build
```

Expected: prints `Building memex-grok for <platform>...`, runs `bun build`, copies ONNX libs, ends with `Build complete: dist/<platform>/`. The resulting `dist/<platform>/memex` should be a runnable binary that exits 1 with the placeholder message.

- [ ] **Step 4: Verify the binary**

```bash
./dist/$(node -e "console.log(process.platform + '-' + process.arch)")/memex
```

Expected output on stderr: `memex-grok: not yet implemented`. Exit code: 1.

- [ ] **Step 5: Commit**

```bash
git add build.ts src/main.ts
git commit -m "build: add Bun compile script with ONNX runtime bundling"
```

---

## Phase 2: Core utilities

### Task 3: `src/core/paths.ts` — grok-rooted paths

**Files:**
- Create: `src/core/paths.ts`
- Create: `test/paths.test.ts`

- [ ] **Step 1: Write the failing test**

```bash
mkdir -p test
```

`test/paths.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";

describe("getGrokPaths", () => {
  const originalHome = process.env.HOME;
  beforeEach(() => { process.env.HOME = "/tmp/fake-home"; });
  afterEach(() => { process.env.HOME = originalHome; });

  it("roots cache, models, and sessions under ~/.grok/cache", async () => {
    const { getGrokPaths } = await import("../src/core/paths.ts");
    const p = getGrokPaths();
    expect(p.cacheDir).toBe(join("/tmp/fake-home", ".grok", "cache"));
    expect(p.modelsDir).toBe(join("/tmp/fake-home", ".grok", "cache", "models"));
    expect(p.sessionsDir).toBe(join("/tmp/fake-home", ".grok", "cache", "sessions"));
  });

  it("defaults sync repo to ~/.local/share/memex", async () => {
    const { getGrokPaths } = await import("../src/core/paths.ts");
    expect(getGrokPaths().syncRepoDir).toBe(join("/tmp/fake-home", ".local", "share", "memex"));
  });

  it("exposes global skill and rule dirs under ~/.grok and ~/.claude", async () => {
    const { getGrokPaths } = await import("../src/core/paths.ts");
    const p = getGrokPaths();
    expect(p.globalSkillsDirs).toEqual([
      join("/tmp/fake-home", ".grok", "skills"),
      join("/tmp/fake-home", ".claude", "skills"),
    ]);
    expect(p.globalRulesDirs).toEqual([
      join("/tmp/fake-home", ".grok", "rules"),
    ]);
  });

  it("derives project skill and rule dirs from cwd", async () => {
    const { getProjectSkillsDirs, getProjectRulesDirs } = await import("../src/core/paths.ts");
    expect(getProjectSkillsDirs("/work/repo")).toEqual([
      join("/work/repo", ".grok", "skills"),
      join("/work/repo", ".claude", "skills"),
    ]);
    expect(getProjectRulesDirs("/work/repo")).toEqual([
      join("/work/repo", ".grok", "rules"),
    ]);
  });

  it("exposes config and binary cache paths", async () => {
    const { getGrokPaths } = await import("../src/core/paths.ts");
    const p = getGrokPaths();
    expect(p.configPath).toBe(join("/tmp/fake-home", ".grok", "memex.json"));
    expect(p.binaryCacheDir).toBe(join("/tmp/fake-home", ".cache", "memex-grok"));
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run:
```bash
pnpm test test/paths.test.ts
```

Expected: FAIL — module `../src/core/paths.ts` does not exist.

- [ ] **Step 3: Write the implementation**

`src/core/paths.ts`:
```ts
import { homedir } from "node:os";
import { join } from "node:path";

export interface GrokPaths {
  cacheDir: string;
  modelsDir: string;
  sessionsDir: string;
  syncRepoDir: string;
  telemetryPath: string;
  configPath: string;
  binaryCacheDir: string;
  globalSkillsDirs: string[];
  globalRulesDirs: string[];
}

export function getGrokPaths(): GrokPaths {
  const home = homedir();
  const cacheDir = join(home, ".grok", "cache");
  return {
    cacheDir,
    modelsDir: join(cacheDir, "models"),
    sessionsDir: join(cacheDir, "sessions"),
    syncRepoDir: join(home, ".local", "share", "memex"),
    telemetryPath: join(cacheDir, "memex-telemetry.json"),
    configPath: join(home, ".grok", "memex.json"),
    binaryCacheDir: join(home, ".cache", "memex-grok"),
    globalSkillsDirs: [
      join(home, ".grok", "skills"),
      join(home, ".claude", "skills"),
    ],
    globalRulesDirs: [
      join(home, ".grok", "rules"),
    ],
  };
}

export function getProjectSkillsDirs(cwd: string): string[] {
  return [join(cwd, ".grok", "skills"), join(cwd, ".claude", "skills")];
}

export function getProjectRulesDirs(cwd: string): string[] {
  return [join(cwd, ".grok", "rules")];
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm test test/paths.test.ts`
Expected: 5 tests, all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/paths.ts test/paths.test.ts
git commit -m "feat(core): grok-rooted paths with sync repo and dual skill dirs"
```

---

### Task 4: `src/core/config.ts` — `GrokRouterConfig` + `loadConfig`

**Files:**
- Create: `src/core/config.ts`
- Create: `test/config.test.ts`

- [ ] **Step 1: Write the failing test**

`test/config.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("loadConfig", () => {
  let tmpHome: string;
  const originalHome = process.env.HOME;

  beforeEach(async () => {
    tmpHome = join(tmpdir(), `memex-grok-cfg-${Date.now()}-${Math.random()}`);
    await mkdir(join(tmpHome, ".grok"), { recursive: true });
    process.env.HOME = tmpHome;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tmpHome, { recursive: true, force: true });
  });

  it("returns defaults when no config file exists", async () => {
    const { loadConfig, DEFAULT_CONFIG } = await import("../src/core/config.ts");
    const cfg = await loadConfig();
    expect(cfg.enabled).toBe(DEFAULT_CONFIG.enabled);
    expect(cfg.sync.enabled).toBe(false);
    expect(cfg.mcp.enabled).toBe(true);
    expect(cfg.mcp.tools).toEqual(["memex_search", "memex_read_skill", "memex_status"]);
  });

  it("merges user values over defaults", async () => {
    await writeFile(join(tmpHome, ".grok", "memex.json"), JSON.stringify({
      enabled: false,
      sync: { enabled: true, repoDir: "/custom/sync" },
    }));
    const { loadConfig } = await import("../src/core/config.ts");
    const cfg = await loadConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.sync.enabled).toBe(true);
    expect(cfg.sync.repoDir).toBe("/custom/sync");
    expect(cfg.sync.autoPull).toBe(true); // default preserved
  });

  it("honors MEMEX_CONFIG override", async () => {
    const altPath = join(tmpHome, "alt.json");
    await writeFile(altPath, JSON.stringify({ enabled: false }));
    process.env.MEMEX_CONFIG = altPath;
    try {
      const { loadConfig } = await import("../src/core/config.ts");
      const cfg = await loadConfig();
      expect(cfg.enabled).toBe(false);
    } finally {
      delete process.env.MEMEX_CONFIG;
    }
  });

  it("falls back to defaults on malformed JSON without throwing", async () => {
    await writeFile(join(tmpHome, ".grok", "memex.json"), "{ not json");
    const { loadConfig } = await import("../src/core/config.ts");
    const cfg = await loadConfig();
    expect(cfg.enabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm test test/config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/core/config.ts`:
```ts
import { readFile } from "node:fs/promises";
import type { MemexCoreConfig, SyncConfig, SkillType } from "@jim80net/memex-core";
import { DEFAULT_CORE_CONFIG } from "@jim80net/memex-core";
import { getGrokPaths } from "./paths.ts";

export interface HookConfig {
  enabled: boolean;
  injectAdditionalContext?: boolean;
  wireFormat?: string;
  topK?: number;
  threshold?: number;
  maxInjectedChars?: number;
  types?: SkillType[];
}

export interface McpConfig {
  enabled: boolean;
  tools: string[];
  pullCacheMs: number;
}

export type GrokRouterConfig = MemexCoreConfig & {
  skillDirs: string[];
  sync: SyncConfig;
  hooks: {
    SessionStart: { enabled: boolean };
    UserPromptSubmit: HookConfig;
    Stop: HookConfig;
    PreCompact: { enabled: boolean };
  };
  mcp: McpConfig;
};

export const DEFAULT_CONFIG: GrokRouterConfig = {
  ...DEFAULT_CORE_CONFIG,
  enabled: true,
  skillDirs: [],
  sync: {
    enabled: false,
    repo: "",
    autoPull: true,
    autoCommitPush: true,
    projectMappings: {},
  },
  hooks: {
    SessionStart: { enabled: true },
    UserPromptSubmit: {
      enabled: true,
      injectAdditionalContext: false,
      wireFormat: "claude_hook_specific_output",
      topK: 3,
      threshold: 0.5,
      maxInjectedChars: 8000,
      types: ["skill", "memory", "workflow", "session-learning", "rule"],
    },
    Stop: { enabled: false },
    PreCompact: { enabled: false },
  },
  mcp: {
    enabled: true,
    tools: ["memex_search", "memex_read_skill", "memex_status"],
    pullCacheMs: 5 * 60 * 1000,
  },
};

function resolveConfigPath(): string {
  return process.env.MEMEX_CONFIG ?? getGrokPaths().configPath;
}

export async function loadConfig(): Promise<GrokRouterConfig> {
  const path = resolveConfigPath();
  try {
    const raw = await readFile(path, "utf-8");
    const user = JSON.parse(raw) as Partial<GrokRouterConfig>;
    return mergeConfig(user);
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

function mergeConfig(user: Partial<GrokRouterConfig>): GrokRouterConfig {
  const base = structuredClone(DEFAULT_CONFIG);
  if (typeof user.enabled === "boolean") base.enabled = user.enabled;
  if (typeof user.embeddingModel === "string") base.embeddingModel = user.embeddingModel;
  if (typeof user.cacheTimeMs === "number") base.cacheTimeMs = user.cacheTimeMs;
  if (Array.isArray(user.skillDirs)) base.skillDirs = user.skillDirs.map(String);
  if (user.sync) base.sync = { ...base.sync, ...user.sync };
  if (user.hooks) {
    if (user.hooks.SessionStart) base.hooks.SessionStart = { ...base.hooks.SessionStart, ...user.hooks.SessionStart };
    if (user.hooks.UserPromptSubmit) base.hooks.UserPromptSubmit = { ...base.hooks.UserPromptSubmit, ...user.hooks.UserPromptSubmit };
    if (user.hooks.Stop) base.hooks.Stop = { ...base.hooks.Stop, ...user.hooks.Stop };
    if (user.hooks.PreCompact) base.hooks.PreCompact = { ...base.hooks.PreCompact, ...user.hooks.PreCompact };
  }
  if (user.mcp) base.mcp = { ...base.mcp, ...user.mcp };
  return base;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm test test/config.test.ts`
Expected: 4 tests, all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/config.ts test/config.test.ts
git commit -m "feat(core): GrokRouterConfig with defaults, merge, and MEMEX_CONFIG override"
```

---

### Task 5: `src/core/index-init.ts` — SkillIndex factory for grok scan dirs

**Files:**
- Create: `src/core/index-init.ts`
- Create: `test/index-init.test.ts`

This wraps `@jim80net/memex-core`'s `SkillIndex` constructor with grok-specific scan-dir resolution. It does NOT do sync-repo writes (Plan 3) but DOES include the sync repo as a read source if `config.sync.enabled` and the repo directory exists.

- [ ] **Step 1: Write the failing test**

`test/index-init.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_CONFIG } from "../src/core/config.ts";

describe("buildScanDirs", () => {
  let tmpHome: string;
  const originalHome = process.env.HOME;

  beforeEach(async () => {
    tmpHome = join(tmpdir(), `mg-idx-${Date.now()}-${Math.random()}`);
    await mkdir(tmpHome, { recursive: true });
    process.env.HOME = tmpHome;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tmpHome, { recursive: true, force: true });
  });

  it("includes grok-global, claude-global, and project skill dirs", async () => {
    const { buildScanDirs } = await import("../src/core/index-init.ts");
    const dirs = buildScanDirs("/work/repo", DEFAULT_CONFIG);
    expect(dirs.skillDirs).toContain(join(tmpHome, ".grok", "skills"));
    expect(dirs.skillDirs).toContain(join(tmpHome, ".claude", "skills"));
    expect(dirs.skillDirs).toContain(join("/work/repo", ".grok", "skills"));
    expect(dirs.skillDirs).toContain(join("/work/repo", ".claude", "skills"));
  });

  it("includes user-configured extra skillDirs", async () => {
    const cfg = { ...DEFAULT_CONFIG, skillDirs: ["/team/skills"] };
    const { buildScanDirs } = await import("../src/core/index-init.ts");
    const dirs = buildScanDirs("/work/repo", cfg);
    expect(dirs.skillDirs).toContain("/team/skills");
  });

  it("includes sync repo skills when sync.enabled and dir exists", async () => {
    const syncDir = join(tmpHome, "syncrepo");
    await mkdir(join(syncDir, "skills"), { recursive: true });
    const cfg = { ...DEFAULT_CONFIG, sync: { ...DEFAULT_CONFIG.sync, enabled: true, repoDir: syncDir } };
    const { buildScanDirs } = await import("../src/core/index-init.ts");
    const dirs = buildScanDirs("/work/repo", cfg);
    expect(dirs.skillDirs).toContain(join(syncDir, "skills"));
  });

  it("omits sync repo skills when sync.enabled but dir missing", async () => {
    const cfg = { ...DEFAULT_CONFIG, sync: { ...DEFAULT_CONFIG.sync, enabled: true, repoDir: "/nope/missing" } };
    const { buildScanDirs } = await import("../src/core/index-init.ts");
    const dirs = buildScanDirs("/work/repo", cfg);
    expect(dirs.skillDirs).not.toContain(join("/nope/missing", "skills"));
  });

  it("omits memoryDirs in Plan 1 (sync writes deferred to Plan 3)", async () => {
    const { buildScanDirs } = await import("../src/core/index-init.ts");
    const dirs = buildScanDirs("/work/repo", DEFAULT_CONFIG);
    expect(dirs.memoryDirs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test test/index-init.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/core/index-init.ts`:
```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ScanDirs } from "@jim80net/memex-core";
import type { GrokRouterConfig } from "./config.ts";
import {
  getGrokPaths,
  getProjectSkillsDirs,
  getProjectRulesDirs,
} from "./paths.ts";

/**
 * Build the ScanDirs handed to memex-core's SkillIndex for a given cwd.
 *
 * Plan 1: index local + project skill/rule dirs and (if present) the
 * sync repo as a read-only source. Plan 3 will add memoryDirs once
 * canonicalProjectId is available from memex-core.
 */
export function buildScanDirs(cwd: string, config: GrokRouterConfig): ScanDirs {
  const paths = getGrokPaths();
  const skillDirs: string[] = [
    ...paths.globalSkillsDirs,
    ...getProjectSkillsDirs(cwd),
    ...config.skillDirs,
  ];
  const ruleDirs: string[] = [
    ...paths.globalRulesDirs,
    ...getProjectRulesDirs(cwd),
  ];

  if (config.sync.enabled) {
    const repoDir = config.sync.repoDir ?? paths.syncRepoDir;
    if (existsSync(join(repoDir, "skills"))) {
      skillDirs.push(join(repoDir, "skills"));
    }
    if (existsSync(join(repoDir, "rules"))) {
      ruleDirs.push(join(repoDir, "rules"));
    }
  }

  return {
    skillDirs,
    ruleDirs,
    memoryDirs: [], // populated in Plan 3
  };
}
```

> Note: `SyncConfig.repoDir` is read with `??`. The `SyncConfig` type from memex-core currently uses `repo: string`; if it lacks `repoDir`, add a TS-side augmentation in `src/core/types-augment.d.ts` declaring the optional field. Verify by running `pnpm typecheck` after this task — if it errors on `config.sync.repoDir`, create the augmentation file with:
>
> ```ts
> // src/core/types-augment.d.ts
> import "@jim80net/memex-core";
> declare module "@jim80net/memex-core" {
>   interface SyncConfig { repoDir?: string; }
> }
> ```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm test test/index-init.test.ts && pnpm typecheck`
Expected: 5 tests PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/core/index-init.ts test/index-init.test.ts src/core/types-augment.d.ts 2>/dev/null || git add src/core/index-init.ts test/index-init.test.ts
git commit -m "feat(core): buildScanDirs for grok-local + sync repo sources"
```

---

## Phase 3: MCP JSON-RPC framing

### Task 6: `src/mcp/framing.ts` — line-delimited JSON-RPC reader/writer

**Files:**
- Create: `src/mcp/framing.ts`
- Create: `test/mcp-framing.test.ts`

- [ ] **Step 1: Write the failing test**

`test/mcp-framing.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { Readable, Writable } from "node:stream";
import { readMessages, writeMessage, JsonRpcMessage } from "../src/mcp/framing.ts";

function makeReadable(lines: string[]): Readable {
  return Readable.from(lines.map((l) => l + "\n"));
}

class CollectingWritable extends Writable {
  chunks: string[] = [];
  _write(chunk: Buffer, _enc: string, cb: () => void) { this.chunks.push(chunk.toString("utf8")); cb(); }
}

describe("readMessages", () => {
  it("yields one message per line", async () => {
    const input = makeReadable([
      '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
      '{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
    ]);
    const out: JsonRpcMessage[] = [];
    for await (const msg of readMessages(input)) out.push(msg);
    expect(out).toEqual([
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]);
  });

  it("skips blank lines silently", async () => {
    const input = makeReadable(['{"jsonrpc":"2.0","id":1,"method":"x"}', "", "   "]);
    const out: JsonRpcMessage[] = [];
    for await (const msg of readMessages(input)) out.push(msg);
    expect(out.length).toBe(1);
  });

  it("throws on malformed JSON", async () => {
    const input = makeReadable(["{not json"]);
    let err: unknown;
    try {
      for await (const _ of readMessages(input)) { /* unused */ }
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(Error);
  });
});

describe("writeMessage", () => {
  it("writes a single JSON line terminated with \\n", async () => {
    const out = new CollectingWritable();
    await writeMessage(out, { jsonrpc: "2.0", id: 1, result: { ok: true } });
    expect(out.chunks.join("")).toBe('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n');
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `pnpm test test/mcp-framing.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```bash
mkdir -p src/mcp
```

`src/mcp/framing.ts`:
```ts
import type { Readable, Writable } from "node:stream";

export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** Yields one JsonRpcMessage per non-blank line on the given stream. */
export async function* readMessages(input: Readable): AsyncGenerator<JsonRpcMessage> {
  let buffer = "";
  for await (const chunk of input) {
    buffer += chunk.toString("utf8");
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      yield JSON.parse(line) as JsonRpcMessage;
    }
  }
  const tail = buffer.trim();
  if (tail) yield JSON.parse(tail) as JsonRpcMessage;
}

/** Writes a single JsonRpcMessage as a JSON line ending with \n. */
export function writeMessage(output: Writable, msg: JsonRpcMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    output.write(JSON.stringify(msg) + "\n", (err) => (err ? reject(err) : resolve()));
  });
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm test test/mcp-framing.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/framing.ts test/mcp-framing.test.ts
git commit -m "feat(mcp): line-delimited JSON-RPC framing"
```

---

### Task 7: `src/mcp/server.ts` — initialize + tools/list dispatch

**Files:**
- Create: `src/mcp/server.ts`
- Create: `test/mcp-server.test.ts`

- [ ] **Step 1: Write the failing test (initialize + tools/list)**

`test/mcp-server.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { runMcpServer, type ToolHandler } from "../src/mcp/server.ts";

function makeStreams() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  return { stdin, stdout };
}

async function collectFor(ms: number, stream: PassThrough): Promise<string> {
  const chunks: Buffer[] = [];
  const onData = (c: Buffer) => chunks.push(c);
  stream.on("data", onData);
  await new Promise((r) => setTimeout(r, ms));
  stream.off("data", onData);
  return Buffer.concat(chunks).toString("utf8");
}

describe("runMcpServer", () => {
  it("responds to initialize with serverInfo and capabilities", async () => {
    const { stdin, stdout } = makeStreams();
    const tools: ToolHandler[] = [];
    const done = runMcpServer({ stdin, stdout, tools });
    stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
    const out = await collectFor(50, stdout);
    stdin.end();
    await done;
    const parsed = JSON.parse(out.trim().split("\n")[0]);
    expect(parsed.id).toBe(1);
    expect(parsed.result.serverInfo.name).toBe("memex");
    expect(parsed.result.capabilities.tools).toBeDefined();
    expect(parsed.result.protocolVersion).toBeDefined();
  });

  it("responds to tools/list with all registered tools", async () => {
    const { stdin, stdout } = makeStreams();
    const tools: ToolHandler[] = [
      { name: "alpha", description: "first",  inputSchema: { type: "object" }, call: async () => ({ content: [{ type: "text", text: "ok" }] }) },
      { name: "beta",  description: "second", inputSchema: { type: "object" }, call: async () => ({ content: [{ type: "text", text: "ok" }] }) },
    ];
    const done = runMcpServer({ stdin, stdout, tools });
    stdin.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');
    const out = await collectFor(50, stdout);
    stdin.end();
    await done;
    const parsed = JSON.parse(out.trim().split("\n")[0]);
    expect(parsed.result.tools.map((t: { name: string }) => t.name)).toEqual(["alpha", "beta"]);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `pnpm test test/mcp-server.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`src/mcp/server.ts`:
```ts
import type { Readable, Writable } from "node:stream";
import { readMessages, writeMessage, type JsonRpcMessage } from "./framing.ts";

export interface ToolHandler {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  call: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>;
}

export interface McpServerOptions {
  stdin: Readable;
  stdout: Writable;
  tools: ToolHandler[];
  onError?: (msg: string) => void;
}

const PROTOCOL_VERSION = "2024-11-05";

export async function runMcpServer(opts: McpServerOptions): Promise<void> {
  const { stdin, stdout, tools, onError } = opts;
  const log = onError ?? ((m: string) => process.stderr.write(`memex-mcp: ${m}\n`));
  const byName = new Map(tools.map((t) => [t.name, t]));

  for await (const msg of readMessages(stdin)) {
    try {
      await dispatch(msg);
    } catch (e) {
      log(`dispatch error: ${e instanceof Error ? e.message : String(e)}`);
      if (msg.id != null) {
        await writeMessage(stdout, {
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32603, message: e instanceof Error ? e.message : String(e) },
        });
      }
    }
  }

  async function dispatch(msg: JsonRpcMessage): Promise<void> {
    if (msg.method === "initialize") {
      await reply(msg.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "memex", version: process.env.MEMEX_GROK_VERSION ?? "0.0.0" },
      });
    } else if (msg.method === "notifications/initialized") {
      // no response
    } else if (msg.method === "tools/list") {
      await reply(msg.id, {
        tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      });
    } else if (msg.method === "tools/call") {
      const params = (msg.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      const tool = params.name ? byName.get(params.name) : undefined;
      if (!tool) {
        await replyError(msg.id, -32601, `unknown tool: ${params.name}`);
        return;
      }
      const result = await tool.call(params.arguments ?? {});
      await reply(msg.id, result);
    } else if (msg.method !== undefined) {
      await replyError(msg.id, -32601, `unknown method: ${msg.method}`);
    }
  }

  async function reply(id: JsonRpcMessage["id"], result: unknown): Promise<void> {
    if (id == null) return;
    await writeMessage(stdout, { jsonrpc: "2.0", id, result });
  }
  async function replyError(id: JsonRpcMessage["id"], code: number, message: string): Promise<void> {
    if (id == null) return;
    await writeMessage(stdout, { jsonrpc: "2.0", id, error: { code, message } });
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm test test/mcp-server.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts test/mcp-server.test.ts
git commit -m "feat(mcp): server loop with initialize, tools/list, tools/call dispatch"
```

---

### Task 8: Test tools/call dispatch with unknown-tool + handler-error cases

**Files:**
- Modify: `test/mcp-server.test.ts`

- [ ] **Step 1: Add cases to the existing test file**

Append to `test/mcp-server.test.ts`:
```ts
describe("runMcpServer error envelopes", () => {
  function makeStreams() { return { stdin: new (require("node:stream").PassThrough)(), stdout: new (require("node:stream").PassThrough)() }; }
  async function collectFor(ms: number, stream: { on: Function; off: Function }) {
    const chunks: Buffer[] = [];
    const onData = (c: Buffer) => chunks.push(c);
    stream.on("data", onData);
    await new Promise((r) => setTimeout(r, ms));
    stream.off("data", onData);
    return Buffer.concat(chunks).toString("utf8");
  }

  it("returns -32601 for unknown tool", async () => {
    const { stdin, stdout } = makeStreams();
    const done = runMcpServer({ stdin, stdout, tools: [] });
    stdin.write('{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"nope","arguments":{}}}\n');
    const out = await collectFor(50, stdout);
    stdin.end(); await done;
    const parsed = JSON.parse(out.trim().split("\n")[0]);
    expect(parsed.error.code).toBe(-32601);
    expect(parsed.error.message).toContain("nope");
  });

  it("returns -32603 when a tool handler throws", async () => {
    const { stdin, stdout } = makeStreams();
    const tools = [{
      name: "boom",
      description: "throws",
      inputSchema: { type: "object" },
      call: async () => { throw new Error("kaboom"); },
    }];
    const done = runMcpServer({ stdin, stdout, tools });
    stdin.write('{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"boom","arguments":{}}}\n');
    const out = await collectFor(50, stdout);
    stdin.end(); await done;
    const parsed = JSON.parse(out.trim().split("\n")[0]);
    expect(parsed.error.code).toBe(-32603);
    expect(parsed.error.message).toBe("kaboom");
  });
});
```

- [ ] **Step 2: Run, verify pass**

Run: `pnpm test test/mcp-server.test.ts`
Expected: 4 tests PASS (2 from Task 7 + 2 new).

- [ ] **Step 3: Commit**

```bash
git add test/mcp-server.test.ts
git commit -m "test(mcp): error envelopes for unknown tool and handler throws"
```

---

## Phase 4: MCP tool implementations

### Task 9: `memex_status` tool

**Files:**
- Create: `src/mcp/tools-status.ts`
- Create: `test/mcp-tools-status.test.ts`

> One file per tool keeps each module focused; an aggregator `src/mcp/tools.ts` is added in Task 12.

- [ ] **Step 1: Write the failing test**

`test/mcp-tools-status.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { makeStatusTool } from "../src/mcp/tools-status.ts";
import { DEFAULT_CONFIG } from "../src/core/config.ts";

describe("memex_status tool", () => {
  it("returns a JSON content block with index size and sync state", async () => {
    const fakeIndex = { size: 42, sourceCounts: { skill: 30, rule: 12 } };
    const tool = makeStatusTool({
      config: DEFAULT_CONFIG,
      getIndexStats: () => fakeIndex,
      getLastSyncAt: () => "2026-05-25T12:00:00Z",
    });
    expect(tool.name).toBe("memex_status");
    const result = await tool.call({});
    const text = result.content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.index_size).toBe(42);
    expect(parsed.source_counts).toEqual({ skill: 30, rule: 12 });
    expect(parsed.last_sync_at).toBe("2026-05-25T12:00:00Z");
    expect(parsed.sync_enabled).toBe(false);
    expect(parsed.embedding_model).toBe(DEFAULT_CONFIG.embeddingModel);
  });

  it("emits null last_sync_at when unknown", async () => {
    const tool = makeStatusTool({
      config: DEFAULT_CONFIG,
      getIndexStats: () => ({ size: 0, sourceCounts: {} }),
      getLastSyncAt: () => null,
    });
    const result = await tool.call({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.last_sync_at).toBeNull();
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `pnpm test test/mcp-tools-status.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/mcp/tools-status.ts`:
```ts
import type { ToolHandler } from "./server.ts";
import type { GrokRouterConfig } from "../core/config.ts";

export interface IndexStats {
  size: number;
  sourceCounts: Record<string, number>;
}

export interface StatusDeps {
  config: GrokRouterConfig;
  getIndexStats: () => IndexStats;
  getLastSyncAt: () => string | null;
}

export function makeStatusTool(deps: StatusDeps): ToolHandler {
  return {
    name: "memex_status",
    description: "Report memex installation state: index size, source counts by type, last sync time, and embedding model. Useful for the model to introspect whether memex_search is likely to be productive.",
    inputSchema: { type: "object", properties: {}, required: [] },
    call: async () => {
      const stats = deps.getIndexStats();
      const payload = {
        index_size: stats.size,
        source_counts: stats.sourceCounts,
        last_sync_at: deps.getLastSyncAt(),
        sync_enabled: deps.config.sync.enabled,
        embedding_model: deps.config.embeddingModel,
      };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    },
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm test test/mcp-tools-status.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools-status.ts test/mcp-tools-status.test.ts
git commit -m "feat(mcp): memex_status tool reports index and sync state"
```

---

### Task 10: `memex_search` tool with `query_id`

**Files:**
- Create: `src/mcp/tools-search.ts`
- Create: `test/mcp-tools-search.test.ts`

- [ ] **Step 1: Write the failing test**

`test/mcp-tools-search.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { makeSearchTool } from "../src/mcp/tools-search.ts";

interface FakeIndex {
  search: ReturnType<typeof vi.fn>;
}

function fakeResult(name: string, score: number) {
  return {
    skill: { name, type: "skill", location: `/skills/${name}.md`, description: `desc ${name}` },
    score,
    bestQueryIndex: 0,
  };
}

describe("memex_search tool", () => {
  it("returns query_id and result list", async () => {
    const index: FakeIndex = {
      search: vi.fn().mockResolvedValue([fakeResult("alpha", 0.9), fakeResult("beta", 0.7)]),
    };
    const tool = makeSearchTool({ index: index as any, defaultTopK: 5, defaultThreshold: 0.5 });
    const result = await tool.call({ query: "deploy spark" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.query_id).toMatch(/^q-/);
    expect(parsed.results.map((r: { name: string }) => r.name)).toEqual(["alpha", "beta"]);
    expect(parsed.results[0].relevance).toBe(0.9);
    expect(index.search).toHaveBeenCalledWith("deploy spark", 5, 0.5, undefined);
  });

  it("honors top_k, threshold, and types args", async () => {
    const index: FakeIndex = { search: vi.fn().mockResolvedValue([]) };
    const tool = makeSearchTool({ index: index as any, defaultTopK: 5, defaultThreshold: 0.5 });
    await tool.call({ query: "x", top_k: 2, threshold: 0.7, types: ["skill", "rule"] });
    expect(index.search).toHaveBeenCalledWith("x", 2, 0.7, ["skill", "rule"]);
  });

  it("returns empty results array for no matches (not an error)", async () => {
    const index: FakeIndex = { search: vi.fn().mockResolvedValue([]) };
    const tool = makeSearchTool({ index: index as any, defaultTopK: 5, defaultThreshold: 0.5 });
    const result = await tool.call({ query: "anything" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.results).toEqual([]);
    expect(parsed.query_id).toBeTruthy();
    expect(result.isError).toBeUndefined();
  });

  it("rejects empty query with isError", async () => {
    const index: FakeIndex = { search: vi.fn() };
    const tool = makeSearchTool({ index: index as any, defaultTopK: 5, defaultThreshold: 0.5 });
    const result = await tool.call({ query: "   " });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/non-empty/);
    expect(index.search).not.toHaveBeenCalled();
  });

  it("generates a unique query_id per call", async () => {
    const index: FakeIndex = { search: vi.fn().mockResolvedValue([]) };
    const tool = makeSearchTool({ index: index as any, defaultTopK: 5, defaultThreshold: 0.5 });
    const a = JSON.parse((await tool.call({ query: "a" })).content[0].text).query_id;
    const b = JSON.parse((await tool.call({ query: "b" })).content[0].text).query_id;
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `pnpm test test/mcp-tools-search.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`src/mcp/tools-search.ts`:
```ts
import { randomBytes } from "node:crypto";
import type { SkillIndex, SkillType } from "@jim80net/memex-core";
import type { ToolHandler } from "./server.ts";

export interface SearchDeps {
  index: Pick<SkillIndex, "search">;
  defaultTopK: number;
  defaultThreshold: number;
}

export function makeSearchTool(deps: SearchDeps): ToolHandler {
  return {
    name: "memex_search",
    description: searchDescription(),
    inputSchema: {
      type: "object",
      properties: {
        query:     { type: "string", description: "Natural-language query." },
        top_k:     { type: "integer", minimum: 1, maximum: 20, description: "Max results (default 5)." },
        threshold: { type: "number",  minimum: 0, maximum: 1,  description: "Minimum cosine similarity (default 0.5)." },
        types:     { type: "array", items: { type: "string", enum: ["skill", "memory", "rule", "workflow", "session-learning", "tool-guidance"] }, description: "Restrict to these entry types." },
      },
      required: ["query"],
    },
    call: async (args: Record<string, unknown>) => {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) {
        return { isError: true, content: [{ type: "text", text: 'query must be non-empty' }] };
      }
      const topK = typeof args.top_k === "number" ? args.top_k : deps.defaultTopK;
      const threshold = typeof args.threshold === "number" ? args.threshold : deps.defaultThreshold;
      const types = Array.isArray(args.types) ? (args.types as SkillType[]) : undefined;

      const hits = await deps.index.search(query, topK, threshold, types);
      const queryId = `q-${randomBytes(6).toString("hex")}`;
      const payload = {
        query_id: queryId,
        results: hits.map((h) => ({
          name: h.skill.name,
          type: h.skill.type,
          location: h.skill.location,
          relevance: h.score,
          description: h.skill.description,
          best_query_index: h.bestQueryIndex,
        })),
      };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    },
  };
}

function searchDescription(): string {
  return [
    "Search the user's cross-harness memex corpus — curated skills, rules, and",
    "long-lived preferences synced via git across machines and AI coding harnesses.",
    "Use this for procedural know-how ('how do I deploy X?'), coding conventions,",
    "recurring workflows, or personal preferences likely to have been recorded",
    "across past sessions. This is different from `memory_search`, which only",
    "covers grok's per-workspace conversational memory.",
    "",
    "Returns `{ query_id, results: [...] }`. Pass `query_id` to `memex_read_skill`",
    "when fetching content so telemetry can attribute the read to this query.",
  ].join("\n");
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm test test/mcp-tools-search.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools-search.ts test/mcp-tools-search.test.ts
git commit -m "feat(mcp): memex_search tool with query_id and empty-result handling"
```

> **Deferred in Plan 1:** the mcp-server spec calls for prepending *"Use this BEFORE `memory_search`..."* to the description when grok's native `memory_search` is detected. Detecting other MCP servers from inside our own MCP server requires extra grok-inspection plumbing — implemented as part of Plan 2 (which already needs `grok inspect --json` for the doctor coexistence checks). For Plan 1, the static description ("This is different from `memory_search`") is shipped without the conditional preamble.

---

### Task 11: `memex_read_skill` tool with telemetry threading

**Files:**
- Create: `src/mcp/tools-read.ts`
- Create: `test/mcp-tools-read.test.ts`

- [ ] **Step 1: Write the failing test**

`test/mcp-tools-read.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { makeReadSkillTool } from "../src/mcp/tools-read.ts";

describe("memex_read_skill tool", () => {
  it("returns the file content via index.readSkillContent", async () => {
    const index = { readSkillContent: vi.fn().mockResolvedValue("# A skill\nbody") };
    const recordMatch = vi.fn();
    const tool = makeReadSkillTool({ index: index as any, recordMatch, sessionId: () => "s-1" });
    const result = await tool.call({ location: "/a.md" });
    expect(result.content[0].text).toBe("# A skill\nbody");
    expect(index.readSkillContent).toHaveBeenCalledWith("/a.md");
  });

  it("records telemetry when query_id is provided", async () => {
    const index = { readSkillContent: vi.fn().mockResolvedValue("body") };
    const recordMatch = vi.fn();
    const tool = makeReadSkillTool({ index: index as any, recordMatch, sessionId: () => "s-9" });
    await tool.call({ location: "/b.md", query_id: "q-abc" });
    expect(recordMatch).toHaveBeenCalledWith({ location: "/b.md", queryId: "q-abc", sessionId: "s-9" });
  });

  it("does not record telemetry when query_id is missing", async () => {
    const index = { readSkillContent: vi.fn().mockResolvedValue("body") };
    const recordMatch = vi.fn();
    const tool = makeReadSkillTool({ index: index as any, recordMatch, sessionId: () => "s-9" });
    await tool.call({ location: "/c.md" });
    expect(recordMatch).not.toHaveBeenCalled();
  });

  it("returns isError when location is missing", async () => {
    const index = { readSkillContent: vi.fn() };
    const tool = makeReadSkillTool({ index: index as any, recordMatch: () => {}, sessionId: () => "s-9" });
    const result = await tool.call({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/location/);
  });

  it("returns isError when readSkillContent throws", async () => {
    const index = { readSkillContent: vi.fn().mockRejectedValue(new Error("ENOENT")) };
    const tool = makeReadSkillTool({ index: index as any, recordMatch: () => {}, sessionId: () => "s-9" });
    const result = await tool.call({ location: "/missing.md" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("ENOENT");
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `pnpm test test/mcp-tools-read.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`src/mcp/tools-read.ts`:
```ts
import type { SkillIndex } from "@jim80net/memex-core";
import type { ToolHandler } from "./server.ts";

export interface RecordMatchArgs {
  location: string;
  queryId: string;
  sessionId: string;
}

export interface ReadSkillDeps {
  index: Pick<SkillIndex, "readSkillContent">;
  recordMatch: (args: RecordMatchArgs) => void | Promise<void>;
  sessionId: () => string;
}

export function makeReadSkillTool(deps: ReadSkillDeps): ToolHandler {
  return {
    name: "memex_read_skill",
    description: [
      "Read the full content of a skill, rule, or memory by `location` (path returned from",
      "`memex_search`). If `query_id` is provided, the read is recorded as a telemetry match",
      "for the originating search — this keeps the GEPA query-refinement loop running and",
      "improves future relevance ranking. Always pass the `query_id` from the search that",
      "led you here.",
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        location: { type: "string", description: "Absolute path to the skill/rule/memory file." },
        query_id: { type: "string", description: "The query_id from the memex_search call that surfaced this result." },
      },
      required: ["location"],
    },
    call: async (args: Record<string, unknown>) => {
      const location = typeof args.location === "string" ? args.location : "";
      if (!location) {
        return { isError: true, content: [{ type: "text", text: "location must be a non-empty string" }] };
      }
      try {
        const content = await deps.index.readSkillContent(location);
        const qid = typeof args.query_id === "string" ? args.query_id : null;
        if (qid) {
          try { await deps.recordMatch({ location, queryId: qid, sessionId: deps.sessionId() }); }
          catch { /* telemetry is best-effort */ }
        }
        return { content: [{ type: "text", text: content }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { isError: true, content: [{ type: "text", text: msg }] };
      }
    },
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm test test/mcp-tools-read.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools-read.ts test/mcp-tools-read.test.ts
git commit -m "feat(mcp): memex_read_skill tool with implicit telemetry on query_id"
```

---

### Task 12: Tool aggregator `src/mcp/tools.ts`

**Files:**
- Create: `src/mcp/tools.ts`
- Create: `test/mcp-tools-aggregator.test.ts`

- [ ] **Step 1: Write the failing test**

`test/mcp-tools-aggregator.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { makeMemexTools } from "../src/mcp/tools.ts";
import { DEFAULT_CONFIG } from "../src/core/config.ts";

describe("makeMemexTools", () => {
  it("returns exactly three tools in declared order", () => {
    const tools = makeMemexTools({
      config: DEFAULT_CONFIG,
      index: { search: vi.fn(), readSkillContent: vi.fn() } as any,
      getIndexStats: () => ({ size: 0, sourceCounts: {} }),
      getLastSyncAt: () => null,
      recordMatch: () => {},
      sessionId: () => "s",
    });
    expect(tools.map((t) => t.name)).toEqual(["memex_search", "memex_read_skill", "memex_status"]);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `pnpm test test/mcp-tools-aggregator.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`src/mcp/tools.ts`:
```ts
import type { SkillIndex } from "@jim80net/memex-core";
import type { ToolHandler } from "./server.ts";
import type { GrokRouterConfig } from "../core/config.ts";
import { makeSearchTool } from "./tools-search.ts";
import { makeReadSkillTool, type RecordMatchArgs } from "./tools-read.ts";
import { makeStatusTool, type IndexStats } from "./tools-status.ts";

export interface MemexToolsDeps {
  config: GrokRouterConfig;
  index: SkillIndex;
  getIndexStats: () => IndexStats;
  getLastSyncAt: () => string | null;
  recordMatch: (args: RecordMatchArgs) => void | Promise<void>;
  sessionId: () => string;
}

export function makeMemexTools(deps: MemexToolsDeps): ToolHandler[] {
  return [
    makeSearchTool({
      index: deps.index,
      defaultTopK: deps.config.hooks.UserPromptSubmit.topK ?? 5,
      defaultThreshold: deps.config.hooks.UserPromptSubmit.threshold ?? 0.5,
    }),
    makeReadSkillTool({
      index: deps.index,
      recordMatch: deps.recordMatch,
      sessionId: deps.sessionId,
    }),
    makeStatusTool({
      config: deps.config,
      getIndexStats: deps.getIndexStats,
      getLastSyncAt: deps.getLastSyncAt,
    }),
  ];
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm test test/mcp-tools-aggregator.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools.ts test/mcp-tools-aggregator.test.ts
git commit -m "feat(mcp): tools aggregator wires search/read/status in declared order"
```

---

## Phase 5: First-call init + lifecycle

### Task 13: `src/mcp/init.ts` — first-call sync-pull + index gating

**Files:**
- Create: `src/mcp/init.ts`
- Create: `test/mcp-init.test.ts`

- [ ] **Step 1: Write the failing test**

`test/mcp-init.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { OnceInit } from "../src/mcp/init.ts";

describe("OnceInit", () => {
  it("runs the work exactly once across concurrent calls", async () => {
    const work = vi.fn().mockImplementation(async () => { await new Promise((r) => setTimeout(r, 10)); return "ok"; });
    const init = new OnceInit(work);
    const a = init.ensure();
    const b = init.ensure();
    const c = init.ensure();
    expect(await Promise.all([a, b, c])).toEqual(["ok", "ok", "ok"]);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("re-uses the resolved value on subsequent calls", async () => {
    const work = vi.fn().mockResolvedValue("first");
    const init = new OnceInit(work);
    await init.ensure();
    await init.ensure();
    await init.ensure();
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("re-runs on failure for a subsequent call", async () => {
    let n = 0;
    const work = vi.fn().mockImplementation(async () => { n += 1; if (n === 1) throw new Error("transient"); return "ok"; });
    const init = new OnceInit(work);
    await expect(init.ensure()).rejects.toThrow("transient");
    expect(await init.ensure()).toBe("ok");
    expect(work).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `pnpm test test/mcp-init.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`src/mcp/init.ts`:
```ts
/**
 * Run an async initialization exactly once across concurrent callers.
 * If the work fails, the next caller retries.
 */
export class OnceInit<T> {
  private pending: Promise<T> | null = null;
  private done = false;
  private value: T | undefined;

  constructor(private work: () => Promise<T>) {}

  async ensure(): Promise<T> {
    if (this.done) return this.value as T;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      try {
        const v = await this.work();
        this.value = v;
        this.done = true;
        return v;
      } finally {
        if (!this.done) this.pending = null;
      }
    })();
    return this.pending;
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test test/mcp-init.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/init.ts test/mcp-init.test.ts
git commit -m "feat(mcp): OnceInit primitive for first-call sync+index gating"
```

---

### Task 14: `src/mcp/main.ts` — server entry that wires init, index, tools, and shutdown

**Files:**
- Create: `src/mcp/main.ts`
- Create: `test/mcp-main.test.ts`

- [ ] **Step 1: Write the failing test (smoke: index build runs once, then tools/list works)**

`test/mcp-main.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PassThrough } from "node:stream";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("runMemexMcp end-to-end", () => {
  let tmpHome: string;
  const originalHome = process.env.HOME;

  beforeEach(async () => {
    tmpHome = join(tmpdir(), `mg-main-${Date.now()}-${Math.random()}`);
    await mkdir(join(tmpHome, ".grok", "skills", "hello"), { recursive: true });
    await writeFile(
      join(tmpHome, ".grok", "skills", "hello", "SKILL.md"),
      "---\nname: hello\ndescription: Says hello.\nqueries:\n  - hi\n  - hello\n---\n\nHello there.\n"
    );
    process.env.HOME = tmpHome;
  });
  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tmpHome, { recursive: true, force: true });
  });

  it("loads skills, exposes tools, and serves memex_search end-to-end", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const { runMemexMcp } = await import("../src/mcp/main.ts");
    const done = runMemexMcp({ stdin, stdout, cwd: "/work" });

    // handshake
    stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
    stdin.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');
    stdin.write('{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"memex_search","arguments":{"query":"say hi"}}}\n');

    const chunks: Buffer[] = [];
    stdout.on("data", (c) => chunks.push(c));
    await new Promise((r) => setTimeout(r, 500)); // allow embedding model to load
    stdin.end();
    await done;
    const lines = Buffer.concat(chunks).toString("utf8").trim().split("\n").map((l) => JSON.parse(l));

    expect(lines[0].result.serverInfo.name).toBe("memex");
    expect(lines[1].result.tools.map((t: { name: string }) => t.name)).toEqual(["memex_search", "memex_read_skill", "memex_status"]);
    const searchPayload = JSON.parse(lines[2].result.content[0].text);
    expect(searchPayload.query_id).toBeTruthy();
    expect(searchPayload.results.length).toBeGreaterThanOrEqual(1);
    expect(searchPayload.results[0].name).toBe("hello");
  }, 30000);
});
```

- [ ] **Step 2: Verify fail**

Run: `pnpm test test/mcp-main.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/mcp/main.ts`:
```ts
import type { Readable, Writable } from "node:stream";
import { join } from "node:path";
import {
  SkillIndex,
  LocalEmbeddingProvider,
  loadTelemetry,
  saveTelemetry,
  recordMatch as coreRecordMatch,
  withFileLock,
} from "@jim80net/memex-core";
import { loadConfig } from "../core/config.ts";
import { getGrokPaths } from "../core/paths.ts";
import { buildScanDirs } from "../core/index-init.ts";
import { runMcpServer } from "./server.ts";
import { makeMemexTools } from "./tools.ts";
import { OnceInit } from "./init.ts";

export interface RunMemexMcpOptions {
  stdin: Readable;
  stdout: Writable;
  cwd?: string;
}

export async function runMemexMcp(opts: RunMemexMcpOptions): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const config = await loadConfig();
  const paths = getGrokPaths();
  const provider = new LocalEmbeddingProvider(config.embeddingModel, paths.modelsDir);
  const cachePath = join(paths.cacheDir, "memex-cache.json");
  const index = new SkillIndex(config, provider, cachePath);
  const scanDirs = buildScanDirs(cwd, config);

  const init = new OnceInit(async () => {
    await index.build(scanDirs);
  });

  // Per-process session ID (no grok-supplied id in stdio MCP).
  const sessionId = `mcp-${process.pid}-${Date.now()}`;
  const lastSyncAt: string | null = null; // Plan 3 wires real sync state.

  const tools = makeMemexTools({
    config,
    index,
    getIndexStats: () => ({
      size: countSkills(index),
      sourceCounts: countByType(index),
    }),
    getLastSyncAt: () => lastSyncAt,
    recordMatch: async ({ location, queryId, sessionId: sid }) => {
      try {
        await withFileLock(paths.telemetryPath, async () => {
          const telemetry = await loadTelemetry(paths.telemetryPath);
          // Map our opaque queryId → core's bestQueryIndex stored on the search hit.
          // For Plan 1 we approximate with index 0; Plan 2 will thread real index via in-memory map keyed by queryId.
          coreRecordMatch(telemetry, location, sid, 0);
          await saveTelemetry(paths.telemetryPath, telemetry);
        });
      } catch {
        // best-effort
      }
    },
    sessionId: () => sessionId,
  });

  // Ensure init runs on any tools/call before the handler executes.
  const wrappedTools = tools.map((t) => ({
    ...t,
    call: async (args: Record<string, unknown>) => { await init.ensure(); return t.call(args); },
  }));

  await runMcpServer({ stdin: opts.stdin, stdout: opts.stdout, tools: wrappedTools });
}

function countSkills(index: SkillIndex): number {
  // memex-core does not expose .size today; we use the public iterator over indexed entries.
  // If memex-core adds .size in a future release, switch to it.
  return index.all().length;
}

function countByType(index: SkillIndex): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of index.all()) {
    counts[s.type] = (counts[s.type] ?? 0) + 1;
  }
  return counts;
}
```

> If `SkillIndex.all()` is not exposed in the pinned memex-core version, replace `countSkills` and `countByType` with a no-op returning `{ size: 0, sourceCounts: {} }` and open an upstream issue. The aggregator still works; only `memex_status` numbers degrade.

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm test test/mcp-main.test.ts`
Expected: 1 test PASS (may take 5–15 seconds on first run while the embedding model downloads).

- [ ] **Step 5: Commit**

```bash
git add src/mcp/main.ts test/mcp-main.test.ts
git commit -m "feat(mcp): runMemexMcp wires config, index, telemetry, and tools end-to-end"
```

---

## Phase 6: Main entry

### Task 15: `src/main.ts` — argv dispatcher

**Files:**
- Modify: `src/main.ts`
- Create: `test/main.test.ts`

For Plan 1 the dispatcher knows three subcommands:
- `memex mcp` → `runMemexMcp`
- `memex doctor` → calls the stub in Task 21 (placeholder for now: prints "not yet implemented", exit 1)
- `memex --version` / `-v` → prints `MEMEX_GROK_VERSION`

Sync, index, and hook subcommands are stubbed to exit 1 with a clear message ("not yet implemented in Plan N"). Plan 2 adds `memex hook`; Plan 3 adds `memex sync`.

- [ ] **Step 1: Write the failing test**

`test/main.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

const ENTRY = ["tsx", "src/main.ts"];

function run(args: string[]): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execFileSync("npx", [...ENTRY, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { stdout, stderr: "", code: 0 };
  } catch (e: any) {
    return { stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? ""), code: e.status ?? 1 };
  }
}

describe("memex CLI", () => {
  it("prints version with --version", () => {
    const r = run(["--version"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("exits 1 with a clear message for unimplemented subcommands", () => {
    const r = run(["sync"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("not yet implemented");
  });

  it("exits 1 with usage when called with no args", () => {
    const r = run([]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("usage");
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `pnpm test test/main.test.ts`
Expected: FAIL — main is still the placeholder.

- [ ] **Step 3: Write the dispatcher**

`src/main.ts`:
```ts
#!/usr/bin/env node
const VERSION = process.env.MEMEX_GROK_VERSION ?? "0.0.0-dev";

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
    process.stdout.write(VERSION + "\n");
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
```

> The `doctor` import requires a stub `src/cli/doctor.ts` to keep typecheck green (TS can't see lazy `await import` paths without resolution). Task 15 ships a stub with `export async function runDoctor(args: string[]): Promise<number>` that writes "not yet implemented (Task 21)" to stderr and returns 1. Task 21 replaces the stub with the real implementation. The test for `doctor` lives in Task 21's test file; for Task 15 we only assert version/unimplemented/usage paths.

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test test/main.test.ts`
Expected: PASS on the version/unimplemented/usage cases. (The doctor subcommand isn't tested here.)

- [ ] **Step 5: Commit**

```bash
git add src/main.ts test/main.test.ts
git commit -m "feat(cli): main dispatcher with mcp, version, and deferred-subcommand stubs"
```

---

## Phase 7: Bin stub + install script

### Task 16: `bin/install.sh` — platform-aware binary downloader

**Files:**
- Create: `bin/install.sh`

The install logic mirrors memex-claude's `bin/install.sh` (already proven across platforms). The only change is the repo path.

- [ ] **Step 1: Copy memex-claude's `bin/install.sh` and adapt**

```bash
mkdir -p bin
```

`bin/install.sh`:
```bash
#!/bin/sh
# Downloads the prebuilt memex-grok binary for the current platform.
# Usage: ./bin/install.sh [version]
#   version defaults to "latest"
set -e

REPO="jim80net/memex-grok"
VERSION="${1:-latest}"
DIR="$(cd "$(dirname "$0")" && pwd)"
LOCK="$DIR/.installing.lock"
LOG="$DIR/.install.log"

detect_platform() {
  OS="$(uname -s)"
  ARCH="$(uname -m)"
  case "$OS" in
    Linux*)  PLATFORM_OS="linux" ;;
    Darwin*) PLATFORM_OS="darwin" ;;
    MINGW*|MSYS*|CYGWIN*) PLATFORM_OS="win32" ;;
    *) echo "Unsupported OS: $OS" >&2; exit 1 ;;
  esac
  case "$ARCH" in
    x86_64|amd64)   PLATFORM_ARCH="x64" ;;
    aarch64|arm64)  PLATFORM_ARCH="arm64" ;;
    *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
  esac
  printf '%s-%s' "$PLATFORM_OS" "$PLATFORM_ARCH"
}

PLATFORM="$(detect_platform)"
[ -z "${MEMEX_INSTALL_QUIET:-}" ] && echo "Detected platform: $PLATFORM" >&2

# Resolve version → release tag
if [ "$VERSION" = "latest" ]; then
  REAL_VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | \
    grep -m1 '"tag_name"' | sed -E 's/.*"v?([^"]+)".*/\1/')
  [ -z "$REAL_VERSION" ] && { echo "Failed to resolve latest version" >&2; exit 1; }
else
  REAL_VERSION="$VERSION"
fi
TAG="v$REAL_VERSION"

if [ "$PLATFORM_OS" = "win32" ]; then
  BIN_NAME="memex.exe"
  BIN_DEST="$DIR/memex.exe"
else
  BIN_NAME="memex"
  BIN_DEST="$DIR/memex.bin"
fi

# Acquire lockfile to serialize concurrent installs
{
  exec 9>"$LOCK"
  if command -v flock >/dev/null 2>&1; then
    flock 9 || { echo "Could not acquire install lock" >&2; exit 1; }
  fi

  # If another process completed the install while we waited, exit success.
  if [ -f "$BIN_DEST" ]; then
    [ -z "${MEMEX_INSTALL_QUIET:-}" ] && echo "Binary already present at $BIN_DEST" >&2
    exit 0
  fi

  URL="https://github.com/$REPO/releases/download/$TAG/memex-grok-$PLATFORM.tar.gz"
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT

  echo "Downloading $URL" >&2
  curl -fsSL "$URL" -o "$TMP/bundle.tar.gz" || { echo "Download failed" >&2; exit 1; }
  tar -xzf "$TMP/bundle.tar.gz" -C "$TMP" || { echo "Extract failed" >&2; exit 1; }
  [ -f "$TMP/$BIN_NAME" ] || { echo "Bundle missing $BIN_NAME" >&2; exit 1; }

  # Move binary and shared libs into bin/
  mv "$TMP/$BIN_NAME" "$BIN_DEST"
  chmod +x "$BIN_DEST"
  for lib in "$TMP"/*.so* "$TMP"/*.dylib "$TMP"/*.dll; do
    [ -f "$lib" ] && cp "$lib" "$DIR/"
  done

  echo "Installed memex $REAL_VERSION to $BIN_DEST" >&2
} >>"$LOG" 2>&1 || { tail -20 "$LOG" >&2; exit 1; }
```

```bash
chmod +x bin/install.sh
```

- [ ] **Step 2: Manual smoke (skipped — no release artifact exists yet)**

Plan 1 cannot fully exercise `install.sh` (there's no published release yet). Step 1 of Task 25 will validate end-to-end. Document this in a comment at the top of the file (already present in the design).

- [ ] **Step 3: Commit**

```bash
git add bin/install.sh
git commit -m "feat(bin): platform-detecting installer with lockfile serialization"
```

---

### Task 17: `bin/memex` — POSIX entrypoint stub

**Files:**
- Create: `bin/memex`

- [ ] **Step 1: Write the stub**

`bin/memex`:
```bash
#!/bin/sh
# memex entrypoint.
# 1. Exec the prebuilt binary if present.
# 2. Otherwise download it synchronously (fits within hooks' 15s timeout).
# 3. If install fails, emit empty MCP-friendly {} on stdout, clear error on stderr.
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"

# 1. Prebuilt binary — fast path
if [ -f "$DIR/memex.bin" ]; then
  case "$(uname -s)" in
    Darwin*) export DYLD_LIBRARY_PATH="$DIR${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}" ;;
    *)       export LD_LIBRARY_PATH="$DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" ;;
  esac
  exec "$DIR/memex.bin" "$@"
fi

# 2. Binary missing — synchronous download
if [ -x "$DIR/install.sh" ]; then
  "$DIR/install.sh" || true
  if [ -f "$DIR/memex.bin" ]; then
    exec "$0" "$@"
  fi
fi

# 3. Install failed
echo '{}'
{
  echo "memex: binary not found. Install manually:"
  echo "  cd $(cd "$DIR/.." && pwd) && ./bin/install.sh"
} >&2
exit 1
```

```bash
chmod +x bin/memex
```

- [ ] **Step 2: Smoke test against the locally-built binary**

```bash
# Use the binary built in Task 2, copied into bin/memex.bin
PLATFORM=$(node -e "console.log(process.platform + '-' + process.arch)")
cp dist/$PLATFORM/memex bin/memex.bin
# Copy shared libs alongside if present
for lib in dist/$PLATFORM/*.so* dist/$PLATFORM/*.dylib dist/$PLATFORM/*.dll; do
  [ -f "$lib" ] && cp "$lib" bin/
done

bin/memex --version
```

Expected: prints the version from `package.json` (e.g. `0.1.0-alpha.0`). Exit 0.

- [ ] **Step 3: Clean up the smoke test artifacts (these are gitignored)**

```bash
ls bin/memex.bin && rm bin/memex.bin
for lib in bin/*.so* bin/*.dylib bin/*.dll; do
  [ -f "$lib" ] && rm "$lib"
done
```

- [ ] **Step 4: Commit**

```bash
git add bin/memex
git commit -m "feat(bin): POSIX entrypoint stub with lazy install fallback"
```

---

### Task 18: `bin/memex.cmd` — Windows variant

**Files:**
- Create: `bin/memex.cmd`

- [ ] **Step 1: Write the Windows stub**

`bin/memex.cmd`:
```bat
@echo off
setlocal
set DIR=%~dp0
if exist "%DIR%memex.exe" (
  "%DIR%memex.exe" %*
  exit /b %ERRORLEVEL%
)
if exist "%DIR%install.sh" (
  bash "%DIR%install.sh" || rem ignore failure
  if exist "%DIR%memex.exe" (
    "%DIR%memex.exe" %*
    exit /b %ERRORLEVEL%
  )
)
echo {}
echo memex: binary not found. Install manually: 1>&2
echo   cd %DIR%.. ^&^& bash bin/install.sh 1>&2
exit /b 1
```

- [ ] **Step 2: Commit**

```bash
git add bin/memex.cmd
git commit -m "feat(bin): Windows entrypoint variant"
```

---

## Phase 8: Plugin manifests

### Task 19: `.claude-plugin/plugin.json` + `marketplace.json`

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Write `plugin.json`**

```bash
mkdir -p .claude-plugin
```

`.claude-plugin/plugin.json`:
```json
{
  "name": "memex-grok",
  "version": "0.1.0-alpha.0",
  "description": "Memex skill/memory/rule router for grok — semantic context via MCP and a shared cross-harness sync repo",
  "author": {
    "name": "Jim Park",
    "url": "https://github.com/jim80net"
  },
  "repository": "https://github.com/jim80net/memex-grok",
  "license": "MIT",
  "keywords": ["skills", "memory", "semantic-search", "embeddings", "mcp", "memex", "grok"]
}
```

> No `skills` field in Plan 1 — bundled skills land in Plan 4. No `hooks` directory yet — hook wiring is Plan 2.

- [ ] **Step 2: Write `marketplace.json`**

`.claude-plugin/marketplace.json`:
```json
{
  "name": "memex-grok",
  "owner": {
    "name": "Jim Park",
    "url": "https://github.com/jim80net"
  },
  "plugins": [
    {
      "name": "memex-grok",
      "source": "./",
      "description": "Memex skill/memory/rule router for grok — semantic context via MCP and a shared cross-harness sync repo",
      "version": "0.1.0-alpha.0"
    }
  ]
}
```

- [ ] **Step 3: Commit**

```bash
git add .claude-plugin/
git commit -m "feat(plugin): claude-plugin manifest and marketplace entry"
```

---

### Task 20: `.mcp.json` — MCP server registration

**Files:**
- Create: `.mcp.json`

- [ ] **Step 1: Write `.mcp.json`**

`.mcp.json`:
```json
{
  "mcpServers": {
    "memex": {
      "command": "${CLAUDE_PLUGIN_ROOT}/bin/memex",
      "args": ["mcp"]
    }
  }
}
```

> If P3 (Task 0.3) reported `GROK_PLUGIN_ROOT only`, run `sed -i 's|${CLAUDE_PLUGIN_ROOT}|${GROK_PLUGIN_ROOT}|g' .mcp.json` and document the substitution choice in P3's deliverable doc.

- [ ] **Step 2: Commit**

```bash
git add .mcp.json
git commit -m "feat(plugin): register memex MCP server via .mcp.json"
```

---

## Phase 9: Doctor command (Plan 1 subset)

### Task 21: `src/cli/doctor.ts` — skeleton + binary check + JSON output

**Files:**
- Create: `src/cli/doctor.ts`
- Create: `test/doctor.test.ts`

- [ ] **Step 1: Write the failing test**

`test/doctor.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { runDoctor } from "../src/cli/doctor.ts";

function captureStdout(fn: () => Promise<number>): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(async (resolve) => {
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    let stdout = "", stderr = "";
    process.stdout.write = ((c: any) => { stdout += String(c); return true; }) as any;
    process.stderr.write = ((c: any) => { stderr += String(c); return true; }) as any;
    try {
      const code = await fn();
      resolve({ code, stdout, stderr });
    } finally {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    }
  });
}

const allOkStubs = {
  binary: { status: "ok" as const, detail: "v0.1.0", version: "0.1.0" },
  mcp_registration: { status: "ok" as const, detail: "registered", registered: true },
  hook_registration: { status: "ok" as const, detail: "ok" },
  plugin_env_vars: { status: "ok" as const, detail: "ok" },
  sync_repo: { status: "ok" as const, detail: "ok" },
  memex_claude_coexistence: { status: "ok" as const, detail: "ok" },
};

describe("runDoctor", () => {
  it("emits OK lines and exits 0 in text mode when all checks pass (stubbed)", async () => {
    const { stdout, code } = await captureStdout(() => runDoctor([], { stubChecks: allOkStubs }));
    expect(code).toBe(0);
    expect(stdout).toContain("OK:");
    expect(stdout).not.toContain("FAIL:");
  });

  it("emits FAIL line and exits 1 when binary check fails", async () => {
    const { stdout, code } = await captureStdout(() => runDoctor([], { stubChecks: { ...allOkStubs, binary: { status: "fail", detail: "binary missing", version: null } } }));
    expect(code).toBe(1);
    expect(stdout).toContain("FAIL:");
  });

  it("emits stable JSON shape with --json", async () => {
    const { stdout, code } = await captureStdout(() => runDoctor(["--json"], { stubChecks: allOkStubs }));
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.schema_version).toBe(1);
    expect(parsed.exit_code).toBe(0);
    expect(parsed.overall_status).toBe("ok");
    expect(parsed.checks.binary.status).toBe("ok");
  });

  it("JSON mode preserves shape even when binary check fails", async () => {
    const { stdout, code } = await captureStdout(() => runDoctor(["--json"], { stubChecks: { ...allOkStubs, binary: { status: "fail", detail: "missing", version: null } } }));
    expect(code).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed.exit_code).toBe(1);
    expect(parsed.overall_status).toBe("fail");
    expect(parsed.checks.binary.status).toBe("fail");
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `pnpm test test/doctor.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```bash
mkdir -p src/cli
```

`src/cli/doctor.ts`:
```ts
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

type Status = "ok" | "warn" | "fail";
interface CheckResult { status: Status; detail: string; [k: string]: unknown; }
type ChecksMap = Record<string, CheckResult>;

interface DoctorOptions {
  /** Stub checks for unit tests. Real checks run when this is absent. */
  stubChecks?: Partial<ChecksMap>;
}

export async function runDoctor(args: string[], opts: DoctorOptions = {}): Promise<number> {
  const json = args.includes("--json");
  const checks: ChecksMap = {
    binary: opts.stubChecks?.binary ?? checkBinary(),
    mcp_registration: opts.stubChecks?.mcp_registration ?? { status: "warn", detail: "not yet checked (Plan 1 stub)" },
    hook_registration: opts.stubChecks?.hook_registration ?? { status: "warn", detail: "deferred to Plan 2" },
    plugin_env_vars: opts.stubChecks?.plugin_env_vars ?? { status: "warn", detail: "deferred to Plan 2" },
    sync_repo: opts.stubChecks?.sync_repo ?? { status: "warn", detail: "deferred to Plan 3" },
    memex_claude_coexistence: opts.stubChecks?.memex_claude_coexistence ?? { status: "warn", detail: "deferred to Plan 3" },
  };

  const overall = computeOverall(checks);
  const exit_code = overall === "fail" ? 1 : 0;

  if (json) {
    const report = { schema_version: 1, overall_status: overall, exit_code, checks };
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    for (const [name, c] of Object.entries(checks)) {
      const prefix = c.status === "ok" ? "OK:" : c.status === "warn" ? "WARN:" : "FAIL:";
      process.stdout.write(`${prefix} ${name}: ${c.detail}\n`);
    }
  }
  return exit_code;
}

function checkBinary(): CheckResult {
  // Look for ourselves alongside bin/memex
  const self = fileURLToPath(import.meta.url);
  const binDir = join(dirname(dirname(self)), "..", "bin");
  const candidates = ["memex.bin", "memex.exe"].map((n) => join(binDir, n));
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    return { status: "fail", detail: `binary missing under ${binDir} — run bin/install.sh`, version: null };
  }
  try {
    const v = execFileSync(found, ["--version"], { encoding: "utf8" }).trim();
    return { status: "ok", detail: `present at ${found}, --version reports ${v}`, version: v };
  } catch (e) {
    return { status: "fail", detail: `binary present but --version failed: ${(e as Error).message}`, version: null };
  }
}

function computeOverall(checks: ChecksMap): Status {
  let worst: Status = "ok";
  for (const c of Object.values(checks)) {
    if (c.status === "fail") return "fail";
    if (c.status === "warn") worst = "warn";
  }
  return worst;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test test/doctor.test.ts && pnpm typecheck`
Expected: 4 tests PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/cli/doctor.ts test/doctor.test.ts
git commit -m "feat(cli): doctor command with text + --json output and binary check"
```

---

### Task 22: Wire `mcp_registration` check via `grok inspect --json`

**Files:**
- Modify: `src/cli/doctor.ts`
- Modify: `test/doctor.test.ts`

- [ ] **Step 1: Add the test cases**

Append to `test/doctor.test.ts`:
```ts
import { execFileSync } from "node:child_process";
import { vi } from "vitest";

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return { ...actual, execFileSync: vi.fn() };
});

describe("runDoctor — MCP registration check", () => {
  // Build stubs that pass through ONLY mcp_registration to the real check.
  const stubsExceptMcp = {
    binary: { status: "ok" as const, detail: "x", version: "0.1.0" },
    hook_registration: { status: "ok" as const, detail: "ok" },
    plugin_env_vars: { status: "ok" as const, detail: "ok" },
    sync_repo: { status: "ok" as const, detail: "ok" },
    memex_claude_coexistence: { status: "ok" as const, detail: "ok" },
  };

  it("reports OK when grok inspect lists memex", async () => {
    (execFileSync as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      JSON.stringify({ mcpServers: [{ name: "memex", source: "plugin: memex-grok" }] })
    );
    const { runDoctor } = await import("../src/cli/doctor.ts");
    const { stdout, code } = await captureStdout(() => runDoctor(["--json"], { stubChecks: stubsExceptMcp }));
    const parsed = JSON.parse(stdout);
    expect(parsed.checks.mcp_registration.status).toBe("ok");
    expect(parsed.checks.mcp_registration.registered).toBe(true);
    expect(code).toBe(0);
  });

  it("reports FAIL when grok inspect is missing memex", async () => {
    (execFileSync as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      JSON.stringify({ mcpServers: [] })
    );
    const { runDoctor } = await import("../src/cli/doctor.ts");
    const { stdout, code } = await captureStdout(() => runDoctor(["--json"], { stubChecks: stubsExceptMcp }));
    const parsed = JSON.parse(stdout);
    expect(parsed.checks.mcp_registration.status).toBe("fail");
    expect(parsed.checks.mcp_registration.registered).toBe(false);
    expect(code).toBe(1);
  });

  it("reports WARN when grok CLI is not on PATH", async () => {
    (execFileSync as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => { throw new Error("ENOENT: grok"); });
    const { runDoctor } = await import("../src/cli/doctor.ts");
    const { stdout, code } = await captureStdout(() => runDoctor(["--json"], { stubChecks: stubsExceptMcp }));
    const parsed = JSON.parse(stdout);
    expect(parsed.checks.mcp_registration.status).toBe("warn");
    expect(parsed.checks.mcp_registration.detail).toMatch(/grok/);
    expect(code).toBe(0);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `pnpm test test/doctor.test.ts`
Expected: FAIL on the three new cases (status comes back as `warn: "not yet checked (Plan 1 stub)"`).

- [ ] **Step 3: Implement the real check**

Replace the `mcp_registration` default in `runDoctor` and add `checkMcpRegistration`:

```ts
// in runDoctor, replace:
//   mcp_registration: opts.stubChecks?.mcp_registration ?? { status: "warn", detail: "not yet checked (Plan 1 stub)" },
// with:
    mcp_registration: opts.stubChecks?.mcp_registration ?? checkMcpRegistration(),
```

Add at the bottom of `src/cli/doctor.ts`:
```ts
function checkMcpRegistration(): CheckResult {
  try {
    const out = execFileSync("grok", ["inspect", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const parsed = JSON.parse(out);
    const servers = Array.isArray(parsed.mcpServers) ? parsed.mcpServers : [];
    const registered = servers.some((s: unknown) => typeof s === "object" && s != null && (s as { name?: string }).name === "memex");
    return registered
      ? { status: "ok", detail: "memex MCP server is registered with grok", registered: true }
      : { status: "fail", detail: "memex MCP server NOT registered — install the plugin via `grok plugin install jim80net/memex-grok --trust`", registered: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: "warn", detail: `unable to query grok inspect (${msg}) — install grok CLI to verify MCP registration`, registered: false };
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm test test/doctor.test.ts`
Expected: all PASS (7 total now).

- [ ] **Step 5: Commit**

```bash
git add src/cli/doctor.ts test/doctor.test.ts
git commit -m "feat(doctor): MCP registration check via grok inspect --json"
```

---

## Phase 10: End-to-end validation + release prep

### Task 23: Manual E2E — local install and live MCP search

**Files:**
- Create: `docs/superpowers/prereqs/E2E-plan1.md`

- [ ] **Step 1: Build for current platform**

```bash
pnpm build
PLATFORM=$(node -e "console.log(process.platform + '-' + process.arch)")
cp dist/$PLATFORM/memex bin/memex.bin
for lib in dist/$PLATFORM/*.so* dist/$PLATFORM/*.dylib dist/$PLATFORM/*.dll; do
  [ -f "$lib" ] && cp "$lib" bin/
done
bin/memex --version
```

Expected: prints `0.1.0-alpha.0`.

- [ ] **Step 2: Stage a fixture skill**

```bash
mkdir -p ~/.grok/skills/memex-grok-test
cat > ~/.grok/skills/memex-grok-test/SKILL.md <<'SKILL'
---
name: memex-grok-test
description: A fixture skill to verify memex_search works end-to-end. Use when asked about MEMEX_GROK_E2E_MARKER.
queries:
  - MEMEX_GROK_E2E_MARKER
  - test fixture for memex
---

# MEMEX_GROK_E2E_MARKER

This skill exists solely to confirm memex-grok's MCP server is wired correctly. If a model can find and read this skill via `memex_search`, the foundation works.
SKILL
```

- [ ] **Step 3: Install the local plugin**

```bash
grok plugin install . --trust
grok inspect --json | python3 -c "import sys,json;d=json.load(sys.stdin);print('memex MCP registered:', any(s.get('name')=='memex' for s in d.get('mcpServers',[])))"
```

Expected: `memex MCP registered: True`.

- [ ] **Step 4: Drive an interactive session**

In an interactive grok TTY session, ask:

```
Use the memex_search tool to look up MEMEX_GROK_E2E_MARKER. Then use memex_read_skill on the returned location and tell me what the skill says.
```

Expected: the model invokes `memex_search`, sees the fixture skill, calls `memex_read_skill`, and quotes back `MEMEX_GROK_E2E_MARKER`.

- [ ] **Step 5: Run `memex doctor` against the live install**

```bash
bin/memex doctor
bin/memex doctor --json | python3 -m json.tool
```

Expected:
- `OK: binary: present at ...`
- `OK: mcp_registration: memex MCP server is registered with grok`
- `WARN:` for the four deferred-to-later-plans checks

- [ ] **Step 6: Write the deliverable**

`docs/superpowers/prereqs/E2E-plan1.md`:
```markdown
# E2E — Plan 1 foundation

**Date:** YYYY-MM-DD

## Evidence

### `bin/memex --version`
<paste>

### `grok inspect --json` (mcpServers excerpt)
<paste>

### Interactive session transcript

> User: Use the memex_search tool to look up MEMEX_GROK_E2E_MARKER...
> Model: <paste>

### `bin/memex doctor --json`
<paste>

## Result

RESULT: PASS — memex-grok foundation is functional. Ready for Plan 2 (hook runtime).
```

- [ ] **Step 7: Cleanup local install + fixture**

```bash
grok plugin uninstall memex-grok --confirm
rm -f ~/.grok/skills/memex-grok-test/SKILL.md
rmdir ~/.grok/skills/memex-grok-test 2>/dev/null || true
# Clean up bin/ — gitignored binaries
rm -f bin/memex.bin bin/memex.exe
for lib in bin/*.so* bin/*.dylib bin/*.dll; do [ -f "$lib" ] && rm "$lib"; done
```

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/prereqs/E2E-plan1.md
git commit -m "docs(prereqs): record E2E validation for Plan 1 foundation"
```

---

### Task 24: README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write README**

`README.md`:
```markdown
# memex-grok

Semantic skill / memory / rule router for [grok](https://github.com/xai-org/grok). Surfaces the user's cross-harness memex corpus to the grok model via a stdio MCP server.

Built on [@jim80net/memex-core](https://github.com/jim80net/memex-core) — the shared engine for embedding, indexing, and searching knowledge artifacts. Cross-harness sibling: [memex-claude](https://github.com/jim80net/memex-claude).

## Status

Alpha. Plan 1 (MCP server + foundation) is implemented. Hook runtime (Plan 2), cross-harness sync (Plan 3), and bundled skills (Plan 4) are in progress. See `openspec/changes/add-memex-grok-plugin/` and `docs/superpowers/plans/` for the implementation roadmap.

## Installation

```
grok plugin install jim80net/memex-grok --trust
```

The platform binary downloads automatically on first invocation.

## What this gives you (Plan 1)

After install, grok's model has access to three new tools:

- `memex_search(query, top_k?, threshold?, types?)` — semantic search over your skills, rules, and memories
- `memex_read_skill(location, query_id?)` — fetch full content; the optional `query_id` (from `memex_search`) records telemetry to improve future ranking
- `memex_status()` — index size, source counts, sync state, embedding model

The model surfaces these tools as needed when answering questions whose answers may be encoded in your durable knowledge corpus.

## What's deferred

- **Hooks (Plan 2)**: SessionStart cache warm-up; dormant UserPromptSubmit/Stop/PreCompact hooks that activate when grok ships hook-driven context injection.
- **Cross-harness sync (Plan 3)**: writing to the shared `~/.local/share/memex/` repo, the migration command, doctor coexistence checks. Blocked on memex-core's `canonicalProjectId()` release.
- **Bundled skills (Plan 4)**: sleep, deep-sleep, reflect, handoff, takeover. Blocked on Plan 3.

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

See `CONTRIBUTING.md` and `docs/superpowers/specs/2026-05-25-memex-grok-design.md` for architecture details.

## License

MIT. See `LICENSE`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README covering Plan 1 scope and Plan 2-4 roadmap"
```

---

### Task 25: Final verification + push

**Files:** (no new files)

- [ ] **Step 1: Run the full test suite + typecheck + build**

```bash
pnpm test
pnpm typecheck
pnpm build
```

Expected: all green.

- [ ] **Step 2: Verify the openspec change still validates**

```bash
openspec validate add-memex-grok-plugin
```

Expected: `Change 'add-memex-grok-plugin' is valid`.

- [ ] **Step 3: Push**

```bash
git push origin main
```

Expected: push succeeds.

- [ ] **Step 4: Update the openspec change tasks.md**

Mark Phase 1 tasks complete in `openspec/changes/add-memex-grok-plugin/tasks.md`:

- Check off §0.1–§0.3 (P1, P2, P3 deliverables exist under `docs/superpowers/prereqs/`)
- Check off §1.1, §1.3, §2.1, §2.2 (repo bootstrap, paths, config)
- Check off §4.1, §4.2, §4.3 (MCP server, tools, first-call init)
- Check off §5.1, §5.2 (bin stub variants)
- Check off §5.3 (build.ts platform binaries)
- Check off §6.1 (.mcp.json)
- Check off §7.1 partially (doctor; binary + MCP checks done, others deferred)
- Check off §9.1 (E2E install + memex_search)

Leave open: §2.3 (memory-mapping — Plan 3), §3.x (hooks — Plan 2), §6.2 (hooks.json — Plan 2), §7.2 (--migrate-repo — Plan 3), §7.3 (--install-hooks — Plan 2), §7.4 (sync — Plan 3), §7.5 (index — Plan 3), §8 (skills — Plan 4), §9.2–§9.4 (cross-harness + coexistence — Plan 3), §10 (release — final plan).

- [ ] **Step 5: Commit tasks.md update + push**

```bash
git add openspec/changes/add-memex-grok-plugin/tasks.md
git commit -m "openspec(add-memex-grok-plugin): mark Plan 1 tasks complete"
git push origin main
```

- [ ] **Step 6: Tag a pre-release**

```bash
git tag v0.1.0-alpha.0
git push origin v0.1.0-alpha.0
```

This is a pre-release tag — it signals the foundation is buildable but the plugin is not yet feature-complete. GitHub release artifacts are produced by Plan 4's release workflow.

---

## End of Plan 1

**What works after this plan:**
- `grok plugin install jim80net/memex-grok --trust` installs the plugin (after a real release artifact ships)
- For local-checkout testing: `grok plugin install ./ --trust` works given the bin stub
- The model can invoke `memex_search`, `memex_read_skill`, `memex_status` against the user's `~/.grok/skills/` and `~/.claude/skills/`
- `memex doctor` (text and `--json`) reports binary and MCP registration health
- Test suite, typecheck, and build are all wired into pnpm scripts

**What does NOT work yet (handled by later plans):**
- Plan 2: hook firing (SessionStart cache warm-up, dormant UserPromptSubmit/Stop/PreCompact)
- Plan 3: sync repo reads/writes against `~/.local/share/memex/`, `--migrate-repo`, coexistence checks
- Plan 4: bundled skills (sleep, deep-sleep, reflect, handoff, takeover, help)

**Handoff to Plan 2** lives in `docs/superpowers/plans/2026-??-??-memex-grok-hooks.md` (write after P2 prerequisite passes with a known result).
