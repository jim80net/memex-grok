#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateWalkPackage } from "../../src/walk/package-validator.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig(process.argv.slice(2), { allowPopulatedOut: true });
const report = validateWalkPackage(config.out, config.source, config.nonce);
writeFileSync(join(config.out, "03-acceptance-assertions.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ passed: report.passed, passed_count: report.passed_count, check_count: report.check_count, failed: report.checks.filter((check) => !check.passed).map((check) => check.name) }, null, 2)}\n`);
if (!report.passed) process.exit(1);
