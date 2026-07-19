import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadSyncStatus,
  recordSyncFailure,
  recordSyncSuccess,
  syncStatePath,
} from "../src/core/sync-state.ts";

const roots: string[] = [];

async function temporaryStatePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "memex-sync-state-"));
  roots.push(root);
  const cacheDir = join(root, "cache");
  await mkdir(cacheDir, { recursive: true });
  return syncStatePath(cacheDir);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("durable sync state", () => {
  it("distinguishes disabled from enabled-but-never-run", async () => {
    const path = await temporaryStatePath();
    await expect(loadSyncStatus(path, false)).resolves.toEqual({
      state: "disabled",
      lastSyncAt: null,
      lastAttemptAt: null,
      summary: "Sync is disabled; no successful sync is recorded.",
    });
    await expect(loadSyncStatus(path, true)).resolves.toEqual({
      state: "never_synced",
      lastSyncAt: null,
      lastAttemptAt: null,
      summary: "Sync is enabled but has not run yet.",
    });
  });

  it("persists a measured successful sync atomically", async () => {
    const path = await temporaryStatePath();
    const at = "2026-07-19T04:00:00.000Z";
    await recordSyncSuccess(path, at);

    await expect(loadSyncStatus(path, true)).resolves.toEqual({
      state: "synced",
      lastSyncAt: at,
      lastAttemptAt: at,
      summary: `The last sync completed successfully at ${at}.`,
    });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      version: 1,
      last_attempt_at: at,
      last_attempt_result: "succeeded",
      last_success_at: at,
    });
  });

  it("records a failed attempt while preserving the last success", async () => {
    const path = await temporaryStatePath();
    const successAt = "2026-07-19T04:00:00.000Z";
    const failedAt = "2026-07-19T05:00:00.000Z";
    await recordSyncSuccess(path, successAt);
    await recordSyncFailure(path, failedAt);

    await expect(loadSyncStatus(path, true)).resolves.toEqual({
      state: "failed",
      lastSyncAt: successAt,
      lastAttemptAt: failedAt,
      summary: `The last sync attempt failed at ${failedAt}. The last successful sync was at ${successAt}.`,
    });
  });

  it("serializes concurrent transitions without losing success or regressing attempt order", async () => {
    const olderSuccess = "2026-07-19T04:00:00.000Z";
    const newerFailure = "2026-07-19T05:00:00.000Z";
    const paths = await Promise.all(
      Array.from({ length: 100 }, () => temporaryStatePath()),
    );

    await Promise.all(paths.map(async (path) => {
      await Promise.all([
        recordSyncSuccess(path, olderSuccess),
        recordSyncFailure(path, newerFailure),
      ]);
      await expect(loadSyncStatus(path, true)).resolves.toEqual({
        state: "failed",
        lastSyncAt: olderSuccess,
        lastAttemptAt: newerFailure,
        summary: `The last sync attempt failed at ${newerFailure}. The last successful sync was at ${olderSuccess}.`,
      });
    }));

    const reversePath = await temporaryStatePath();
    await recordSyncSuccess(reversePath, newerFailure);
    await recordSyncFailure(reversePath, olderSuccess);
    await expect(loadSyncStatus(reversePath, true)).resolves.toMatchObject({
      state: "synced",
      lastSyncAt: newerFailure,
      lastAttemptAt: newerFailure,
    });
  });

  it("reports malformed durable state as unknown, not never synced", async () => {
    const path = await temporaryStatePath();
    await writeFile(path, "{not-json", "utf8");
    await expect(loadSyncStatus(path, true)).resolves.toEqual({
      state: "unknown",
      lastSyncAt: null,
      lastAttemptAt: null,
      summary: "Sync history is unavailable; run memex sync to measure it.",
    });
  });
});
