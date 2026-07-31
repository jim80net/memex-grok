import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CANONICAL_RECEIPT_REGISTRY = "/home/jim/workspace/github.com/General-ML/a1-fleet-ops/state/flotilla-dispatch-consumed.json";

interface DispatchReceipt {
  nonce: string;
  payload_hash: string;
  consumed_at: string;
  reason: string;
  sender: string;
  recipient: string;
}

export interface BindReviewInput {
  out: string;
  nonce: string;
  claimedReviewer: string;
  dispatchNonce: string;
}

export function bindReviewAuthority(input: BindReviewInput): void {
  bindReviewAuthorityUsingRegistry(input, CANONICAL_RECEIPT_REGISTRY);
}

/** Dependency seam for isolated tests; the shipped command never exposes a registry selector. */
export function bindReviewAuthorityUsingRegistry(input: BindReviewInput, receiptRegistry: string): void {
  const provenancePath = join(input.out, "walk-provenance.json");
  const verdictPath = join(input.out, "seeing-verdict.md");
  const provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
  const receipt = loadDurableReceipt(receiptRegistry, input.dispatchNonce);
  const reviewer = receipt.recipient;
  if (input.claimedReviewer !== reviewer) {
    throw new Error(`FLOTILLA_SELF '${input.claimedReviewer}' does not match durable receipt recipient '${reviewer}'`);
  }
  if (receipt.sender !== provenance.review_authority.dispatcher) {
    throw new Error(`durable review dispatch sender '${receipt.sender}' is not authorized dispatcher '${provenance.review_authority.dispatcher}'`);
  }
  const capturedAt = Date.parse(provenance.harness.captured_at);
  const consumedAt = Date.parse(receipt.consumed_at);
  if (!Number.isFinite(capturedAt) || !Number.isFinite(consumedAt) || consumedAt < capturedAt) {
    throw new Error("durable review receipt predates the captured evidence");
  }

  const verdict = readFileSync(verdictPath, "utf8");
  const verdictHash = createHash("sha256").update(verdict).digest("hex");
  if (provenance.walk_nonce !== input.nonce || provenance.review_authority.seeing_nonce !== `${input.nonce}-seeing`) {
    throw new Error("walk/seeing nonce conflict");
  }
  if (provenance.harness.capture_owner === reviewer) {
    throw new Error("capture owner cannot bind independent seeing authority");
  }
  const authorityFiles = readdirSync(input.out).filter((name) => /^seeing-verdict.*\.md$/.test(name));
  if (authorityFiles.length !== 1 || authorityFiles[0] !== "seeing-verdict.md") {
    throw new Error(`expected one canonical seeing authority file, found: ${authorityFiles.join(", ")}`);
  }
  const reviewers = [...verdict.matchAll(/^\s*(?:\|\s*)?(?:\*\*)?Reviewer(?:\*\*)?\s*(?:\||:)\s*`?([A-Za-z0-9_-]+)`?(?:\s*\|)?\s*$/gim)].map((match) => match[1]);
  if (reviewers.length !== 1 || reviewers[0] !== reviewer) {
    throw new Error(`seeing verdict must name sole durable reviewer '${reviewer}' exactly once`);
  }
  const authority = provenance.review_authority;
  if (!["pending", "bound"].includes(authority.state)) {
    throw new Error(`seeing authority is '${authority.state}', not bindable`);
  }
  if (authority.state === "bound") {
    if (authority.reviewer !== reviewer) throw new Error(`seeing authority already bound to '${authority.reviewer}'`);
    if (authority.verdict_sha256 !== verdictHash || authority.dispatch_nonce !== input.dispatchNonce || JSON.stringify(authority.dispatch_receipt) !== JSON.stringify(receipt)) {
      throw new Error("bound seeing authority is immutable");
    }
    return;
  }
  if (authority.superseded?.length) throw new Error("refusing to bind a provenance record with unresolved supersession state");
  provenance.review_authority = {
    ...authority,
    state: "bound",
    reviewer,
    dispatch_nonce: input.dispatchNonce,
    dispatch_receipt: receipt,
    verdict_sha256: verdictHash,
  };
  writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
}

function loadDurableReceipt(path: string, nonce: string): DispatchReceipt {
  const registry = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(registry.entries)) throw new Error("invalid flotilla consumed-dispatch registry");
  const receipts = registry.entries.filter((entry: DispatchReceipt) => entry?.nonce === nonce && entry.reason === "durable-ack");
  if (receipts.length !== 1) throw new Error(`expected one durable-ack receipt for '${nonce}', found ${receipts.length}`);
  const receipt = receipts[0] as DispatchReceipt;
  if (!/^[0-9a-f]{32}$/.test(receipt.payload_hash) || !receipt.sender || !receipt.recipient) {
    throw new Error("durable review receipt is incomplete");
  }
  return receipt;
}
