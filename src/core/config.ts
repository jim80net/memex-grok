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

/**
 * Extension of SyncConfig that adds a local `repoDir` override for
 * grok-specific origin/sync configuration (maps to core OriginConfig.root /
 * resolveOriginRoot explicit root — product default is ~/.memex).
 */
export type GrokSyncConfig = SyncConfig & {
  /**
   * Explicit origin root override (absolute or ~/…).
   * When unset, core `resolveOriginRoot` walks ~/.memex → XDG → legacy-claude.
   */
  repoDir?: string;
};

export type GrokRouterConfig = MemexCoreConfig & {
  skillDirs: string[];
  sync: GrokSyncConfig;
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
