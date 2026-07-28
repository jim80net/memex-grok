#!/usr/bin/env node
import { inspectCaptureManifest } from "../src/capture/clipping-detector.ts";

const args = process.argv.slice(2).filter((argument) => argument !== "--");
const json = args.includes("--json");
const manifestPath = args.find((arg) => arg !== "--json");

if (!manifestPath) {
  process.stderr.write(
    "usage: tsx scripts/check-capture-clipping.ts [--json] <capture-clipping-manifest.json>\n",
  );
  process.exit(2);
}

const report = inspectCaptureManifest(manifestPath);
if (json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  for (const frame of report.frames) {
    if (frame.ok) {
      process.stdout.write(`OK: ${frame.png} — capture prefixes intact\n`);
    } else {
      for (const error of frame.errors) {
        process.stderr.write(`FAIL: ${frame.png} — ${error}\n`);
      }
    }
  }
}
process.exit(report.ok ? 0 : 1);
