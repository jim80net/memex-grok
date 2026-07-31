import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface BindReviewInput {
  out: string;
  nonce: string;
  reviewer: string;
  dispatchNonce: string;
  dispatchAck: string;
}

export function bindReviewAuthority(input: BindReviewInput): void {
  if (input.dispatchNonce !== input.dispatchAck) {
    throw new Error("dispatch acknowledgement does not match its nonce");
  }
  const provenancePath = join(input.out, "walk-provenance.json");
  const verdictPath = join(input.out, "seeing-verdict.md");
  const provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
  const verdict = readFileSync(verdictPath, "utf8");
  const verdictHash = createHash("sha256").update(verdict).digest("hex");
  if (provenance.walk_nonce !== input.nonce || provenance.review_authority.seeing_nonce !== `${input.nonce}-seeing`) {
    throw new Error("walk/seeing nonce conflict");
  }
  if (provenance.harness.capture_owner === input.reviewer) {
    throw new Error("capture owner cannot bind independent seeing authority");
  }
  const authorityFiles = readdirSync(input.out).filter((name) => /^seeing-verdict.*\.md$/.test(name));
  if (authorityFiles.length !== 1 || authorityFiles[0] !== "seeing-verdict.md") {
    throw new Error(`expected one canonical seeing authority file, found: ${authorityFiles.join(", ")}`);
  }
  const reviewers = [...verdict.matchAll(/^\s*(?:\|\s*)?(?:\*\*)?Reviewer(?:\*\*)?\s*(?:\||:)\s*`?([A-Za-z0-9_-]+)`?(?:\s*\|)?\s*$/gim)].map((match) => match[1]);
  if (reviewers.length !== 1 || reviewers[0] !== input.reviewer) {
    throw new Error(`seeing verdict must name sole reviewer '${input.reviewer}' exactly once`);
  }
  const authority = provenance.review_authority;
  if (!["pending", "bound"].includes(authority.state)) {
    throw new Error(`seeing authority is '${authority.state}', not bindable`);
  }
  if (authority.state === "bound") {
    if (authority.reviewer !== input.reviewer) {
      throw new Error(`seeing authority already bound to '${authority.reviewer}'`);
    }
    if (
      authority.verdict_sha256 !== verdictHash ||
      authority.dispatch_nonce !== input.dispatchNonce ||
      authority.dispatch_ack !== input.dispatchAck
    ) {
      throw new Error("bound seeing authority is immutable");
    }
    return;
  }
  if (authority.superseded?.length) {
    throw new Error("refusing to bind a provenance record with unresolved supersession state");
  }
  provenance.review_authority = {
    ...authority,
    state: "bound",
    reviewer: input.reviewer,
    dispatch_nonce: input.dispatchNonce,
    dispatch_ack: input.dispatchAck,
    verdict_sha256: verdictHash,
  };
  writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
}
