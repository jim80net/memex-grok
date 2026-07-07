import { arch, platform } from "node:os";
import { join } from "node:path";

/** Build stamp embedded in compiled binaries: `{version}+{gitShortSha}`. */
export function formatBuildStamp(version: string, gitShortSha: string): string {
  return `${version}+${gitShortSha}`;
}

export function currentPlatformKey(): string {
  return `${platform()}-${arch()}`;
}

/** Marker written at deploy time under the binary cache dir (issue #14, option a). */
export function deployStampPath(binaryCacheDir: string): string {
  return join(binaryCacheDir, ".stamp");
}

/** Stamp emitted by `pnpm build` for the current platform (dev "available" reference). */
export function localBuildStampPath(cwd: string = process.cwd()): string {
  return join(cwd, "dist", currentPlatformKey(), ".stamp");
}

export function normalizeStamp(raw: string): string {
  return raw.trim();
}