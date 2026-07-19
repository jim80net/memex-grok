import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { withFileLock } from "@jim80net/memex-core";

export type SyncAttemptResult = "succeeded" | "failed";

export interface PersistedSyncState {
  version: 1;
  last_attempt_at: string;
  last_attempt_result: SyncAttemptResult;
  last_success_at: string | null;
}

export type SyncStateKind =
  | "disabled"
  | "never_synced"
  | "synced"
  | "failed"
  | "unknown";

export interface MeasuredSyncStatus {
  state: SyncStateKind;
  lastSyncAt: string | null;
  lastAttemptAt: string | null;
  summary: string;
}

export function syncStatePath(cacheDir: string): string {
  return join(cacheDir, "memex-sync-state.json");
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parsePersistedSyncState(value: unknown): PersistedSyncState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Partial<PersistedSyncState>;
  if (candidate.version !== 1) return null;
  if (!isTimestamp(candidate.last_attempt_at)) return null;
  if (candidate.last_attempt_result !== "succeeded" && candidate.last_attempt_result !== "failed") {
    return null;
  }
  if (candidate.last_success_at !== null && !isTimestamp(candidate.last_success_at)) return null;
  if (candidate.last_attempt_result === "succeeded" && candidate.last_success_at === null) return null;
  return candidate as PersistedSyncState;
}

function disabledSummary(lastSyncAt: string | null): string {
  return lastSyncAt
    ? `Sync is disabled; the last successful sync was at ${lastSyncAt}.`
    : "Sync is disabled; no successful sync is recorded.";
}

export async function loadSyncStatus(
  path: string,
  syncEnabled: boolean,
): Promise<MeasuredSyncStatus> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return syncEnabled
        ? {
            state: "never_synced",
            lastSyncAt: null,
            lastAttemptAt: null,
            summary: "Sync is enabled but has not run yet.",
          }
        : {
            state: "disabled",
            lastSyncAt: null,
            lastAttemptAt: null,
            summary: disabledSummary(null),
          };
    }
    return {
      state: syncEnabled ? "unknown" : "disabled",
      lastSyncAt: null,
      lastAttemptAt: null,
      summary: syncEnabled
        ? "Sync history is unavailable; run memex sync to measure it."
        : disabledSummary(null),
    };
  }

  let persisted: PersistedSyncState | null = null;
  try {
    persisted = parsePersistedSyncState(JSON.parse(raw));
  } catch {
    // Invalid state is reported honestly below rather than treated as never run.
  }
  if (!persisted) {
    return {
      state: syncEnabled ? "unknown" : "disabled",
      lastSyncAt: null,
      lastAttemptAt: null,
      summary: syncEnabled
        ? "Sync history is unavailable; run memex sync to measure it."
        : disabledSummary(null),
    };
  }

  if (!syncEnabled) {
    return {
      state: "disabled",
      lastSyncAt: persisted.last_success_at,
      lastAttemptAt: persisted.last_attempt_at,
      summary: disabledSummary(persisted.last_success_at),
    };
  }
  if (persisted.last_attempt_result === "failed") {
    const lastSuccess = persisted.last_success_at
      ? ` The last successful sync was at ${persisted.last_success_at}.`
      : " No successful sync is recorded.";
    return {
      state: "failed",
      lastSyncAt: persisted.last_success_at,
      lastAttemptAt: persisted.last_attempt_at,
      summary: `The last sync attempt failed at ${persisted.last_attempt_at}.${lastSuccess}`,
    };
  }
  return {
    state: "synced",
    lastSyncAt: persisted.last_success_at,
    lastAttemptAt: persisted.last_attempt_at,
    summary: `The last sync completed successfully at ${persisted.last_success_at}.`,
  };
}

async function writeSyncState(path: string, state: PersistedSyncState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function readPersistedSyncState(path: string): Promise<PersistedSyncState | null> {
  try {
    return parsePersistedSyncState(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return null;
  }
}

function laterTimestamp(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function mergeSyncAttempt(
  current: PersistedSyncState | null,
  at: string,
  result: SyncAttemptResult,
): PersistedSyncState {
  const lastSuccessAt = result === "succeeded"
    ? laterTimestamp(current?.last_success_at ?? null, at)
    : current?.last_success_at ?? null;
  if (!current) {
    return {
      version: 1,
      last_attempt_at: at,
      last_attempt_result: result,
      last_success_at: lastSuccessAt,
    };
  }

  const currentTime = Date.parse(current.last_attempt_at);
  const nextTime = Date.parse(at);
  const nextIsLatest = nextTime > currentTime
    || (nextTime === currentTime
      && result === "failed"
      && current.last_attempt_result !== "failed");
  return {
    version: 1,
    last_attempt_at: nextIsLatest ? at : current.last_attempt_at,
    last_attempt_result: nextIsLatest ? result : current.last_attempt_result,
    last_success_at: lastSuccessAt,
  };
}

async function recordSyncAttempt(
  path: string,
  at: string,
  result: SyncAttemptResult,
): Promise<void> {
  if (!isTimestamp(at)) throw new Error("sync timestamp must be a valid date");
  await mkdir(dirname(path), { recursive: true });
  await withFileLock(path, async () => {
    const current = await readPersistedSyncState(path);
    await writeSyncState(path, mergeSyncAttempt(current, at, result));
  });
}

export async function recordSyncSuccess(path: string, at: string): Promise<void> {
  await recordSyncAttempt(path, at, "succeeded");
}

export async function recordSyncFailure(path: string, at: string): Promise<void> {
  await recordSyncAttempt(path, at, "failed");
}
