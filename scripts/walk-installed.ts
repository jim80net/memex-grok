#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./installed-walk/config.ts";

const args = process.argv.slice(2).filter((argument) => argument !== "--");
const config = loadConfig(args);
const root = resolve(import.meta.dirname, "..");
const common = ["--nonce", config.nonce, "--out", config.out, "--registered-cwd", config.registeredCwd, "--older-source", config.olderSource];
const tsx = (script: string) => execFileSync("pnpm", ["exec", "tsx", resolve(root, script), ...common], { cwd: root, stdio: "inherit", env: process.env });

tsx("scripts/installed-walk/capture.ts");
const python = process.env.MEMEX_PLAYWRIGHT_PYTHON ?? "/tmp/pw-venv/bin/python";
if (!existsSync(python)) throw new Error(`Playwright Python not found at ${python}; set MEMEX_PLAYWRIGHT_PYTHON to the cached-Chromium environment`);
execFileSync(python, [resolve(root, "scripts/installed-walk/render.py"), "--nonce", config.nonce, "--out", config.out], { cwd: root, stdio: "inherit", env: process.env });
tsx("scripts/installed-walk/validate.ts");
tsx("scripts/installed-walk/finalize.ts");
