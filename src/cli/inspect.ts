import { assertNoHostPathLeaks, scrubHostPaths } from "../core/host-path-egress.ts";
import {
  openSelfMcpClient,
  type McpToolResult,
  type SelfcheckMcpClient,
} from "./selfcheck.ts";

const DEFAULT_PAGE_SIZE = 2_000;
const MIN_PAGE_SIZE = 200;
const MAX_PAGE_SIZE = 4_000;
const TEASER_LENGTH = 120;

export const SEARCH_USAGE = `usage: memex search [options] QUERY

options:
  --top-k N       Return 1–20 ranked results.
  --threshold N   Minimum relevance from 0 to 1.
  --type TYPE     Restrict type; repeat to include more than one.
  --raw           Print the unchanged MCP JSON payload.
  --help, -h      Print this help and exit.
`;

export const READ_USAGE = `usage: memex read [options] NAME|HANDLE

options:
  --page N        Print page N (default 1).
  --page-size N   Target characters per page, 200–4000 (default 2000).
  --full          Print complete content with a human header.
  --raw           Print unchanged full MCP content only.
  --help, -h      Print this help and exit.
`;

interface Output {
  write(chunk: string): unknown;
}

export interface InspectDeps {
  openMcp: () => Promise<SelfcheckMcpClient>;
}

interface SearchResult {
  name: string;
  type: string;
  location: string;
  relevance: number;
  description?: string;
}

interface SearchPayload {
  query_id: string;
  results: SearchResult[];
}

interface SearchOptions {
  query: string;
  raw: boolean;
  topK?: number;
  threshold?: number;
  types?: string[];
}

interface ReadOptions {
  target: string;
  raw: boolean;
  full: boolean;
  page: number;
  pageSize: number;
}

const defaultDeps: InspectDeps = { openMcp: openSelfMcpClient };

export async function runSearch(
  args: string[],
  deps: InspectDeps = defaultDeps,
  stdout: Output = process.stdout,
  stderr: Output = process.stderr,
): Promise<number> {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    stdout.write(SEARCH_USAGE);
    return 0;
  }
  let options: SearchOptions;
  try {
    options = parseSearchArgs(args);
  } catch (error) {
    return writeError("search", error, stderr);
  }

  return withMcp(deps, "search", stderr, async (client) => {
    const toolArgs: Record<string, unknown> = { query: options.query };
    if (options.topK !== undefined) toolArgs.top_k = options.topK;
    if (options.threshold !== undefined) toolArgs.threshold = options.threshold;
    if (options.types) toolArgs.types = options.types;
    const result = await client.callTool("memex_search", toolArgs);
    const text = toolText(result);
    if (result.isError) return writeToolError("search", text, stderr);
    if (options.raw) {
      stdout.write(terminated(text));
      return 0;
    }

    const payload = parseSearchPayload(text);
    stdout.write(renderSearch(options.query, payload));
    return 0;
  });
}

export async function runRead(
  args: string[],
  deps: InspectDeps = defaultDeps,
  stdout: Output = process.stdout,
  stderr: Output = process.stderr,
): Promise<number> {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    stdout.write(READ_USAGE);
    return 0;
  }
  let options: ReadOptions;
  try {
    options = parseReadArgs(args);
  } catch (error) {
    return writeError("read", error, stderr);
  }

  return withMcp(deps, "read", stderr, async (client) => {
    const byLocation = options.target.startsWith("memex://") || options.target.startsWith("/");
    const result = await client.callTool("memex_read_skill", {
      [byLocation ? "location" : "name"]: options.target,
    });
    const content = toolText(result);
    if (result.isError) return writeToolError("read", content, stderr);
    if (options.raw) {
      stdout.write(terminated(content));
      return 0;
    }
    stdout.write(renderRead(options, content));
    return 0;
  });
}

async function withMcp(
  deps: InspectDeps,
  operation: string,
  stderr: Output,
  action: (client: SelfcheckMcpClient) => Promise<number>,
): Promise<number> {
  let client: SelfcheckMcpClient | null = null;
  try {
    client = await deps.openMcp();
    return await action(client);
  } catch (error) {
    return writeError(operation, error, stderr);
  } finally {
    await client?.close();
  }
}

export function parseSearchArgs(args: string[]): SearchOptions {
  const positional: string[] = [];
  let raw = false;
  let topK: number | undefined;
  let threshold: number | undefined;
  const types: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--raw") {
      raw = true;
      continue;
    }
    const valueFlag = splitValueFlag(arg, args[index + 1], ["--top-k", "--threshold", "--type"]);
    if (valueFlag) {
      if (!arg.includes("=")) index++;
      if (valueFlag.name === "--top-k") topK = positiveInteger(valueFlag.value, "--top-k");
      if (valueFlag.name === "--threshold") threshold = boundedNumber(valueFlag.value, "--threshold", 0, 1);
      if (valueFlag.name === "--type") types.push(valueFlag.value);
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`unsupported argument '${arg}'`);
    positional.push(arg);
  }
  const query = positional.join(" ").trim();
  if (!query) throw new Error("query is required");
  return { query, raw, topK, threshold, types: types.length > 0 ? types : undefined };
}

export function parseReadArgs(args: string[]): ReadOptions {
  const positional: string[] = [];
  let raw = false;
  let full = false;
  let page = 1;
  let pageSize = DEFAULT_PAGE_SIZE;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--raw" || arg === "--full") {
      raw = raw || arg === "--raw";
      full = full || arg === "--full";
      continue;
    }
    const valueFlag = splitValueFlag(arg, args[index + 1], ["--page", "--page-size"]);
    if (valueFlag) {
      if (!arg.includes("=")) index++;
      if (valueFlag.name === "--page") page = positiveInteger(valueFlag.value, "--page");
      if (valueFlag.name === "--page-size") {
        pageSize = positiveInteger(valueFlag.value, "--page-size");
        if (pageSize < MIN_PAGE_SIZE || pageSize > MAX_PAGE_SIZE) {
          throw new Error(`--page-size must be between ${MIN_PAGE_SIZE} and ${MAX_PAGE_SIZE}`);
        }
      }
      continue;
    }
    if (arg.startsWith("-") && !arg.startsWith("memex://")) {
      throw new Error(`unsupported argument '${arg}'`);
    }
    positional.push(arg);
  }
  if (positional.length === 0) throw new Error("name or portable handle is required");
  if (positional.length > 1) throw new Error("provide exactly one name or portable handle");
  if (raw && full) throw new Error("--raw and --full are mutually exclusive");
  if ((raw || full) && page !== 1) throw new Error("--page cannot be combined with --raw or --full");
  return { target: positional[0]!, raw, full, page, pageSize };
}

export function renderSearch(query: string, payload: SearchPayload): string {
  if (payload.results.length === 0) return `No results for ${JSON.stringify(query)}.\n`;
  const lines = [`${payload.results.length} result(s) for ${JSON.stringify(query)} — query ${payload.query_id}`];
  for (const [index, result] of payload.results.entries()) {
    lines.push(`${index + 1}. ${result.name} [${result.type}] relevance=${formatRelevance(result.relevance)}`);
    lines.push(`   ${boundedTeaser(result.description ?? "No description.")}`);
    lines.push(`   read: memex read ${shellQuote(result.location)}`);
  }
  return `${lines.join("\n")}\n`;
}

export interface ReadPage {
  /** Zero-based Unicode code-point offset, inclusive. */
  start: number;
  /** Zero-based Unicode code-point offset, exclusive. */
  end: number;
  text: string;
}

/**
 * Split content into deterministic, lossless pages of Unicode code points.
 *
 * A page ends at the latest whitespace at or before its requested size so the
 * next page begins with a whole word/line. The delimiter stays on the earlier
 * page, making concatenation exact. A token longer than the requested size has
 * no eligible delimiter and therefore uses the hard, Unicode-safe boundary.
 */
export function paginateReadContent(content: string, pageSize: number): ReadPage[] {
  const codePoints = Array.from(content);
  const pages: ReadPage[] = [];
  let start = 0;

  while (start < codePoints.length) {
    const hardEnd = Math.min(start + pageSize, codePoints.length);
    let end = hardEnd;
    if (hardEnd < codePoints.length) {
      let sawNonWhitespace = false;
      let humanEnd: number | undefined;
      for (let index = start; index < hardEnd; index++) {
        if (/\s/u.test(codePoints[index]!)) {
          if (sawNonWhitespace) humanEnd = index + 1;
        } else {
          sawNonWhitespace = true;
        }
      }
      end = humanEnd ?? hardEnd;
    }
    pages.push({ start, end, text: codePoints.slice(start, end).join("") });
    start = end;
  }
  return pages;
}

export function renderRead(options: ReadOptions, content: string): string {
  if (content.length === 0) return `${options.target} — empty content\n`;
  const codePoints = Array.from(content);
  const contentLength = codePoints.length;
  if (options.full) {
    return `${options.target} — full content (${contentLength} chars)\n\n${terminated(content)}`;
  }
  const pages = paginateReadContent(content, options.pageSize);
  if (options.page > pages.length) {
    throw new Error(`page ${options.page} is past the last page (${pages.length})`);
  }
  const page = pages[options.page - 1]!;
  const lines = [
    `${options.target} — page ${options.page}/${pages.length} (chars ${page.start + 1}-${page.end} of ${contentLength})`,
    "",
    page.text,
  ];
  if (page.end < contentLength) {
    lines.push("", `Continue: memex read ${shellQuote(options.target)} --page ${options.page + 1} --page-size ${options.pageSize}`);
    lines.push(`Full: memex read ${shellQuote(options.target)} --full`);
  }
  return `${lines.join("\n")}\n`;
}

/** Encode one literal argument for POSIX shells without allowing expansion. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function parseSearchPayload(text: string): SearchPayload {
  const parsed = JSON.parse(text) as Partial<SearchPayload>;
  if (typeof parsed.query_id !== "string" || !Array.isArray(parsed.results)) {
    throw new Error("memex_search returned a malformed result");
  }
  return parsed as SearchPayload;
}

function boundedTeaser(value: string): string {
  const oneLine = value.replace(/\s+/g, " ").trim() || "No description.";
  if (oneLine.length <= TEASER_LENGTH) return oneLine;
  return `${oneLine.slice(0, TEASER_LENGTH - 1).trimEnd()}…`;
}

function formatRelevance(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : "n/a";
}

function toolText(result: McpToolResult): string {
  return result.content.map((part) => part.text).join("\n");
}

function writeToolError(operation: string, message: string, stderr: Output): number {
  const safe = scrubHostPaths(message);
  assertNoHostPathLeaks(safe);
  stderr.write(`memex: ${operation}: ${safe}\n`);
  return 1;
}

function writeError(operation: string, error: unknown, stderr: Output): number {
  return writeToolError(operation, error instanceof Error ? error.message : String(error), stderr);
}

function terminated(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function splitValueFlag(
  arg: string,
  next: string | undefined,
  names: readonly string[],
): { name: string; value: string } | null {
  const equals = arg.indexOf("=");
  const name = equals >= 0 ? arg.slice(0, equals) : arg;
  if (!names.includes(name)) return null;
  const value = equals >= 0 ? arg.slice(equals + 1) : next;
  if (!value || (equals < 0 && value.startsWith("--"))) throw new Error(`'${name}' requires a value`);
  return { name, value };
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function boundedNumber(value: string, name: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return parsed;
}
