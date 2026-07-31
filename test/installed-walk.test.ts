import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { CAPTURE_PREFIX_MARKERS } from "../src/capture/clipping-detector.ts";
import {
  REQUIRED_FRAME_TITLES,
  SCHEMA_LABELS,
  findForbiddenOwnedReferences,
  validateWalkPackage,
} from "../src/walk/package-validator.ts";
import { bindReviewAuthorityUsingRegistry } from "../src/walk/reviewer-provenance.ts";
import { assertFinalizationCommit } from "../src/walk/finalization-provenance.ts";

const SOURCE = resolve(import.meta.dirname, "..");

describe("canonical installed-walk harness (#59)", () => {
  it("uses semantic minima and accepts additive stations/frames without exact daily pins", () => {
    const out = fixturePackage();
    const cli = readJson(out, "01-live-cli-stations.json");
    cli.captures.push({ label: "future_additive_command", exit_contract_matches: true });
    cli.station_count = cli.captures.length;
    writeJson(out, "01-live-cli-stations.json", cli);
    const capture = readJson(out, "capture-manifest.json");
    capture.frames.push({ title: "future additive frame", exact_dom_text: true, no_horizontal_clipping: true });
    capture.frame_count = capture.frames.length;
    writeJson(out, "capture-manifest.json", capture);

    const report = validateWalkPackage(out, SOURCE, "walk-test-123");
    expect(report.checks.find((check) => check.name === "all_cli_exit_contracts_match")?.passed).toBe(true);
    expect(report.checks.find((check) => check.name === "semantic_frame_coverage")?.passed).toBe(true);
    expect(report.passed).toBe(true);
  });

  it("keeps stamp, schema, security, host-egress, and final-pixel failures hard", () => {
    const out = fixturePackage();
    const cli = readJson(out, "01-live-cli-stations.json");
    cli.release_truth.installed_stamp = "different";
    writeJson(out, "01-live-cli-stations.json", cli);
    const mcp = readJson(out, "02-live-mcp-transcript.json");
    mcp.transcript.find((entry: any) => entry.label === SCHEMA_LABELS[0]).response.result.isError = false;
    mcp.transcript.push({ label: "host_leak", response: textResponse("/home/private/path") });
    writeJson(out, "02-live-mcp-transcript.json", mcp);
    const png = Buffer.from(readFileSync(join(out, "intact.png")));
    png.fill(17, png.length - 20, png.length - 16);
    writeFileSync(join(out, "intact.png"), png);

    const report = validateWalkPackage(out, SOURCE, "walk-test-123");
    const failed = report.checks.filter((check) => !check.passed).map((check) => check.name);
    expect(failed).toContain("installed_stamp_matches_binary");
    expect(failed).toContain("all_discovered_schema_cases_fail_closed");
    expect(failed).toContain("no_host_path_egress");
    expect(failed).toContain("final_png_pixel_prefix_gate");
  });

  it("rejects unowned references in package-owned prose but preserves raw evidence", () => {
    const out = mkdtempSync(join(tmpdir(), "memex-walk-owned-"));
    writeFileSync(join(out, "README.md"), "unrelated memex-codex scorecard");
    writeFileSync(join(out, "raw-cli-transcript.txt"), "corpus mentions state/parades/example/slides.md");
    expect(findForbiddenOwnedReferences(out)).toEqual([
      { file: "README.md", token: "memex-codex" },
      { file: "README.md", token: "scorecard" },
    ]);
  });

  it("binds exactly one independent reviewer and rejects conflicts", () => {
    const out = mkdtempSync(join(tmpdir(), "memex-walk-review-"));
    writeJson(out, "walk-provenance.json", provenance());
    writeFileSync(join(out, "seeing-verdict.md"), "| Reviewer | `grok-research` |\n");
    const registry = receiptRegistry("dispatch-1", "grok-research");
    bindForTest(out, "grok-research", "dispatch-1", registry);
    expect(readJson(out, "walk-provenance.json").review_authority).toMatchObject({
      state: "bound",
      reviewer: "grok-research",
      dispatch_receipt: expect.objectContaining({ sender: "memex", recipient: "grok-research", reason: "durable-ack" }),
      verdict_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    writeFileSync(join(out, "seeing-verdict.md"), "| Reviewer | `grok-research` |\nchanged\n");
    expect(() => bindForTest(out, "grok-research", "dispatch-1", registry)).toThrow("immutable");
    expect(() => bindForTest(out, "memex-claude", "dispatch-1", registry)).toThrow("does not match durable receipt recipient");
  });

  it("rejects caller-fabricated reviewer identity and acknowledgement text without a durable receipt", () => {
    const out = mkdtempSync(join(tmpdir(), "memex-walk-review-hostile-"));
    writeJson(out, "walk-provenance.json", provenance());
    writeFileSync(join(out, "seeing-verdict.md"), "Reviewer: `attacker`\n");
    const registry = receiptRegistry("different-dispatch", "attacker");
    expect(() => bindForTest(out, "attacker", "fabricated-equal-nonce-and-ack", registry)).toThrow("found 0");

    const realRegistry = receiptRegistry("real-dispatch", "grok-research");
    expect(() => bindForTest(out, "attacker", "real-dispatch", realRegistry)).toThrow("does not match durable receipt recipient");
  });

  it("ignores a caller-controlled FLOTILLA_ROSTER with a fake receipt and matching attacker identity", () => {
    const out = mkdtempSync(join(tmpdir(), "memex-walk-review-fake-roster-"));
    writeJson(out, "walk-provenance.json", provenance());
    writeFileSync(join(out, "seeing-verdict.md"), "Reviewer: `attacker`\n");
    const fakeRosterDir = mkdtempSync(join(tmpdir(), "fake-flotilla-roster-"));
    const fakeNonce = `fake-dispatch-${Date.now()}-${process.pid}`;
    writeJsonFile(join(fakeRosterDir, "flotilla.json"), {});
    writeJsonFile(join(fakeRosterDir, "flotilla-dispatch-consumed.json"), { entries: [receipt(fakeNonce, "attacker")] });
    const result = spawnSync(
      "pnpm",
      ["exec", "tsx", "scripts/walk-review.ts", "--nonce", "walk-test-123", "--out", out, "--dispatch-nonce", fakeNonce],
      { cwd: SOURCE, encoding: "utf8", env: { ...process.env, FLOTILLA_SELF: "attacker", FLOTILLA_ROSTER: join(fakeRosterDir, "flotilla.json") } },
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("expected one durable-ack receipt");
    expect(readJson(out, "walk-provenance.json").review_authority.state).toBe("pending");
  });

  it("rejects non-durable, wrong-sender, stale, duplicate, and incomplete receipts", () => {
    const out = mkdtempSync(join(tmpdir(), "memex-walk-review-hostile-"));
    writeJson(out, "walk-provenance.json", provenance());
    writeFileSync(join(out, "seeing-verdict.md"), "Reviewer: `grok-research`\n");
    for (const [name, entries, message] of [
      ["coordinator", [receipt("d", "grok-research", { reason: "coordinator-recipient" })], "found 0"],
      ["sender", [receipt("d", "grok-research", { sender: "attacker" })], "not authorized dispatcher"],
      ["stale", [receipt("d", "grok-research", { consumed_at: "2026-07-30T00:00:00.000Z" })], "predates"],
      ["duplicate", [receipt("d", "grok-research"), receipt("d", "grok-research")], "found 2"],
      ["incomplete", [receipt("d", "grok-research", { payload_hash: "caller-text" })], "incomplete"],
    ] as const) {
      const registry = join(out, `${name}.json`);
      writeJsonFile(registry, { entries });
      expect(() => bindForTest(out, "grok-research", "d", registry)).toThrow(message);
    }
  });

  it("rejects self-review and multiple reviewer declarations", () => {
    const out = mkdtempSync(join(tmpdir(), "memex-walk-review-"));
    writeJson(out, "walk-provenance.json", provenance());
    writeFileSync(join(out, "seeing-verdict.md"), "Reviewer: `memex-grok`\n");
    let registry = receiptRegistry("d", "memex-grok");
    expect(() => bindForTest(out, "memex-grok", "d", registry)).toThrow("capture owner");
    writeFileSync(join(out, "seeing-verdict.md"), "Reviewer: `grok-research`\nReviewer: `memex-claude`\n");
    registry = receiptRegistry("d", "grok-research");
    expect(() => bindForTest(out, "grok-research", "d", registry)).toThrow("exactly once");
    writeFileSync(join(out, "seeing-verdict.md"), "Reviewer: `grok-research`\n");
    writeFileSync(join(out, "seeing-verdict-second.md"), "Reviewer: `memex-claude`\n");
    expect(() => bindForTest(out, "grok-research", "d", registry)).toThrow("one canonical");
  });

  it("refuses to relabel evidence when HEAD changes between capture and finalization", () => {
    const captured = "1".repeat(40);
    expect(() => assertFinalizationCommit({
      currentCommit: "2".repeat(40),
      capturedCommit: captured,
      renderedCommit: captured,
      validatedCommit: captured,
    })).toThrow("changed between capture");
    expect(assertFinalizationCommit({ currentCommit: captured, capturedCommit: captured, renderedCommit: captured, validatedCommit: captured })).toBe(captured);
  });
});

function fixturePackage(): string {
  const out = mkdtempSync(join(tmpdir(), "memex-walk-package-"));
  mkdirSync(join(out, "render-sources"));
  const head = git("rev-parse", "HEAD");
  const origin = git("rev-list", "--max-parents=0", "HEAD").split("\n")[0];
  const requiredCli = [
    "registered_help_long", "registered_doctor_json", "wrong_cwd_doctor_json",
    "older_source_newer_deployed_doctor_json", "registered_selfcheck_json", "sync_dry_run_json",
    "search_populated", "search_empty", "search_schema_error", "search_raw",
    "read_long_page_1", "read_long_page_2", "read_long_full", "read_long_raw",
    "read_security_absolute", "read_security_traversal",
  ];
  const captures = requiredCli.map((label) => ({ label, stdout: outputFor(label), stderr: "", exit_contract_matches: true }));
  while (captures.length < 40) captures.push({ label: `coverage_${captures.length}`, stdout: "", stderr: "", exit_contract_matches: true });
  writeJson(out, "01-live-cli-stations.json", {
    nonce: "walk-test-123", station_count: captures.length,
    release_truth: {
      installed_version: { stdout: "0.1.0+abc\n" }, installed_stamp: "0.1.0+abc",
      harness_source_head: { stdout: `${head}\n` }, origin_main: { stdout: `${origin}\trefs/heads/main\n` },
      harness_source_status: { stdout: "" },
    }, captures,
  });
  const transcript = [
    { label: "status_populated", response: textResponse(JSON.stringify({ status: "ok" })) },
    ...SCHEMA_LABELS.map((label) => ({ label, response: errorResponse() })),
    { label: "security_absolute_shadow", response: errorResponse() },
    { label: "security_traversal_handle", response: errorResponse() },
  ];
  const hit = { name: "skill", location: "memex://portable/skill.md" };
  const populated_searches = [
    { label: "search_default_omitted_top_k", results: Array.from({ length: 5 }, (_, index) => ({ name: `skill-${index}`, location: `memex://portable/skill-${index}.md` })) },
    { label: "search_standard_flow", results: [hit] },
    { label: "search_merge_policy", results: [hit] },
    { label: "search_rules_only", results: [hit] },
  ];
  writeJson(out, "02-live-mcp-transcript.json", {
    nonce: "walk-test-123", station_count: transcript.length, transcript,
    tools_list_response: { result: { tools: [{ name: "memex_status" }, { name: "memex_search" }, { name: "memex_read_skill" }] } },
    raw_client_chunks: ["{not json\n", "{\"jsonrpc\":", "\"2.0\"}\n", "initialized\n"],
    initialize_response: { result: { protocolVersion: "test" } }, server_exit_code: 0,
    populated_searches,
    round_trip_reads: [{ content_equal: true, handle_content_length: 101 }],
  });
  const frames = REQUIRED_FRAME_TITLES.map((title) => ({ title, exact_dom_text: true, no_horizontal_clipping: true }));
  writeJson(out, "capture-manifest.json", { walk_nonce: "walk-test-123", harness_commit: head, all_exact_text: true, all_no_horizontal_clipping: true, frames });
  writeFileSync(join(out, "intact.png"), markedPng());
  const probes = [
    { kind: "title-prefix", x: 2, y: 2, size: 3, rgb: CAPTURE_PREFIX_MARKERS.title },
    { kind: "secondary-prefix", x: 2, y: 8, size: 3, rgb: CAPTURE_PREFIX_MARKERS.secondary },
  ];
  writeJson(out, "capture-clipping-manifest.json", { frames: frames.map(() => ({ png: "intact.png", probes })) });
  return out;
}

function outputFor(label: string): string {
  if (label === "registered_selfcheck_json") return JSON.stringify({ ok: true, steps: [{ ok: true }] });
  if (label === "read_long_page_1" || label === "read_long_page_2") return "page\n\nbody\n\nContinue: next\nFull: full\n";
  if (label === "read_long_full" || label === "read_long_raw") return "x".repeat(1500);
  return "ok";
}
function textResponse(text: string) { return { result: { content: [{ type: "text", text }] } }; }
function errorResponse() { return { result: { isError: true, content: [{ type: "text", text: "rejected" }] } }; }
function provenance() { return { walk_nonce: "walk-test-123", harness: { capture_owner: "memex-grok", captured_at: "2026-07-31T00:00:00.000Z" }, review_authority: { state: "pending", seeing_nonce: "walk-test-123-seeing", reviewer: null, dispatcher: "memex", superseded: [] } }; }
function readJson(out: string, name: string): any { return JSON.parse(readFileSync(join(out, name), "utf8")); }
function writeJson(out: string, name: string, value: unknown): void { writeFileSync(join(out, name), `${JSON.stringify(value, null, 2)}\n`); }
function writeJsonFile(path: string, value: unknown): void { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }
function receiptRegistry(nonce: string, recipient: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "flotilla-receipts-")), "flotilla-dispatch-consumed.json");
  writeJsonFile(path, { entries: [receipt(nonce, recipient)] });
  return path;
}
function receipt(nonce: string, recipient: string, overrides: Record<string, string> = {}) {
  return { nonce, payload_hash: "a".repeat(32), consumed_at: "2026-08-01T00:00:00.000Z", reason: "durable-ack", sender: "memex", recipient, ...overrides };
}
function bindForTest(out: string, claimedReviewer: string, dispatchNonce: string, receiptRegistry: string): void {
  bindReviewAuthorityUsingRegistry({ out, nonce: "walk-test-123", claimedReviewer, dispatchNonce }, receiptRegistry);
}
function git(...args: string[]): string { return execFileSync("git", args, { cwd: SOURCE, encoding: "utf8" }).trim(); }

function markedPng(): Buffer {
  const width = 24, height = 14;
  const pixels = new Uint8Array(width * height * 3).fill(17);
  paint(pixels, width, 2, 2, CAPTURE_PREFIX_MARKERS.title);
  paint(pixels, width, 2, 8, CAPTURE_PREFIX_MARKERS.secondary);
  const rows = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    rows[row] = 0;
    rows.set(pixels.subarray(y * width * 3, (y + 1) * width * 3), row + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}
function paint(pixels: Uint8Array, width: number, x: number, y: number, rgb: readonly [number, number, number]): void {
  for (let row = y; row < y + 3; row += 1) for (let column = x; column < x + 3; column += 1) pixels.set(rgb, (row * width + column) * 3);
}
function chunk(type: string, body: Buffer): Buffer {
  const out = Buffer.alloc(body.length + 12); out.writeUInt32BE(body.length, 0); out.write(type, 4, 4, "ascii"); body.copy(out, 8); out.writeUInt32BE(crc32(out.subarray(4, body.length + 8)), body.length + 8); return out;
}
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
