export interface FinalizationCommitInput {
  currentCommit: string;
  capturedCommit: string;
  renderedCommit: string;
  validatedCommit: string;
}

const FULL_SHA = /^[0-9a-f]{40}$/;

export function assertFinalizationCommit(input: FinalizationCommitInput): string {
  const commits = Object.entries(input);
  const malformed = commits.filter(([, value]) => !FULL_SHA.test(value)).map(([name]) => name);
  if (malformed.length > 0) {
    throw new Error(`invalid harness commit provenance: ${malformed.join(", ")}`);
  }
  if (new Set(commits.map(([, value]) => value)).size !== 1) {
    throw new Error(
      `harness checkout changed between capture, render, validation, and finalization: ${commits.map(([name, value]) => `${name}=${value}`).join(" ")}`,
    );
  }
  return input.capturedCommit;
}
