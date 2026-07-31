export type CwdKind = "registered" | "source" | "older";

export interface CliStationSpec {
  label: string;
  cwd: CwdKind;
  argv: string[];
  expectedExit: number | readonly number[];
}

const binary = "$BINARY";
const registered = "$REGISTERED";
const home = "$HOME";
const nonce = "$NONCE";

export const CLI_STATIONS: CliStationSpec[] = [
  { label: "registered_grok_mcp_list", cwd: "registered", argv: ["grok", "mcp", "list", "--json"], expectedExit: 0 },
  { label: "registered_grok_mcp_doctor", cwd: "registered", argv: ["grok", "mcp", "doctor"], expectedExit: [0, 1] },
  { label: "wrong_cwd_grok_mcp_list", cwd: "source", argv: ["grok", "mcp", "list", "--json"], expectedExit: 0 },
  { label: "wrong_cwd_grok_mcp_doctor", cwd: "source", argv: ["grok", "mcp", "doctor"], expectedExit: [0, 1] },
  { label: "registered_version_long", cwd: "registered", argv: [binary, "--version"], expectedExit: 0 },
  { label: "registered_version_short", cwd: "registered", argv: [binary, "-v"], expectedExit: 0 },
  { label: "registered_help_long", cwd: "registered", argv: [binary, "--help"], expectedExit: 0 },
  { label: "registered_help_short", cwd: "registered", argv: [binary, "-h"], expectedExit: 0 },
  { label: "no_arguments", cwd: "registered", argv: [binary], expectedExit: 1 },
  { label: "unknown_subcommand", cwd: "registered", argv: [binary, "nonsense"], expectedExit: 1 },
  { label: "help_extra_rejected", cwd: "registered", argv: [binary, "--help", "unexpected"], expectedExit: 1 },
  { label: "version_extra_rejected", cwd: "registered", argv: [binary, "--version", "unexpected"], expectedExit: 1 },
  { label: "registered_doctor_human", cwd: "registered", argv: [binary, "doctor"], expectedExit: 0 },
  { label: "registered_doctor_json", cwd: "registered", argv: [binary, "doctor", "--json"], expectedExit: 0 },
  { label: "wrong_cwd_doctor_json", cwd: "source", argv: [binary, "doctor", "--json"], expectedExit: 0 },
  { label: "older_source_newer_deployed_doctor_json", cwd: "older", argv: [binary, "doctor", "--json"], expectedExit: 0 },
  { label: "doctor_positional_rejected", cwd: "registered", argv: [binary, "doctor", "unexpected"], expectedExit: 1 },
  { label: "doctor_flag_rejected", cwd: "registered", argv: [binary, "doctor", "--verbose"], expectedExit: 1 },
  { label: "registered_selfcheck_human", cwd: "registered", argv: [binary, "selfcheck"], expectedExit: 0 },
  { label: "registered_selfcheck_json", cwd: "registered", argv: [binary, "selfcheck", "--json"], expectedExit: 0 },
  { label: "selfcheck_arg_rejected", cwd: "registered", argv: [binary, "selfcheck", "--verbose"], expectedExit: 1 },
  { label: "init_dry_run_human", cwd: "registered", argv: [binary, "init", "--dry-run"], expectedExit: 0 },
  { label: "init_dry_run_json", cwd: "registered", argv: [binary, "init", "--dry-run", "--json", "--strict"], expectedExit: 0 },
  { label: "init_explicit_cwd", cwd: "registered", argv: [binary, "init", "--dry-run", "--json", "--cwd", registered], expectedExit: 0 },
  { label: "init_equals_cwd", cwd: "registered", argv: [binary, "init", "--dry-run", "--json", `--cwd=${registered}`], expectedExit: 0 },
  { label: "init_missing_cwd", cwd: "registered", argv: [binary, "init", "--cwd"], expectedExit: 1 },
  { label: "init_empty_cwd", cwd: "registered", argv: [binary, "init", "--cwd="], expectedExit: 1 },
  { label: "init_unknown_arg", cwd: "registered", argv: [binary, "init", "unexpected"], expectedExit: 1 },
  { label: "sync_dry_run_human", cwd: "registered", argv: [binary, "sync", "--dry-run"], expectedExit: 0 },
  { label: "sync_dry_run_json", cwd: "registered", argv: [binary, "sync", "--dry-run", "--json", "--strict"], expectedExit: 0 },
  { label: "sync_explicit_cwd", cwd: "registered", argv: [binary, "sync", "--dry-run", "--json", "--cwd", registered], expectedExit: 0 },
  { label: "sync_equals_cwd", cwd: "registered", argv: [binary, "sync", "--dry-run", "--json", `--cwd=${registered}`], expectedExit: 0 },
  { label: "sync_missing_cwd", cwd: "registered", argv: [binary, "sync", "--cwd"], expectedExit: 1 },
  { label: "sync_empty_cwd", cwd: "registered", argv: [binary, "sync", "--cwd="], expectedExit: 1 },
  { label: "sync_unknown_arg", cwd: "registered", argv: [binary, "sync", "--unknown"], expectedExit: 1 },
  { label: "mcp_unknown_arg", cwd: "registered", argv: [binary, "mcp", "unexpected"], expectedExit: 1 },
  { label: "hook_deferred", cwd: "registered", argv: [binary, "hook"], expectedExit: 1 },
  { label: "index_rebuild_deferred", cwd: "registered", argv: [binary, "index", "--rebuild"], expectedExit: 1 },
  { label: "projected_rules_links", cwd: "registered", argv: ["find", `${home}/.grok/rules`, "-maxdepth", "1", "-printf", "%y %f -> %l\\n"], expectedExit: 0 },
  { label: "search_help_long", cwd: "registered", argv: [binary, "search", "--help"], expectedExit: 0 },
  { label: "search_help_short", cwd: "registered", argv: [binary, "search", "-h"], expectedExit: 0 },
  { label: "search_populated", cwd: "registered", argv: [binary, "search", "--threshold", "0", "--top-k", "5", "standard development flow"], expectedExit: 0 },
  { label: "search_empty", cwd: "registered", argv: [binary, "search", "--threshold", "1", `zzqv_no_hit_${nonce}`], expectedExit: 0 },
  { label: "search_schema_error", cwd: "registered", argv: [binary, "search", "--type", "bogus", "query"], expectedExit: 1 },
  { label: "search_missing_query", cwd: "registered", argv: [binary, "search"], expectedExit: 1 },
  { label: "search_unknown_argument", cwd: "registered", argv: [binary, "search", "--unknown", "query"], expectedExit: 1 },
  { label: "search_raw", cwd: "registered", argv: [binary, "search", "--raw", "--threshold", "0", "--top-k", "3", "standard development flow"], expectedExit: 0 },
  { label: "read_help_long", cwd: "registered", argv: [binary, "read", "--help"], expectedExit: 0 },
  { label: "read_help_short", cwd: "registered", argv: [binary, "read", "-h"], expectedExit: 0 },
  { label: "read_long_page_1", cwd: "registered", argv: [binary, "read", "comprehensive-pr-description", "--page-size", "300"], expectedExit: 0 },
  { label: "read_long_page_2", cwd: "registered", argv: [binary, "read", "comprehensive-pr-description", "--page", "2", "--page-size", "300"], expectedExit: 0 },
  { label: "read_long_full", cwd: "registered", argv: [binary, "read", "comprehensive-pr-description", "--full"], expectedExit: 0 },
  { label: "read_long_raw", cwd: "registered", argv: [binary, "read", "comprehensive-pr-description", "--raw"], expectedExit: 0 },
  { label: "read_security_absolute", cwd: "registered", argv: [binary, "read", "/etc/shadow"], expectedExit: 1 },
  { label: "read_security_traversal", cwd: "registered", argv: [binary, "read", "memex://grok-global/../../etc/shadow"], expectedExit: 1 },
  { label: "read_unknown_name", cwd: "registered", argv: [binary, "read", `zzqv-no-entry-${nonce}`], expectedExit: 1 },
  { label: "read_page_out_of_range", cwd: "registered", argv: [binary, "read", "comprehensive-pr-description", "--page", "999"], expectedExit: 1 },
  { label: "read_invalid_page", cwd: "registered", argv: [binary, "read", "comprehensive-pr-description", "--page", "0"], expectedExit: 1 },
  { label: "search_default_omitted_top_k", cwd: "registered", argv: [binary, "search", "--raw", "--threshold", "0", "standard development flow"], expectedExit: 0 },
];

export const REQUIRED_CLI_SEMANTICS = [
  "registered_help_long", "registered_doctor_json", "wrong_cwd_doctor_json",
  "older_source_newer_deployed_doctor_json", "registered_selfcheck_json",
  "sync_dry_run_json", "search_populated", "search_empty", "search_schema_error",
  "search_raw", "read_long_page_1", "read_long_page_2", "read_long_full",
  "read_long_raw", "read_security_absolute", "read_security_traversal",
] as const;

export const SCHEMA_CASES = [
  ["status_extra_argument", "memex_status", { extra: true }],
  ["status_arguments_null", "memex_status", null],
  ["status_arguments_array", "memex_status", []],
  ["search_empty_query", "memex_search", { query: "" }],
  ["search_missing_query", "memex_search", {}],
  ["search_query_wrong_type", "memex_search", { query: 7 }],
  ["search_top_k_zero", "memex_search", { query: "x", top_k: 0 }],
  ["search_top_k_over_max", "memex_search", { query: "x", top_k: 21 }],
  ["search_top_k_fraction", "memex_search", { query: "x", top_k: 1.5 }],
  ["search_top_k_wrong_type", "memex_search", { query: "x", top_k: "2" }],
  ["search_threshold_negative", "memex_search", { query: "x", threshold: -1 }],
  ["search_threshold_over_max", "memex_search", { query: "x", threshold: 2 }],
  ["search_threshold_wrong_type", "memex_search", { query: "x", threshold: "0" }],
  ["search_types_invalid_enum", "memex_search", { query: "x", types: ["bogus"] }],
  ["search_types_wrong_type", "memex_search", { query: "x", types: "rule" }],
  ["search_unknown_argument", "memex_search", { query: "x", extra: true }],
  ["search_arguments_null", "memex_search", null],
  ["read_query_id_wrong_type", "memex_read_skill", { name: "standard-development-flow", query_id: 7 }],
  ["read_unknown_argument", "memex_read_skill", { name: "standard-development-flow", extra: true }],
] as const;
