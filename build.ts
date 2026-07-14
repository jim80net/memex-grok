#!/usr/bin/env bun
/**
 * Build script for memex-grok standalone binaries.
 *
 * Compiles src/main.ts into an executable via `bun build --compile`. Linux builds
 * add a self-locating launcher so the untouched Bun payload can load the adjacent
 * ONNX runtime library without caller-provided loader configuration.
 *
 * Embeddings: `src/core/compiled-embedding.ts` statically imports
 * `@huggingface/transformers` so bun traces it into the executable. memex-core's
 * dynamic import() alone fails at runtime (/$bunfs virtual import.meta.url).
 *
 * Usage:
 *   bun run build.ts                         # current platform
 *   bun run build.ts --target bun-linux-x64  # cross-compile
 */
import { chmodSync, mkdirSync, cpSync, rmSync, symlinkSync, readlinkSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { platform, arch } from "node:os";
import { formatBuildStamp } from "./src/core/build-stamp.ts";

function gitShortSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

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
  const buildStamp = formatBuildStamp(pkgVersion, gitShortSha());
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, platConfig.binaryName);
  const compiledFile = platformKey.startsWith("linux-") ? `${outFile}.bin` : outFile;
  const defines = [
    `process.env.MEMEX_GROK_VERSION='"${pkgVersion}"'`,
    `process.env.MEMEX_GROK_BUILD_STAMP='"${buildStamp}"'`,
  ];
  const args = ["build", "--compile", "src/main.ts", "--outfile", compiledFile, ...defines.flatMap((d) => ["--define", d])];
  if (targetFlag) args.push("--target", targetFlag);
  execSync(`bun ${args.join(" ")}`, { stdio: "inherit" });
  if (platformKey.startsWith("linux-")) {
    writeFileSync(
      outFile,
      `#!/bin/sh\nset -e\ncase "$0" in\n  */*) SELF="$0" ;;\n  *) SELF="$(command -v "$0")" ;;\nesac\nDIR="$(CDPATH= cd -- "$(dirname -- "$SELF")" && pwd)"\nNAME="$(basename -- "$SELF")"\nexport LD_LIBRARY_PATH="$DIR\${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"\nexec "$DIR/$NAME.bin" "$@"\n`,
      "utf8",
    );
    chmodSync(outFile, 0o755);
    console.log("  Runtime library launcher: self-locating");
  }
  writeFileSync(join(outDir, ".stamp"), `${buildStamp}\n`, "utf8");
  console.log(`  Build stamp: ${buildStamp}`);

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
