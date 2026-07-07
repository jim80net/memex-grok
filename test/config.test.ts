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
