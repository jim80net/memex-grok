#!/usr/bin/env python3
import argparse
import hashlib
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument("--nonce", required=True)
parser.add_argument("--out", required=True)
args = parser.parse_args()
OUT = Path(args.out).resolve()
CLI = json.loads((OUT / "01-live-cli-stations.json").read_text())
MCP = json.loads((OUT / "02-live-mcp-transcript.json").read_text())
SOURCES = OUT / "render-sources"
SOURCES.mkdir(exist_ok=True)
cli = {entry["label"]: entry for entry in CLI["captures"]}
mcp = {entry["label"]: entry for entry in MCP["transcript"]}


def cli_text(label):
    entry = cli[label]
    return entry["stdout"] + entry["stderr"]


def tool_text(label):
    response = mcp[label]["response"]
    for item in response.get("result", {}).get("content", []):
        if item.get("type") == "text":
            return item.get("text", "")
    return json.dumps(response, indent=2, ensure_ascii=False)


def pretty_response(label):
    return json.dumps(mcp[label]["response"], indent=2, ensure_ascii=False)


def excerpt(text, where, amount=2400):
    if len(text) <= amount:
        return text, 0, len(text)
    if where == "start":
        end = text.rfind("\n", 0, amount)
        end = end + 1 if end >= 0 else amount
        return text[:end], 0, end
    start = len(text) - amount
    newline = text.find("\n", start)
    start = newline + 1 if newline >= 0 else start
    return text[start:], start, len(text)


schema_labels = [
    "status_extra_argument", "status_arguments_null", "status_arguments_array",
    "search_empty_query", "search_missing_query", "search_query_wrong_type",
    "search_top_k_zero", "search_top_k_over_max", "search_top_k_fraction",
    "search_top_k_wrong_type", "search_threshold_negative", "search_threshold_over_max",
    "search_threshold_wrong_type", "search_types_invalid_enum", "search_types_wrong_type",
    "search_unknown_argument", "search_arguments_null", "read_query_id_wrong_type",
    "read_unknown_argument",
]
schema_text = "\n".join(f"===== {label} =====\n{tool_text(label)}" for label in schema_labels)
security_text = "\n".join(
    f"===== {label} =====\n{tool_text(label)}"
    for label in ["security_absolute_shadow", "security_traversal_handle"]
)
malformed_text = "\n".join([
    "===== exact client chunks =====", *[repr(chunk) for chunk in MCP["raw_client_chunks"][:4]],
    "===== server diagnostic =====", MCP["server_stderr"].rstrip(),
    "===== initialize response after malformed + split input =====",
    pretty_response("initialize_after_malformed_and_split_stdin"),
])
representative = next(
    entry for entry in MCP["transcript"]
    if entry["label"].startswith("read_search_default_omitted_top_k")
    and entry["label"].endswith("_1_handle")
)
representative_text = next(
    item["text"] for item in representative["response"]["result"]["content"]
    if item["type"] == "text"
)
long_read = next(
    entry for entry in MCP["transcript"]
    if (entry.get("arguments") or {}).get("location", "").endswith("/comprehensive-pr-description/SKILL.md")
)
long_text = next(
    item["text"] for item in long_read["response"]["result"]["content"]
    if item["type"] == "text"
)
full_text = cli_text("read_long_full")
raw_text = cli_text("read_long_raw")
full_start, full_end = excerpt(full_text, "start"), excerpt(full_text, "end")
raw_start, raw_end = excerpt(raw_text, "start"), excerpt(raw_text, "end")
mcp_long_start, mcp_long_end = excerpt(long_text, "start"), excerpt(long_text, "end")
empty_token = args.nonce.replace("-", "_")

frames = [
    ("01-root-help.png", "help", "$ memex-grok --help", cli_text("registered_help_long"), {}),
    ("02-doctor-registered.png", "doctor — registered", "$ memex-grok doctor", cli_text("registered_doctor_human"), {}),
    ("03-doctor-wrong-cwd.png", "doctor — wrong cwd", "$ memex-grok doctor --json", cli_text("wrong_cwd_doctor_json"), {}),
    ("04-doctor-ordering.png", "doctor — freshness ordering", "$ memex-grok doctor --json", cli_text("older_source_newer_deployed_doctor_json"), {}),
    ("05-selfcheck.png", "selfcheck", "$ memex-grok selfcheck", cli_text("registered_selfcheck_human"), {}),
    ("06-sync.png", "sync — dry run", "$ memex-grok sync --dry-run", cli_text("sync_dry_run_human"), {}),
    ("07-status-mcp.png", "MCP status", "tools/call memex_status", tool_text("status_populated"), {}),
    ("08-search-help.png", "search help", "$ memex-grok search --help", cli_text("search_help_long"), {}),
    ("09-search-populated.png", "search — populated", "$ memex-grok search 'standard development flow'", cli_text("search_populated"), {}),
    ("10-search-empty.png", "search — empty", f"$ memex-grok search zzqv_no_hit_{empty_token}", cli_text("search_empty"), {}),
    ("11-search-invalid.png", "search — invalid argument", "$ memex-grok search --type bogus x", cli_text("search_schema_error"), {}),
    ("12-search-raw.png", "search — raw", "$ memex-grok search --raw --top-k 3 'standard development flow'", cli_text("search_raw"), {}),
    ("13-read-help.png", "read help", "$ memex-grok read --help", cli_text("read_help_long"), {}),
    ("14-read-page-1.png", "read — page 1", "$ memex-grok read comprehensive-pr-description --page-size 300", cli_text("read_long_page_1"), {}),
    ("15-read-page-2.png", "read — page 2", "$ memex-grok read comprehensive-pr-description --page 2 --page-size 300", cli_text("read_long_page_2"), {}),
    ("16-read-full-start.png", "read — full (start)", "$ memex-grok read comprehensive-pr-description --full", full_start[0], {"source_station": "read_long_full", "segment_start": full_start[1], "segment_end": full_start[2], "source_length": len(full_text)}),
    ("17-read-full-end.png", "read — full (end)", "$ memex-grok read comprehensive-pr-description --full", full_end[0], {"source_station": "read_long_full", "segment_start": full_end[1], "segment_end": full_end[2], "source_length": len(full_text)}),
    ("18-read-raw-start.png", "read — raw (start)", "$ memex-grok read comprehensive-pr-description --raw", raw_start[0], {"source_station": "read_long_raw", "segment_start": raw_start[1], "segment_end": raw_start[2], "source_length": len(raw_text)}),
    ("19-read-raw-end.png", "read — raw (end)", "$ memex-grok read comprehensive-pr-description --raw", raw_end[0], {"source_station": "read_long_raw", "segment_start": raw_end[1], "segment_end": raw_end[2], "source_length": len(raw_text)}),
    ("20-read-security.png", "read — security reject", "$ memex-grok read /etc/shadow", cli_text("read_security_absolute"), {}),
    ("21-read-empty.png", "read — empty/error", "$ memex-grok read missing-entry", cli_text("read_unknown_name"), {}),
    ("22-mcp-tools-list.png", "MCP tools/list", "JSON-RPC tools/list", pretty_response("tools_list"), {}),
    ("23-mcp-search.png", "MCP search", "tools/call memex_search", tool_text("search_standard_flow"), {}),
    ("24-mcp-read.png", "MCP read drill-in", "tools/call memex_read_skill", representative_text, {}),
    ("25-mcp-schema-rejects.png", "MCP schema rejects", "tools/call invalid inputs", schema_text, {"schema_reject_count": len(schema_labels)}),
    ("26-mcp-malformed-survival.png", "MCP malformed stdin survival", "raw JSON-RPC transcript", malformed_text, {}),
    ("27-mcp-security.png", "MCP security rejects", "tools/call memex_read_skill", security_text, {}),
    ("28-mcp-long-start.png", "MCP long content (start)", "tools/call memex_read_skill", mcp_long_start[0], {"source_station": long_read["label"], "segment_start": mcp_long_start[1], "segment_end": mcp_long_start[2], "source_length": len(long_text)}),
    ("29-mcp-long-end.png", "MCP long content (end)", "tools/call memex_read_skill", mcp_long_end[0], {"source_station": long_read["label"], "segment_start": mcp_long_end[1], "segment_end": mcp_long_end[2], "source_length": len(long_text)}),
    ("30-mcp-omitted-top-k.png", "MCP omitted top_k → 5", "tools/call memex_search (top_k omitted)", tool_text("search_default_omitted_top_k"), {"result_count": len(next(item for item in MCP["populated_searches"] if item["label"] == "search_default_omitted_top_k")["results"])}),
]

html = """<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:#10151d;color:#e6edf3;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.frame{width:1180px;margin:28px auto;background:#0d1117;border:1px solid #30363d;border-radius:12px;overflow:hidden;box-shadow:0 12px 40px #0008}
.bar{padding:14px 18px;background:#161b22;border-bottom:1px solid #30363d}.row{position:relative}.marker{position:absolute;left:0;top:7px;width:3px;height:3px}
.title,.cmd{margin-left:9px}.title-marker{background:rgb(255,0,255)}.secondary-marker{background:rgb(0,255,255)}
.title{font:600 15px system-ui,sans-serif;color:#f0f6fc}.secondary-row{margin-top:7px}.cmd{font-size:13px;color:#8b949e;white-space:pre-wrap}
pre{margin:0;padding:22px;font-size:14px;line-height:1.46;white-space:pre-wrap;overflow-wrap:anywhere;tab-size:2}
</style><div class="frame"><div class="bar"><div class="row"><span id="title-marker" class="marker title-marker"></span><div class="title" id="title"></div></div>
<div class="row secondary-row"><span id="secondary-marker" class="marker secondary-marker"></span><div class="cmd" id="cmd"></div></div></div><pre id="product"></pre></div>"""

manifest_frames, clipping_frames = [], []
with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 900}, device_scale_factor=1)
    for png, title, channel, text, metadata in frames:
        source_name = png.replace(".png", ".txt")
        source_path = SOURCES / source_name
        source_path.write_text(text)
        page.set_content(html)
        page.locator("#title").evaluate("(el, value) => el.textContent = value", title)
        page.locator("#cmd").evaluate("(el, value) => el.textContent = value", channel)
        page.locator("#product").evaluate("(el, value) => el.textContent = value", text)
        title_box = page.locator("#title-marker").bounding_box()
        secondary_box = page.locator("#secondary-marker").bounding_box()
        probes = [
            {"kind": "title-prefix", "x": round(title_box["x"]), "y": round(title_box["y"]), "size": 3, "rgb": [255, 0, 255]},
            {"kind": "secondary-prefix", "x": round(secondary_box["x"]), "y": round(secondary_box["y"]), "size": 3, "rgb": [0, 255, 255]},
        ]
        target = OUT / png
        page.screenshot(path=str(target), full_page=True)
        dom_text = page.locator("#product").text_content()
        geometry = page.evaluate("""() => ({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,scrollHeight:document.documentElement.scrollHeight,frameRight:document.querySelector('.frame').getBoundingClientRect().right})""")
        entry = {
            "png": png, "title": title, "command_or_channel": channel,
            "render_source": f"render-sources/{source_name}", "source_text_length": len(text),
            "source_text_sha256": hashlib.sha256(text.encode()).hexdigest(),
            "png_sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
            "exact_dom_text": dom_text == text,
            "no_horizontal_clipping": geometry["scrollWidth"] <= geometry["clientWidth"] and geometry["frameRight"] <= geometry["clientWidth"],
            "full_page_height": geometry["scrollHeight"], "probes": probes, **metadata,
        }
        manifest_frames.append(entry)
        clipping_frames.append({"png": png, "probes": probes})
    browser.close()

capture_manifest = {
    "walk_nonce": args.nonce,
    "installed_build": CLI["release_truth"]["installed_version"]["stdout"].strip(),
    "harness_commit": CLI["release_truth"]["harness_source_head"]["stdout"].strip(),
    "renderer": "Playwright cached Chromium",
    "capture_chrome": "neutral title/command frame with opaque pixel sentinels",
    "invented_product_ui": False, "frame_count": len(manifest_frames),
    "all_exact_text": all(frame["exact_dom_text"] for frame in manifest_frames),
    "all_no_horizontal_clipping": all(frame["no_horizontal_clipping"] for frame in manifest_frames),
    "frames": manifest_frames,
}
(OUT / "capture-manifest.json").write_text(json.dumps(capture_manifest, indent=2) + "\n")
(OUT / "capture-clipping-manifest.json").write_text(json.dumps({"frames": clipping_frames}, indent=2) + "\n")
print(json.dumps({"frames": len(manifest_frames), "all_exact_text": capture_manifest["all_exact_text"], "all_no_horizontal_clipping": capture_manifest["all_no_horizontal_clipping"]}))
