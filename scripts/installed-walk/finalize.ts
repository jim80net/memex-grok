#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findForbiddenOwnedReferences, inventory } from "../../src/walk/package-validator.ts";
import { assertFinalizationCommit } from "../../src/walk/finalization-provenance.ts";
import { REVIEW_KEY_ID } from "../../src/walk/reviewer-provenance.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig(process.argv.slice(2), { allowPopulatedOut: true });
const cli = readJson("01-live-cli-stations.json");
const mcp = readJson("02-live-mcp-transcript.json");
const assertions = readJson("03-acceptance-assertions.json");
const capture = readJson("capture-manifest.json");
if (!assertions.passed) throw new Error("refusing to finalize a failing walk package");
const harnessCommit = assertFinalizationCommit({
  currentCommit: config.harnessCommit,
  capturedCommit: cli.release_truth.harness_source_head.stdout.trim(),
  renderedCommit: capture.harness_commit,
  validatedCommit: assertions.harness_commit,
});

const provenance = {
  schema_version: 2,
  walk_nonce: config.nonce,
  harness: {
    repository: "jim80net/memex-grok",
    commit: harnessCommit,
    capture_owner: config.captureOwner,
    captured_at: cli.captured_at,
  },
  review_authority: {
    state: "pending",
    authority_file: "seeing-verdict.md",
    seeing_nonce: `${config.nonce}-seeing`,
    reviewer: null,
    attestation_key_id: REVIEW_KEY_ID,
    dispatch_nonce: null,
    attestation_sha256: null,
    signed_attestation: null,
    superseded: [],
  },
};
writeJson("walk-provenance.json", provenance);

const returnedHits = mcp.populated_searches.reduce((total: number, search: any) => total + search.results.length, 0);
writeFileSync(join(config.out, "capture-manifest.md"), `# Rendered capture manifest\n\n- Walk nonce: \`${config.nonce}\`\n- Installed build: \`${capture.installed_build}\`\n- Harness commit: \`${harnessCommit}\`\n- Frames: ${capture.frames.length}\n- Exact DOM/source equality: ${capture.all_exact_text ? "PASS" : "FAIL"}\n- Horizontal geometry: ${capture.all_no_horizontal_clipping ? "PASS" : "FAIL"}\n- Final-pixel prefix gate: PASS\n\nThe renderer uses neutral capture chrome only. Long views are bounded start/end excerpts whose entries retain source offsets and total lengths.\n`);
writeFileSync(join(config.out, "walk-report.md"), `# Installed Memex walk\n\nThe installed consumer passed ${assertions.passed_count}/${assertions.check_count} fail-closed acceptance checks. No deployment was performed.\n\n## Coverage\n\n- ${cli.station_count} CLI stations with all exit contracts checked.\n- ${mcp.station_count} MCP stations across all three tools.\n- ${returnedHits} returned hit instances; ${mcp.round_trip_reads.length} handle/name equality drill-ins.\n- ${capture.frames.length} exact-text rendered frames.\n- Every registered schema probe, security path, portable identity, host-path egress, malformed-input survival, bounded/full/raw long read, freshness, and final-pixel prefix contract remained hard-gated.\n\n## Review authority\n\nExactly one independent authority may bind \`seeing-verdict.md\` for nonce \`${config.nonce}-seeing\` through \`pnpm walk:review\`. The package is pending that independent review.\n`);
writeFileSync(join(config.out, "README.md"), `# Memex installed-walk evidence\n\nImmutable capture package for \`${config.nonce}\`, produced by the canonical harness at \`${harnessCommit}\`.\n\n- Raw CLI: \`01-live-cli-stations.json\`, \`raw-cli-transcript.txt\`\n- Raw MCP: \`02-live-mcp-transcript.json\`\n- Acceptance: \`03-acceptance-assertions.json\`\n- Rendered evidence: \`capture-manifest.json\`, \`capture-manifest.md\`, PNGs, and \`render-sources/\`\n- Provenance: \`walk-provenance.json\`\n- Independent authority: pending \`seeing-verdict.md\`\n`);

const forbidden = findForbiddenOwnedReferences(config.out);
if (forbidden.length > 0) throw new Error(`unowned package references: ${JSON.stringify(forbidden)}`);
const files = inventory(config.out);
const rawManifest = {
  nonce: config.nonce,
  harness_commit: harnessCommit,
  generated_at: new Date().toISOString(),
  mutable_authority_files_excluded: ["walk-provenance.json", "seeing-verdict.md"],
  file_count: files.length,
  files,
};
writeJson("raw-manifest.json", rawManifest);
writeFileSync(join(config.out, "raw-manifest.md"), `# Raw evidence manifest\n\nNonce \`${config.nonce}\`; harness \`${harnessCommit}\`; ${files.length} files.\n\n| File | Bytes | SHA-256 |\n|---|---:|---|\n${files.map((file: any) => `| \`${file.path}\` | ${file.bytes} | \`${file.sha256}\` |`).join("\n")}\n`);
process.stdout.write(`${JSON.stringify({ nonce: config.nonce, harness_commit: harnessCommit, files: files.length, reviewer: "pending", passed: true }, null, 2)}\n`);

function readJson(name: string): any { return JSON.parse(readFileSync(join(config.out, name), "utf8")); }
function writeJson(name: string, value: unknown): void { writeFileSync(join(config.out, name), `${JSON.stringify(value, null, 2)}\n`); }
