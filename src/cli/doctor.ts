/**
 * Stub — real implementation lands in Task 21 (binary check + JSON output schema)
 * and Task 22 (MCP registration check). This stub exists so `src/main.ts`'s
 * `await import("./cli/doctor.ts")` typechecks before Task 21 ships.
 */
export async function runDoctor(_args: string[]): Promise<number> {
  process.stderr.write("memex doctor: not yet implemented (Task 21)\n");
  return 1;
}
