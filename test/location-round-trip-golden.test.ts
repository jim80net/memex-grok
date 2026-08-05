// Cross-adapter location-handle conformance guard (memex-core#32 freeze-SHA memo).

import { describe, expect, it } from "vitest";
import {
  buildScanRoots,
  decodePortableLocation,
  encodePortableLocation,
  type ScanRootContext,
} from "@jim80net/memex-core";
import { LOCATION_ROUND_TRIP_GOLDEN } from "./fixtures/cross-adapter/location-round-trip-golden.ts";

const FIXTURE_CTX: ScanRootContext = {
  cwd: "/memex-test-home/project",
  syncEnabled: true,
  syncRepoDir: "/memex-test-home/.memex/sync",
  globalSkillsDirs: ["/memex-test-home/.grok/skills", "/memex-test-home/.claude/skills"],
  globalRulesDirs: ["/memex-test-home/.grok/rules"],
  projectSkillsDir: "/memex-test-home/project/.grok/skills",
  projectRulesDir: "/memex-test-home/project/.grok/rules",
  harness: "grok",
};

function fixtureRegistry() {
  return buildScanRoots(FIXTURE_CTX, {
    skillDirs: [
      "/memex-test-home/.grok/skills",
      "/memex-test-home/project/.grok/skills",
      "/memex-test-home/.memex/sync/skills",
      "/opt/extra/skills",
    ],
    memoryDirs: ["/memex-test-home/project/.grok/memories"],
    ruleDirs: ["/memex-test-home/.grok/rules", "/memex-test-home/.memex/sync/rules"],
  });
}

describe("location round-trip golden (memex-core#32 conformance)", () => {
  it("round-trips golden vectors against pinned memex-core", () => {
    const registry = fixtureRegistry();
    for (const { absolute, handle } of LOCATION_ROUND_TRIP_GOLDEN) {
      expect(encodePortableLocation(registry, absolute)).toBe(handle);
      expect(decodePortableLocation(registry, handle)).toBe(absolute);
    }
  });
});