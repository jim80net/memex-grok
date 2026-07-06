import { describe, expect, it } from "vitest";
import { formatBuildStamp, normalizeStamp } from "../src/core/build-stamp.ts";

describe("build stamp", () => {
  it("formats version + git sha", () => {
    expect(formatBuildStamp("0.1.0-alpha.0", "326271e")).toBe("0.1.0-alpha.0+326271e");
  });

  it("normalizes stamp output", () => {
    expect(normalizeStamp("  0.1.0-alpha.0+abc\n")).toBe("0.1.0-alpha.0+abc");
  });
});