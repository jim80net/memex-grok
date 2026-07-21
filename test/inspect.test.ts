import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  parseReadArgs,
  parseSearchArgs,
  renderRead,
  renderSearch,
  runRead,
  runSearch,
  shellQuote,
  type InspectDeps,
} from "../src/cli/inspect.ts";
import type { McpToolResult, SelfcheckMcpClient } from "../src/cli/selfcheck.ts";

function output() {
  let value = "";
  return { stream: { write: (chunk: string) => { value += chunk; } }, value: () => value };
}

function deps(result: McpToolResult) {
  const callTool = vi.fn(async () => result);
  const close = vi.fn(async () => undefined);
  const client: SelfcheckMcpClient = { callTool, close };
  const inspectDeps: InspectDeps = { openMcp: vi.fn(async () => client) };
  return { inspectDeps, callTool, close };
}

function toolText(text: string, isError = false): McpToolResult {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

describe("operator-readable inspection", () => {
  it("documents search and read options without starting MCP", async () => {
    for (const [run, expected] of [
      [runSearch, "usage: memex search [options] QUERY"],
      [runRead, "usage: memex read [options] NAME|HANDLE"],
    ] as const) {
      const fake = deps(toolText("must not run"));
      const stdout = output();
      expect(await run(["--help"], fake.inspectDeps, stdout.stream, output().stream)).toBe(0);
      expect(stdout.value()).toContain(expected);
      expect(stdout.value()).toContain("--raw");
      expect(fake.inspectDeps.openMcp).not.toHaveBeenCalled();
    }
  });

  it("renders populated search as ranked rows with bounded one-line teasers and read affordances", async () => {
    const payload = JSON.stringify({
      query_id: "q-123",
      results: [
        {
          name: "sync-main",
          type: "workflow",
          location: "memex://claude-global/sync-main/SKILL.md",
          relevance: 0.449,
          description: `First line\n${"long description ".repeat(20)}`,
        },
        {
          name: "verify-before-acting",
          type: "rule",
          location: "memex://grok-rules-global/verify-before-acting.md",
          relevance: 0.8,
          description: "Verify live state before making a claim.",
        },
      ],
    });
    const fake = deps(toolText(payload));
    const stdout = output();
    const stderr = output();

    const code = await runSearch(
      ["--threshold", "0", "--top-k=2", "--type", "workflow", "standard", "flow"],
      fake.inspectDeps,
      stdout.stream,
      stderr.stream,
    );

    expect(code).toBe(0);
    expect(fake.callTool).toHaveBeenCalledWith("memex_search", {
      query: "standard flow",
      top_k: 2,
      threshold: 0,
      types: ["workflow"],
    });
    expect(stdout.value()).toContain('2 result(s) for "standard flow" — query q-123');
    expect(stdout.value()).toContain("1. sync-main [workflow] relevance=0.449");
    expect(stdout.value()).toContain("read: memex read 'memex://claude-global/sync-main/SKILL.md'");
    const teaser = stdout.value().split("\n")[2]!.trim();
    expect(teaser).not.toContain("\n");
    expect(teaser.length).toBeLessThanOrEqual(120);
    expect(teaser.endsWith("…")).toBe(true);
    expect(stderr.value()).toBe("");
    expect(fake.close).toHaveBeenCalledOnce();
  });

  it("renders an honest empty search state", async () => {
    const fake = deps(toolText(JSON.stringify({ query_id: "q-empty", results: [] })));
    const stdout = output();
    const code = await runSearch(["nothing here"], fake.inspectDeps, stdout.stream, output().stream);
    expect(code).toBe(0);
    expect(stdout.value()).toBe('No results for "nothing here".\n');
  });

  it("passes through exact MCP search JSON in raw mode", async () => {
    const raw = '{"query_id":"q-raw","results":[]}';
    const fake = deps(toolText(raw));
    const stdout = output();
    expect(await runSearch(["--raw", "query"], fake.inspectDeps, stdout.stream, output().stream)).toBe(0);
    expect(stdout.value()).toBe(`${raw}\n`);
  });

  it("reports MCP schema/tool failures concisely and closes the server", async () => {
    const fake = deps(toolText("arguments.types[0] must be one of: skill, memory, rule", true));
    const stderr = output();
    const code = await runSearch(["--type", "bogus", "query"], fake.inspectDeps, output().stream, stderr.stream);
    expect(code).toBe(1);
    expect(stderr.value()).toBe("memex: search: arguments.types[0] must be one of: skill, memory, rule\n");
    expect(fake.close).toHaveBeenCalledOnce();
  });

  it("bounds long reads by default and provides deterministic continuation", async () => {
    const content = "0123456789".repeat(500);
    const fake = deps(toolText(content));
    const stdout = output();
    const code = await runRead(["long-skill"], fake.inspectDeps, stdout.stream, output().stream);
    expect(code).toBe(0);
    expect(fake.callTool).toHaveBeenCalledWith("memex_read_skill", { name: "long-skill" });
    expect(stdout.value()).toContain("long-skill — page 1/3 (chars 1-2000 of 5000)");
    expect(stdout.value()).toContain("Continue: memex read 'long-skill' --page 2 --page-size 2000");
    expect(stdout.value()).toContain("Full: memex read 'long-skill' --full");
    expect(stdout.value()).not.toContain(content);
  });

  it("renders a requested page and rejects pages past the end", async () => {
    const content = "x".repeat(450);
    const page = deps(toolText(content));
    const stdout = output();
    expect(await runRead(["item", "--page", "2", "--page-size", "200"], page.inspectDeps, stdout.stream, output().stream)).toBe(0);
    expect(stdout.value()).toContain("item — page 2/3 (chars 201-400 of 450)");

    const pastEnd = deps(toolText(content));
    const stderr = output();
    expect(await runRead(["item", "--page", "4", "--page-size", "200"], pastEnd.inspectDeps, output().stream, stderr.stream)).toBe(1);
    expect(stderr.value()).toBe("memex: read: page 4 is past the last page (3)\n");
  });

  it("provides explicit full and raw long-content modes", async () => {
    const content = "full content\n".repeat(300);
    const full = deps(toolText(content));
    const fullOut = output();
    expect(await runRead(["item", "--full"], full.inspectDeps, fullOut.stream, output().stream)).toBe(0);
    expect(fullOut.value()).toBe(`item — full content (${content.length} chars)\n\n${content}`);

    const raw = deps(toolText(content));
    const rawOut = output();
    expect(await runRead(["item", "--raw"], raw.inspectDeps, rawOut.stream, output().stream)).toBe(0);
    expect(rawOut.value()).toBe(content);
  });

  it("keeps absolute-path and traversal security rejections fail-closed", async () => {
    for (const target of ["/etc/shadow", "memex://grok-global/../../etc/shadow"]) {
      const fake = deps(toolText("absolute paths and traversal handles are rejected", true));
      const stderr = output();
      const code = await runRead([target], fake.inspectDeps, output().stream, stderr.stream);
      expect(code).toBe(1);
      expect(fake.callTool).toHaveBeenCalledWith("memex_read_skill", { location: target });
      expect(stderr.value()).toBe("memex: read: absolute paths and traversal handles are rejected\n");
      expect(stderr.value()).not.toContain("/home/");
    }
  });

  it("validates inspection arguments before starting MCP", () => {
    expect(() => parseSearchArgs([])).toThrow("query is required");
    expect(() => parseSearchArgs(["--threshold", "2", "query"])).toThrow("--threshold must be between 0 and 1");
    expect(() => parseSearchArgs(["--top-k", "1.5", "query"])).toThrow("--top-k must be a positive integer");
    expect(() => parseReadArgs([])).toThrow("name or portable handle is required");
    expect(() => parseReadArgs(["one", "two"])).toThrow("provide exactly one");
    expect(() => parseReadArgs(["item", "--page-size", "100"])).toThrow("between 200 and 4000");
    expect(() => parseReadArgs(["item", "--raw", "--full"])).toThrow("mutually exclusive");
    expect(() => parseReadArgs(["item", "--full", "--page", "2"])).toThrow("--page cannot be combined");
  });

  it("keeps short content to one bounded page", () => {
    expect(renderRead(parseReadArgs(["short"]), "hello")).toBe(
      "short — page 1/1 (chars 1-5 of 5)\n\nhello\n",
    );
  });

  it("renders an honest empty read state", () => {
    expect(renderRead(parseReadArgs(["empty"]), "")).toBe("empty — empty content\n");
  });

  it("prints corpus-controlled handles as literal POSIX shell arguments", () => {
    const hostile = "memex://scope/a'$(printf EXPANDED)`printf ALSO_EXPANDED` $HOME skill.md";
    const rendered = renderSearch("hostile", {
      query_id: "q-hostile",
      results: [{
        name: "hostile",
        type: "skill",
        location: hostile,
        relevance: 1,
        description: "Hostile location fixture.",
      }],
    });
    const command = rendered.split("\n").find((line) => line.includes("read: memex read"))!.trim().slice("read: ".length);
    const roundTrip = execFileSync("/bin/sh", ["-c", `memex() { printf '%s' "$2"; }; ${command}`], { encoding: "utf8" });

    expect(roundTrip).toBe(hostile);
    expect(command).toContain(shellQuote(hostile));
    expect(roundTrip).toContain("$(printf EXPANDED)");
    expect(roundTrip).toContain("`printf ALSO_EXPANDED`");
    expect(roundTrip).toContain("$HOME");
  });

  it("prints hostile continuation targets as literal POSIX shell arguments", () => {
    const hostile = "name with ' quote $(printf EXPANDED) `printf ALSO_EXPANDED` $HOME";
    const rendered = renderRead(parseReadArgs([hostile, "--page-size", "200"]), "x".repeat(401));
    const command = rendered.split("\n").find((line) => line.startsWith("Continue: "))!.slice("Continue: ".length);
    const roundTrip = execFileSync("/bin/sh", ["-c", `memex() { printf '%s' "$2"; }; ${command}`], { encoding: "utf8" });

    expect(roundTrip).toBe(hostile);
    expect(command).toContain(shellQuote(hostile));
  });

  it("pages by Unicode code points without splitting a non-BMP scalar", () => {
    const content = `${"a".repeat(199)}😀b`;
    const first = renderRead(parseReadArgs(["emoji", "--page-size", "200"]), content);
    const second = renderRead(parseReadArgs(["emoji", "--page-size", "200", "--page", "2"]), content);

    expect(first).toContain("page 1/2 (chars 1-200 of 201)");
    expect(first).toContain(`${"a".repeat(199)}😀`);
    expect(first).not.toContain("�");
    expect(second).toContain("page 2/2 (chars 201-201 of 201)\n\nb\n");
    expect(second).not.toContain("�");
    expect(new TextDecoder().decode(new TextEncoder().encode(first))).toBe(first);
    expect(new TextDecoder().decode(new TextEncoder().encode(second))).toBe(second);
  });
});
