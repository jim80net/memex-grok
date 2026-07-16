import { describe, expect, it, vi } from "vitest";
import type { DoctorReport } from "../src/cli/doctor.ts";
import {
  performSelfcheck,
  resolveSelfMcpCommand,
  runSelfcheck,
  type McpToolResult,
  type SelfcheckDeps,
  type SelfcheckMcpClient,
} from "../src/cli/selfcheck.ts";

const LONG_CONTENT = `# Deployment skill\n${"self-verifying memory deployment guidance ".repeat(5)}`;
const TOP_LOCATION = "memex://grok-global/deployment/SKILL.md";

function doctor(ok = true): DoctorReport {
  return {
    ok,
    checks: [
      {
        name: ok ? "binary" : "broken",
        severity: ok ? "OK" : "FAIL",
        message: ok ? "healthy" : "broken",
      },
    ],
  };
}

interface FakeOptions {
  searchHits?: number;
  readContent?: string;
  acceptAbsolute?: boolean;
  acceptTraversal?: boolean;
  leakSearch?: boolean;
}

function fakeClient(options: FakeOptions = {}) {
  const {
    searchHits = 1,
    readContent = LONG_CONTENT,
    acceptAbsolute = false,
    acceptTraversal = false,
    leakSearch = false,
  } = options;
  const callTool = vi.fn(async (name: string, args: Record<string, unknown>): Promise<McpToolResult> => {
    if (name === "memex_search") {
      const results = searchHits > 0
        ? [{ name: "deployment-skill", location: TOP_LOCATION }]
        : [];
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            query_id: "q-selfcheck",
            results,
            ...(leakSearch ? { leak: "/home/operator/secret" } : {}),
          }),
        }],
      };
    }
    if (name !== "memex_read_skill") throw new Error(`unexpected tool ${name}`);
    if (args.location === "/etc/shadow") {
      return acceptAbsolute
        ? { content: [{ type: "text", text: "accepted" }] }
        : { isError: true, content: [{ type: "text", text: "unrecognized location" }] };
    }
    if (String(args.location).includes("../")) {
      return acceptTraversal
        ? { content: [{ type: "text", text: "accepted" }] }
        : { isError: true, content: [{ type: "text", text: "escapes scan root" }] };
    }
    return { content: [{ type: "text", text: readContent }] };
  });
  const client: SelfcheckMcpClient = { callTool, close: vi.fn(async () => {}) };
  return { client, callTool };
}

function deps(client: SelfcheckMcpClient, doctorOk = true): SelfcheckDeps {
  return {
    doctor: vi.fn(async () => doctor(doctorOk)),
    openMcp: vi.fn(async () => client),
  };
}

describe("performSelfcheck", () => {
  it("passes all five steps and forces threshold 0 for a real search", async () => {
    const { client, callTool } = fakeClient();
    const report = await performSelfcheck(deps(client));

    expect(report.ok).toBe(true);
    expect(report.steps.map((step) => [step.name, step.ok])).toEqual([
      ["doctor", true],
      ["search", true],
      ["read_skill", true],
      ["security", true],
      ["path-egress", true],
    ]);
    expect(callTool).toHaveBeenNthCalledWith(1, "memex_search", {
      query: "standard development flow",
      threshold: 0,
    });
    expect(callTool).toHaveBeenNthCalledWith(2, "memex_read_skill", {
      location: TOP_LOCATION,
      query_id: "q-selfcheck",
    });
  });

  it("fails the doctor step when an existing doctor check fails", async () => {
    const { client } = fakeClient();
    const report = await performSelfcheck(deps(client, false));
    expect(report.ok).toBe(false);
    expect(report.steps.find((step) => step.name === "doctor")?.ok).toBe(false);
  });

  it("fails search and round-trip when threshold-zero search returns no hits", async () => {
    const { client } = fakeClient({ searchHits: 0 });
    const report = await performSelfcheck(deps(client));
    expect(report.steps.find((step) => step.name === "search")?.ok).toBe(false);
    expect(report.steps.find((step) => step.name === "read_skill")?.ok).toBe(false);
  });

  it("fails read_skill when top-hit content is not longer than 100 characters", async () => {
    const { client } = fakeClient({ readContent: "short" });
    const report = await performSelfcheck(deps(client));
    const step = report.steps.find((candidate) => candidate.name === "read_skill");
    expect(step?.ok).toBe(false);
    expect(step?.message).toContain("expected more than 100");
  });

  it("fails security when either forbidden read is accepted", async () => {
    const { client } = fakeClient({ acceptAbsolute: true });
    const report = await performSelfcheck(deps(client));
    const step = report.steps.find((candidate) => candidate.name === "security");
    expect(step?.ok).toBe(false);
    expect(step?.message).toContain("absolute path");
  });

  it("fails path-egress when any MCP tool output contains /home/", async () => {
    const { client } = fakeClient({ leakSearch: true });
    const report = await performSelfcheck(deps(client));
    const step = report.steps.find((candidate) => candidate.name === "path-egress");
    expect(step?.ok).toBe(false);
    expect(step?.message).toContain("leaks /home/");
  });

  it("reports every dependent step failed when MCP startup is injected to fail", async () => {
    const report = await performSelfcheck({
      doctor: vi.fn(async () => doctor()),
      openMcp: vi.fn(async () => { throw new Error("injected startup failure"); }),
    });
    expect(report.ok).toBe(false);
    expect(report.steps).toHaveLength(5);
    expect(report.steps.slice(1).every((step) => !step.ok)).toBe(true);
  });
});

describe("runSelfcheck output", () => {
  it("prints human OK lines and JSON, with exit 0 only for a fully passing report", async () => {
    const human: string[] = [];
    const first = fakeClient();
    const humanCode = await runSelfcheck([], deps(first.client), { write: (chunk) => human.push(chunk) });
    expect(humanCode).toBe(0);
    expect(human.join("")).toMatch(/^OK: doctor/m);
    expect(human.join("")).toMatch(/^OK: path-egress/m);

    const json: string[] = [];
    const second = fakeClient({ readContent: "short" });
    const jsonCode = await runSelfcheck(["--json"], deps(second.client), { write: (chunk) => json.push(chunk) });
    expect(jsonCode).toBe(1);
    const report = JSON.parse(json.join("")) as { ok: boolean; steps: unknown[] };
    expect(report.ok).toBe(false);
    expect(report.steps).toHaveLength(5);
  });
});

describe("resolveSelfMcpCommand", () => {
  it("respawns the deployed executable directly", () => {
    expect(resolveSelfMcpCommand({
      execPath: "/opt/memex/memex-grok.bin",
      execArgv: [],
      argv: ["/opt/memex/memex-grok.bin", "/opt/memex/memex-grok.bin", "selfcheck"],
    })).toEqual({
      command: "/opt/memex/memex-grok.bin",
      args: ["mcp"],
    });
  });

  it("respawns the same TypeScript entry with the active Node flags", () => {
    expect(resolveSelfMcpCommand({
      execPath: "/usr/bin/node",
      execArgv: ["--experimental-strip-types"],
      argv: ["/usr/bin/node", "/repo/src/main.ts", "selfcheck"],
    })).toEqual({
      command: "/usr/bin/node",
      args: ["--experimental-strip-types", "/repo/src/main.ts", "mcp"],
    });
  });
});
