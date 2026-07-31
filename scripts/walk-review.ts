#!/usr/bin/env node
import { isAbsolute, resolve } from "node:path";
import { bindReviewAuthority } from "../src/walk/reviewer-provenance.ts";

const values = new Map<string, string>();
const args = process.argv.slice(2).filter((argument) => argument !== "--");
for (let index = 0; index < args.length; index += 2) {
  const flag = args[index];
  const value = args[index + 1];
  if (!flag?.startsWith("--") || !value || value.startsWith("--")) throw new Error("usage: pnpm walk:review --nonce NONCE --out /absolute/path --attestation /absolute/path");
  if (values.has(flag)) throw new Error(`duplicate argument '${flag}'`);
  values.set(flag, value);
}
const allowed = new Set(["--nonce", "--out", "--attestation"]);
for (const flag of values.keys()) if (!allowed.has(flag)) throw new Error(`unknown argument '${flag}'`);
const nonce = values.get("--nonce");
const outArg = values.get("--out");
const attestationArg = values.get("--attestation");
const reviewer = process.env.FLOTILLA_SELF?.trim();
if (!nonce || !outArg || !isAbsolute(outArg) || !attestationArg || !isAbsolute(attestationArg) || !reviewer) throw new Error("nonce, absolute out, absolute attestation, and FLOTILLA_SELF are required");
const out = resolve(outArg);
bindReviewAuthority({ out, nonce, claimedReviewer: reviewer, attestationPath: resolve(attestationArg) });
process.stdout.write(`bound ${nonce}-seeing to durable reviewer ${reviewer}\n`);
