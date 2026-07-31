import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { inspectCaptureManifest } from "../capture/clipping-detector.ts";

export const SCHEMA_LABELS = [
  "status_extra_argument", "status_arguments_null", "status_arguments_array",
  "search_empty_query", "search_missing_query", "search_query_wrong_type",
  "search_top_k_zero", "search_top_k_over_max", "search_top_k_fraction",
  "search_top_k_wrong_type", "search_threshold_negative", "search_threshold_over_max",
  "search_threshold_wrong_type", "search_types_invalid_enum", "search_types_wrong_type",
  "search_unknown_argument", "search_arguments_null", "read_query_id_wrong_type",
  "read_unknown_argument",
] as const;

export const REQUIRED_FRAME_TITLES = [
  "help", "doctor — registered", "doctor — wrong cwd", "doctor — freshness ordering",
  "selfcheck", "sync — dry run", "MCP status", "search help", "search — populated",
  "search — empty", "search — invalid argument", "search — raw", "read help",
  "read — page 1", "read — page 2", "read — full (start)", "read — full (end)",
  "read — raw (start)", "read — raw (end)", "read — security reject",
  "MCP tools/list", "MCP search", "MCP read drill-in", "MCP schema rejects",
  "MCP malformed stdin survival", "MCP security rejects", "MCP long content (start)",
  "MCP long content (end)", "MCP omitted top_k → 5",
] as const;

export interface Check {
  name: string;
  passed: boolean;
  evidence: unknown;
}

export interface ValidationReport {
  nonce: string;
  passed: boolean;
  passed_count: number;
  check_count: number;
  checks: Check[];
}

type Json = Record<string, any>;

export function validateWalkPackage(out: string, source: string, nonce: string): ValidationReport {
  const cli = readJson(out, "01-live-cli-stations.json");
  const mcp = readJson(out, "02-live-mcp-transcript.json");
  const capture = readJson(out, "capture-manifest.json");
  const cliByLabel = new Map<string, Json>(cli.captures.map((entry: Json) => [entry.label, entry]));
  const mcpByLabel = new Map<string, Json>(mcp.transcript.map((entry: Json) => [entry.label, entry]));
  const checks: Check[] = [];
  const check = (name: string, passed: boolean, evidence: unknown) => checks.push({ name, passed, evidence });

  const installedVersion = cli.release_truth.installed_version.stdout.trim();
  const installedStamp = cli.release_truth.installed_stamp;
  const harnessCommit = cli.release_truth.harness_source_head.stdout.trim();
  const originHead = cli.release_truth.origin_main.stdout.trim().split(/\s+/)[0];
  check("nonce_consistent", cli.nonce === nonce && mcp.nonce === nonce && capture.walk_nonce === nonce, { cli: cli.nonce, mcp: mcp.nonce, capture: capture.walk_nonce });
  check("installed_stamp_matches_binary", installedVersion === installedStamp, { installedVersion, installedStamp });
  check("harness_commit_stamped", /^[0-9a-f]{40}$/.test(harnessCommit) && capture.harness_commit === harnessCommit, { harnessCommit, capture: capture.harness_commit });
  check("harness_checkout_clean", cli.release_truth.harness_source_status.stdout === "", cli.release_truth.harness_source_status);
  check("harness_history_comparable_to_origin", historiesComparable(source, harnessCommit, originHead), { harnessCommit, originHead });
  check("all_cli_exit_contracts_match", cli.captures.length >= 40 && cli.captures.every((entry: Json) => entry.exit_contract_matches), { observed: cli.captures.length, failures: cli.captures.filter((entry: Json) => !entry.exit_contract_matches).map((entry: Json) => entry.label) });

  const requiredCli = [
    "registered_help_long", "registered_doctor_json", "wrong_cwd_doctor_json",
    "older_source_newer_deployed_doctor_json", "registered_selfcheck_json", "sync_dry_run_json",
    "search_populated", "search_empty", "search_schema_error", "search_raw",
    "read_long_page_1", "read_long_page_2", "read_long_full", "read_long_raw",
    "read_security_absolute", "read_security_traversal",
  ];
  check("required_cli_semantics_present", requiredCli.every((label) => cliByLabel.has(label)), { requiredCli });
  const selfcheck = parseJsonOutput(cliByLabel.get("registered_selfcheck_json"));
  check("installed_selfcheck_all_pass", selfcheck?.passed === true && selfcheck?.steps?.every((step: Json) => step.passed), selfcheck);

  const tools = mcp.tools_list_response?.result?.tools?.map((tool: Json) => tool.name) ?? [];
  check("all_three_mcp_tools", ["memex_status", "memex_search", "memex_read_skill"].every((tool) => tools.includes(tool)) && tools.length === 3, tools);
  check("malformed_and_split_stdin_survive", mcp.raw_client_chunks?.[0]?.startsWith("{not json") && mcp.raw_client_chunks?.length >= 4 && mcp.initialize_response?.result, { chunks: mcp.raw_client_chunks?.slice(0, 4), initialize: mcp.initialize_response });
  check("mcp_server_exits_cleanly", mcp.server_exit_code === 0, mcp.server_exit_code);

  const populated = mcp.populated_searches ?? [];
  check("populated_searches_and_default_top_k", populated.length >= 4 && populated.find((entry: Json) => entry.label === "search_default_omitted_top_k")?.results?.length === 5, populated.map((entry: Json) => ({ label: entry.label, count: entry.results?.length })));
  check("every_returned_hit_read_by_handle_and_name", mcp.round_trip_reads?.length > 0 && mcp.round_trip_reads.every((entry: Json) => entry.content_equal && entry.handle_content_length > 100), { reads: mcp.round_trip_reads?.length, unequal: mcp.round_trip_reads?.filter((entry: Json) => !entry.content_equal).length });

  const schemaEntries = SCHEMA_LABELS.map((label) => mcpByLabel.get(label));
  check("all_discovered_schema_cases_fail_closed", schemaEntries.every((entry) => entry && isToolError(entry.response)), { required: SCHEMA_LABELS.length, rejected: schemaEntries.filter((entry) => entry && isToolError(entry.response)).length });
  const absolute = mcpByLabel.get("security_absolute_shadow");
  const traversal = mcpByLabel.get("security_traversal_handle");
  check("security_paths_rejected", Boolean(absolute && traversal && isToolError(absolute.response) && isToolError(traversal.response)), { absolute: absolute?.response, traversal: traversal?.response });
  const toolText = mcp.transcript.map((entry: Json) => responseText(entry.response)).join("\n");
  check("no_host_path_egress", !toolText.includes("/home/"), { occurrences: (toolText.match(/\/home\//g) ?? []).length });
  const locations = populated.flatMap((entry: Json) => entry.results ?? []).map((result: Json) => result.location);
  check("portable_locations_only", locations.length > 0 && locations.every((location: unknown) => typeof location === "string" && location.startsWith("memex://") && !location.includes("..")), { count: locations.length });

  const pages = [cliByLabel.get("read_long_page_1")?.stdout, cliByLabel.get("read_long_page_2")?.stdout];
  check("bounded_long_read_with_continuation", pages.every((value) => typeof value === "string" && value.includes("Continue:") && value.includes("Full:")), pages.map((value) => value?.length));
  check("full_and_raw_long_read_present", cliByLabel.get("read_long_full")?.stdout?.length > 1000 && cliByLabel.get("read_long_raw")?.stdout?.length > 1000, { full: cliByLabel.get("read_long_full")?.stdout?.length, raw: cliByLabel.get("read_long_raw")?.stdout?.length });

  const frameTitles = new Set(capture.frames?.map((frame: Json) => frame.title));
  check("semantic_frame_coverage", REQUIRED_FRAME_TITLES.every((title) => frameTitles.has(title)), { required: REQUIRED_FRAME_TITLES.length, observed: frameTitles.size, missing: REQUIRED_FRAME_TITLES.filter((title) => !frameTitles.has(title)) });
  check("rendered_text_exact_and_unclipped", capture.all_exact_text === true && capture.all_no_horizontal_clipping === true && capture.frames.every((frame: Json) => frame.exact_dom_text && frame.no_horizontal_clipping), { frames: capture.frames?.length });
  const pixelReport = inspectCaptureManifest(join(out, "capture-clipping-manifest.json"));
  check("final_png_pixel_prefix_gate", pixelReport.ok, pixelReport);
  check("owned_package_references_only", findForbiddenOwnedReferences(out).length === 0, findForbiddenOwnedReferences(out));

  return { nonce, passed: checks.every((entry) => entry.passed), passed_count: checks.filter((entry) => entry.passed).length, check_count: checks.length, checks };
}

export function findForbiddenOwnedReferences(out: string): Array<{ file: string; token: string }> {
  const forbidden = ["memex-codex", "memex-claude", "memex-hermes", "memex-openclaw", "scorecard", "state/parades", "parade slides", "slides.md"];
  const owned = ["walk-provenance.json", "README.md", "walk-report.md", "capture-manifest.md"];
  const findings: Array<{ file: string; token: string }> = [];
  for (const name of owned) {
    const path = join(out, name);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8").toLowerCase();
    for (const token of forbidden) if (text.includes(token)) findings.push({ file: name, token });
  }
  return findings;
}

export function inventory(
  out: string,
  excluded = new Set([
    "raw-manifest.json",
    "raw-manifest.md",
    "walk-provenance.json",
    "seeing-verdict.md",
  ]),
) {
  return walkFiles(out).filter((path) => !excluded.has(path)).map((path) => {
    const bytes = readFileSync(join(out, path));
    return { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
}

function historiesComparable(source: string, left: string, right: string): boolean {
  if (!/^[0-9a-f]{40}$/.test(left) || !/^[0-9a-f]{40}$/.test(right)) return false;
  const ancestor = (a: string, b: string) => {
    try { execFileSync("git", ["merge-base", "--is-ancestor", a, b], { cwd: source }); return true; }
    catch { return false; }
  };
  return ancestor(left, right) || ancestor(right, left);
}

function parseJsonOutput(entry: Json | undefined): Json | null {
  try { return JSON.parse(entry?.stdout ?? ""); } catch { return null; }
}
function responseText(response: Json): string { return response?.result?.content?.find((item: Json) => item.type === "text")?.text ?? ""; }
function isToolError(response: Json): boolean { return response?.result?.isError === true || response?.error !== undefined; }
function readJson(out: string, name: string): Json { return JSON.parse(readFileSync(join(out, name), "utf8")); }
function walkFiles(root: string, prefix = ""): string[] {
  return readdirSync(join(root, prefix)).flatMap((name) => {
    const child = join(prefix, name);
    return statSync(join(root, child)).isDirectory() ? walkFiles(root, child) : [child];
  }).sort();
}
