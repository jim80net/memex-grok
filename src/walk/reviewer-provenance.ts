import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const REVIEW_KEY_ID = "walk-review-ed25519-v1";
const REVIEW_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAnlmg7l75ktdmZtAFwPvxBaO0yjh4QNIs19ikaajJWfk=
-----END PUBLIC KEY-----`;

interface ReviewStatement {
  scope: string;
  walk_nonce: string;
  seeing_nonce: string;
  dispatch_nonce: string;
  payload_hash: string;
  consumed_at: string;
  reason: string;
  issuer_role: string;
  reviewer: string;
  issued_at: string;
}

interface SignedReviewAttestation {
  schema_version: number;
  key_id: string;
  statement: ReviewStatement;
  signature: string;
}

export interface BindReviewInput {
  out: string;
  nonce: string;
  claimedReviewer: string;
  attestationPath: string;
}

export const bindReviewAuthority = createReviewAuthorityBinder(REVIEW_PUBLIC_KEY);

/** Public-key dependency seam for isolated tests; production callers cannot replace the embedded key. */
export function createReviewAuthorityBinder(publicKeyPem: string): (input: BindReviewInput) => void {
  const publicKey = createPublicKey(publicKeyPem);
  return (input) => {
    const provenancePath = join(input.out, "walk-provenance.json");
    const verdictPath = join(input.out, "seeing-verdict.md");
    const provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
    const attestation = loadSignedAttestation(input.attestationPath, publicKey);
    const statement = attestation.statement;
    const reviewer = statement.reviewer;

    if (input.claimedReviewer !== reviewer) {
      throw new Error(`FLOTILLA_SELF '${input.claimedReviewer}' does not match signed reviewer '${reviewer}'`);
    }
    if (
      statement.scope !== "installed-walk-review" ||
      statement.walk_nonce !== input.nonce ||
      statement.seeing_nonce !== `${input.nonce}-seeing` ||
      statement.reason !== "durable-ack" ||
      statement.issuer_role !== "review-coordinator" ||
      !/^flotilla-dispatch-[0-9a-f]{8}$/.test(statement.dispatch_nonce) ||
      !/^[0-9a-f]{32}$/.test(statement.payload_hash)
    ) {
      throw new Error("signed review attestation has invalid scope or receipt fields");
    }
    const capturedAt = Date.parse(provenance.harness.captured_at);
    const consumedAt = Date.parse(statement.consumed_at);
    const issuedAt = Date.parse(statement.issued_at);
    if (!Number.isFinite(capturedAt) || !Number.isFinite(consumedAt) || !Number.isFinite(issuedAt) || consumedAt < capturedAt || issuedAt < consumedAt) {
      throw new Error("signed review attestation predates captured evidence or durable receipt");
    }

    const verdict = readFileSync(verdictPath, "utf8");
    const verdictHash = createHash("sha256").update(verdict).digest("hex");
    if (provenance.walk_nonce !== input.nonce || provenance.review_authority.seeing_nonce !== `${input.nonce}-seeing`) {
      throw new Error("walk/seeing nonce conflict");
    }
    if (provenance.harness.capture_owner === reviewer) throw new Error("capture owner cannot bind independent seeing authority");
    const authorityFiles = readdirSync(input.out).filter((name) => /^seeing-verdict.*\.md$/.test(name));
    if (authorityFiles.length !== 1 || authorityFiles[0] !== "seeing-verdict.md") {
      throw new Error(`expected one canonical seeing authority file, found: ${authorityFiles.join(", ")}`);
    }
    const reviewers = [...verdict.matchAll(/^\s*(?:\|\s*)?(?:\*\*)?Reviewer(?:\*\*)?\s*(?:\||:)\s*`?([A-Za-z0-9_-]+)`?(?:\s*\|)?\s*$/gim)].map((match) => match[1]);
    if (reviewers.length !== 1 || reviewers[0] !== reviewer) {
      throw new Error(`seeing verdict must name sole signed reviewer '${reviewer}' exactly once`);
    }
    const authority = provenance.review_authority;
    if (!["pending", "bound"].includes(authority.state)) throw new Error(`seeing authority is '${authority.state}', not bindable`);
    if (authority.attestation_key_id !== attestation.key_id) throw new Error("attestation key does not match captured review authority");
    const attestationHash = createHash("sha256").update(JSON.stringify(attestation)).digest("hex");
    if (authority.state === "bound") {
      if (authority.reviewer !== reviewer) throw new Error(`seeing authority already bound to '${authority.reviewer}'`);
      if (authority.verdict_sha256 !== verdictHash || authority.attestation_sha256 !== attestationHash) {
        throw new Error("bound seeing authority is immutable");
      }
      return;
    }
    if (authority.superseded?.length) throw new Error("refusing to bind a provenance record with unresolved supersession state");
    provenance.review_authority = {
      ...authority,
      state: "bound",
      reviewer,
      key_id: attestation.key_id,
      dispatch_nonce: statement.dispatch_nonce,
      attestation_sha256: attestationHash,
      signed_attestation: attestation,
      verdict_sha256: verdictHash,
    };
    writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
  };
}

function loadSignedAttestation(path: string, publicKey: ReturnType<typeof createPublicKey>): SignedReviewAttestation {
  const attestation = JSON.parse(readFileSync(path, "utf8")) as SignedReviewAttestation;
  if (
    !hasExactKeys(attestation, ["key_id", "schema_version", "signature", "statement"]) ||
    attestation.schema_version !== 1 ||
    attestation.key_id !== REVIEW_KEY_ID ||
    !hasExactKeys(attestation.statement, [
      "consumed_at", "dispatch_nonce", "issued_at", "issuer_role", "payload_hash",
      "reason", "reviewer", "scope", "seeing_nonce", "walk_nonce",
    ]) ||
    !Object.values(attestation.statement).every((value) => typeof value === "string") ||
    typeof attestation.signature !== "string"
  ) {
    throw new Error("invalid signed review attestation envelope");
  }
  const signature = Buffer.from(attestation.signature, "base64");
  if (signature.length !== 64 || !verify(null, Buffer.from(JSON.stringify(attestation.statement)), publicKey, signature)) {
    throw new Error("review attestation signature verification failed");
  }
  return attestation;
}

function hasExactKeys(value: unknown, expected: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}
