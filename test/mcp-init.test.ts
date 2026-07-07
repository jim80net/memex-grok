import { describe, it, expect, vi } from "vitest";
import { OnceInit } from "../src/mcp/init.ts";

describe("OnceInit", () => {
  it("runs the work exactly once across concurrent calls", async () => {
    const work = vi.fn().mockImplementation(async () => { await new Promise((r) => setTimeout(r, 10)); return "ok"; });
    const init = new OnceInit(work);
    const a = init.ensure();
    const b = init.ensure();
    const c = init.ensure();
    expect(await Promise.all([a, b, c])).toEqual(["ok", "ok", "ok"]);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("re-uses the resolved value on subsequent calls", async () => {
    const work = vi.fn().mockResolvedValue("first");
    const init = new OnceInit(work);
    await init.ensure();
    await init.ensure();
    await init.ensure();
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("re-runs on failure for a subsequent call", async () => {
    let n = 0;
    const work = vi.fn().mockImplementation(async () => { n += 1; if (n === 1) throw new Error("transient"); return "ok"; });
    const init = new OnceInit(work);
    await expect(init.ensure()).rejects.toThrow("transient");
    expect(await init.ensure()).toBe("ok");
    expect(work).toHaveBeenCalledTimes(2);
  });
});
