import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { arch, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const DIST_ENTRYPOINT = join(ROOT, "dist", `${platform()}-${arch()}`, "memex");
const DEPLOY = join(ROOT, "bin", "deploy-local.sh");
const SKILL_DIR = join(ROOT, "test", "fixtures", "skills");
const built = existsSync(DIST_ENTRYPOINT);
const tempHomes: string[] = [];

afterEach(() => {
  for (const home of tempHomes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

describe.skipIf(!built)("deployed selfcheck (run `pnpm build` first)", () => {
  it("verifies the deployed binary and live MCP loop without caller loader configuration", () => {
    const home = mkdtempSync(join(tmpdir(), "memex-grok-selfcheck-"));
    tempHomes.push(home);
    const installDir = join(home, ".cache", "memex-grok");
    const configPath = join(home, ".grok", "memex.json");
    mkdirSync(join(home, ".grok", "cache", "models"), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ skillDirs: [SKILL_DIR] }), "utf8");

    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, MEMEX_CONFIG: configPath };
    delete env.LD_LIBRARY_PATH;
    const deploy = spawnSync(DEPLOY, [installDir], {
      cwd: ROOT,
      encoding: "utf8",
      env,
    });
    expect(deploy.status, deploy.stderr).toBe(0);

    const selfcheck = spawnSync(join(installDir, "memex-grok"), ["selfcheck", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      env,
      timeout: 180_000,
    });
    expect(selfcheck.error).toBeUndefined();
    expect(selfcheck.status, `${selfcheck.stderr}\n${selfcheck.stdout}`).toBe(0);
    const report = JSON.parse(selfcheck.stdout) as {
      ok?: boolean;
      steps?: Array<{ name?: string; ok?: boolean; details?: Record<string, unknown> }>;
    };
    expect(report.ok).toBe(true);
    expect(report.steps?.map((step) => [step.name, step.ok])).toEqual([
      ["doctor", true],
      ["search", true],
      ["read_skill", true],
      ["security", true],
      ["path-egress", true],
    ]);
    expect(report.steps?.find((step) => step.name === "search")?.details).toMatchObject({
      threshold: 0,
      hits: 1,
    });
    expect(report.steps?.find((step) => step.name === "read_skill")?.details?.content_length).toBeGreaterThan(100);
    expect(selfcheck.stdout).not.toContain("/home/");
  }, 190_000);
});
