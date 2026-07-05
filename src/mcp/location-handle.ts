import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import type { GrokRouterConfig } from "../core/config.ts";
import { getGrokPaths, type GrokPaths } from "../core/paths.ts";
import { buildScanDirs } from "../core/index-init.ts";

/** A scan root with a stable, host-free label for portable MCP handles. */
export interface ScanRoot {
  key: string;
  rootPath: string;
}

const HANDLE_PREFIX = "memex://";

/**
 * Registers labeled scan roots (mirroring `buildScanDirs`) and translates
 * between absolute on-disk locations and portable MCP handles.
 *
 * Egress: search results expose handles, never raw absolute paths.
 * Ingress: read_skill resolves handles (or skill name) back to absolute paths.
 */
export class LocationHandleCodec {
  private readonly roots: ScanRoot[];

  constructor(roots: ScanRoot[]) {
    // Longest root first so nested/custom dirs resolve to the most specific root.
    this.roots = [...roots].sort((a, b) => b.rootPath.length - a.rootPath.length);
  }

  static forSession(cwd: string, config: GrokRouterConfig, paths = getGrokPaths()): LocationHandleCodec {
    return new LocationHandleCodec(buildScanRoots(cwd, config, paths));
  }

  /** Absolute path (+ optional `#fragment`) → portable handle for MCP egress. */
  toHandle(absolute: string): string {
    const { filePath, fragment } = splitLocation(absolute);
    const root = this.matchRoot(filePath);
    if (!root) {
      throw new Error(`location is outside registered scan roots: ${absolute}`);
    }
    const rel = normalizeRel(relative(root.rootPath, filePath));
    const handle = `${HANDLE_PREFIX}${root.key}/${rel}`;
    return fragment ? `${handle}#${fragment}` : handle;
  }

  /** Portable handle, legacy absolute path, or bare relative → absolute for index I/O. */
  resolveInput(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return trimmed;
    if (trimmed.startsWith(HANDLE_PREFIX)) {
      return this.resolveHandle(trimmed);
    }
    if (isAbsolutePath(trimmed)) {
      return trimmed;
    }
    throw new Error(`unrecognized location handle: ${input}`);
  }

  private resolveHandle(handle: string): string {
    const body = handle.slice(HANDLE_PREFIX.length);
    const { filePath, fragment } = splitLocation(body);
    const slash = filePath.indexOf("/");
    if (slash === -1) {
      throw new Error(`invalid location handle (missing path segment): ${handle}`);
    }
    const key = filePath.slice(0, slash);
    const rel = filePath.slice(slash + 1);
    const root = this.roots.find((r) => r.key === key);
    if (!root) {
      throw new Error(`unknown location handle root '${key}'`);
    }
    const absolute = resolve(root.rootPath, rel);
    return fragment ? `${absolute}#${fragment}` : absolute;
  }

  private matchRoot(filePath: string): ScanRoot | undefined {
    const normalized = resolve(filePath);
    return this.roots.find((r) => normalized === r.rootPath || normalized.startsWith(r.rootPath + sep));
  }
}

/** Build labeled scan roots aligned with `buildScanDirs` (adapter-local, no core change). */
export function buildScanRoots(cwd: string, config: GrokRouterConfig, paths: GrokPaths): ScanRoot[] {
  const home = homedir();
  const resolvedCwd = resolve(cwd);
  const scanDirs = buildScanDirs(cwd, config);
  const roots: ScanRoot[] = [];
  const seen = new Set<string>();

  const add = (key: string, dir: string) => {
    const rootPath = resolve(dir);
    if (seen.has(rootPath)) return;
    seen.add(rootPath);
    roots.push({ key, rootPath });
  };

  const [grokGlobalSkills, claudeGlobalSkills] = paths.globalSkillsDirs;
  const [grokGlobalRules] = paths.globalRulesDirs;

  for (const dir of scanDirs.skillDirs) {
    const resolved = resolve(dir);
    if (resolved === resolve(grokGlobalSkills)) add("grok-global", dir);
    else if (resolved === resolve(claudeGlobalSkills)) add("claude-global", dir);
    else if (resolved === join(resolvedCwd, ".grok", "skills")) add("grok-project", dir);
    else if (resolved === join(resolvedCwd, ".claude", "skills")) add("claude-project", dir);
    else if (config.sync.enabled && resolved === resolve(config.sync.repoDir ?? paths.syncRepoDir, "skills")) {
      add("sync-skills", dir);
    } else {
      const idx = config.skillDirs.map((d) => resolve(d)).indexOf(resolved);
      add(idx >= 0 ? `skill-extra-${idx}` : `skill-extra-${roots.length}`, dir);
    }
  }

  for (const dir of scanDirs.ruleDirs) {
    const resolved = resolve(dir);
    if (resolved === resolve(grokGlobalRules)) add("grok-rules-global", dir);
    else if (resolved === join(resolvedCwd, ".grok", "rules")) add("grok-rules-project", dir);
    else if (config.sync.enabled && resolved === resolve(config.sync.repoDir ?? paths.syncRepoDir, "rules")) {
      add("sync-rules", dir);
    } else {
      add(`rules-extra-${roots.length}`, dir);
    }
  }

  for (const dir of scanDirs.memoryDirs) {
    add(`memory-${roots.length}`, dir);
  }

  return roots;
}

function splitLocation(location: string): { filePath: string; fragment?: string } {
  const hash = location.indexOf("#");
  if (hash === -1) return { filePath: location };
  return { filePath: location.slice(0, hash), fragment: location.slice(hash + 1) };
}

function normalizeRel(rel: string): string {
  return rel.split(sep).join("/");
}

function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);
}

/** Test/helper: assert MCP JSON text has no host-specific path leaks. */
export function assertNoHostPathLeaks(text: string, home = homedir()): void {
  if (text.includes("/home/")) {
    throw new Error("MCP output leaks /home/ path");
  }
  if (home && text.includes(home)) {
    throw new Error("MCP output leaks user home path");
  }
}