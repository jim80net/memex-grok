import { defaultOriginRoot } from "@jim80net/memex-core";
import { homedir } from "node:os";
import { join } from "node:path";

export interface GrokPaths {
  cacheDir: string;
  modelsDir: string;
  sessionsDir: string;
  /**
   * Product-default origin path (`~/.memex` via core `defaultOriginRoot`).
   * Runtime resolution uses `resolveOriginRoot` (see `src/core/projection.ts`)
   * — do not treat this alone as the live origin when XDG/legacy paths exist.
   */
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
    // Product default from core; live origin via resolveOriginRoot at runtime.
    syncRepoDir: defaultOriginRoot(home),
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
