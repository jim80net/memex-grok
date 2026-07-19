// Cross-adapter version-pin alignment guard — Tier 2 (memex-core#32 freeze wave).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CROSS_ADAPTER_TRANSFORMERS_RANGE = "^3.8.1";
const CROSS_ADAPTER_TRANSFORMERS_RESOLVED = "3.8.1";
// Freeze: memex-core@0.6.0 shared-origin primitives (PR #35 / flotilla freeze-SHA).
const CROSS_ADAPTER_MEMEX_CORE_RANGE = "^0.6.0";
const CROSS_ADAPTER_MEMEX_CORE_RESOLVED = "0.6.1";

function readJson(relFromRepoRoot: string): Record<string, unknown> {
  const url = new URL(`../${relFromRepoRoot}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf-8")) as Record<string, unknown>;
}

function depRange(pkg: Record<string, unknown>, name: string): string | undefined {
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    const block = pkg[field];
    if (block && typeof block === "object") {
      const v = (block as Record<string, string>)[name];
      if (typeof v === "string") return v;
    }
  }
  return undefined;
}

describe("cross-adapter version-pin alignment (#4 / Tier 2)", () => {
  const grokPkg = readJson("package.json");

  describe("declared ranges match the cross-adapter reference (documentary)", () => {
    it("@huggingface/transformers range", () => {
      expect(depRange(grokPkg, "@huggingface/transformers")).toBe(
        CROSS_ADAPTER_TRANSFORMERS_RANGE,
      );
    });
    it("@jim80net/memex-core range", () => {
      expect(depRange(grokPkg, "@jim80net/memex-core")).toBe(CROSS_ADAPTER_MEMEX_CORE_RANGE);
    });
  });

  describe("resolved/installed versions match (load-bearing)", () => {
    it("the INSTALLED @huggingface/transformers version equals the reference", () => {
      const installed = readJson("node_modules/@huggingface/transformers/package.json");
      expect(installed.version).toBe(CROSS_ADAPTER_TRANSFORMERS_RESOLVED);
    });

    it("the INSTALLED @jim80net/memex-core version equals the reference", () => {
      const installed = readJson("node_modules/@jim80net/memex-core/package.json");
      expect(installed.version).toBe(CROSS_ADAPTER_MEMEX_CORE_RESOLVED);
    });

    it("memex-grok's transformers range equals the INSTALLED memex-core's range", () => {
      const corePkg = readJson("node_modules/@jim80net/memex-core/package.json");
      const coreRange = depRange(corePkg, "@huggingface/transformers");
      expect(coreRange, "@huggingface/transformers missing from memex-core pkg").toBeDefined();
      expect(depRange(grokPkg, "@huggingface/transformers")).toBe(coreRange);
    });
  });
});
