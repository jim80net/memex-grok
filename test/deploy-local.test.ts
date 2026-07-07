import { afterEach, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "bin/deploy-local.sh");
const SLEEP_BIN = "/bin/sleep";
const TRUE_BIN = "/bin/true";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("deploy-local.sh", () => {
  it.skipIf(process.platform === "win32")(
    "redeploys over a running deployed ELF binary (rm-then-copy)",
    () => {
      const installDir = join(
        tmpdir(),
        `memex-deploy-local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      );
      const srcDir = join(
        tmpdir(),
        `memex-deploy-src-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      );
      mkdirSync(installDir, { recursive: true });
      mkdirSync(srcDir, { recursive: true });
      cleanups.push(() => rmSync(installDir, { recursive: true, force: true }));
      cleanups.push(() => rmSync(srcDir, { recursive: true, force: true }));

      const runningBin = join(installDir, "memex-grok");
      copyFileSync(SLEEP_BIN, runningBin);
      chmodSync(runningBin, 0o755);

      const runner = spawn(runningBin, ["3600"], {
        detached: true,
        stdio: "ignore",
      });
      runner.unref();
      cleanups.push(() => {
        try {
          process.kill(-runner.pid!, "SIGTERM");
        } catch {
          try {
            process.kill(runner.pid!, "SIGTERM");
          } catch {
            // already exited
          }
        }
      });

      const binSrc = join(srcDir, "memex");
      copyFileSync(TRUE_BIN, binSrc);
      chmodSync(binSrc, 0o755);
      writeFileSync(join(srcDir, ".stamp"), "0.1.0-alpha.0+deploy17\n");
      writeFileSync(join(srcDir, "libonnxruntime.so.1"), "fake-onnx-v2\n");
      writeFileSync(join(installDir, "libonnxruntime.so.1"), "fake-onnx-v1\n");

      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);

      const result = spawnSync(SCRIPT, [installDir], {
        encoding: "utf8",
        env: { ...process.env, MEMEX_DEPLOY_SRC: srcDir },
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toContain("Deployed");

      expect(readFileSync(runningBin)).toEqual(readFileSync(binSrc));
      expect(readFileSync(join(installDir, "libonnxruntime.so.1"), "utf8")).toBe(
        "fake-onnx-v2\n",
      );
      expect(readFileSync(join(installDir, ".stamp"), "utf8")).toBe(
        "0.1.0-alpha.0+deploy17\n",
      );
    },
  );
});
