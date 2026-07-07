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
