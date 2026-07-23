import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { LocalEmbeddingProvider } from "@jim80net/memex-core";

const tempDirs: string[] = [];
const execFileAsync = promisify(execFile);

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "memex-grok-sharp-guard-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Core 0.7.1 dependency security contract", () => {
  it("resolves one patched Sharp/tar/protobufjs production graph", async () => {
    const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
    const { stdout } = await execFileAsync(
      "pnpm",
      ["list", "sharp", "tar", "protobufjs", "--prod", "--depth", "Infinity", "--json"],
      { cwd: repoRoot },
    );
    const graph = JSON.parse(stdout) as unknown;
    const versions = new Map<string, Map<string, string>>([
      ["sharp", new Map()],
      ["tar", new Map()],
      ["protobufjs", new Map()],
    ]);

    function visit(value: unknown): void {
      if (!value || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      if (
        typeof record.from === "string" &&
        versions.has(record.from) &&
        typeof record.path === "string" &&
        typeof record.version === "string"
      ) {
        versions.get(record.from)?.set(record.path, record.version);
      }
      for (const child of Object.values(record)) visit(child);
    }

    visit(graph);
    expect([...versions.get("sharp")!.values()]).toEqual(["0.35.3"]);
    expect([...versions.get("tar")!.values()]).toEqual(["7.5.21"]);
    expect([...versions.get("protobufjs")!.values()]).toEqual(["7.6.5"]);
  });

  it("rejects the stock vulnerable Sharp graph before transformers native load", async () => {
    const root = await makeTempDir();
    const coreDir = join(root, "core");
    const transformersDir = join(root, "node_modules/@huggingface/transformers");
    const sharpDir = join(transformersDir, "node_modules/sharp");
    const sharpLibDir = join(sharpDir, "lib");
    const nativeLoadMarker = join(root, "transformers-loaded");
    const installedEmbeddings = fileURLToPath(
      new URL("../../node_modules/@jim80net/memex-core/dist/embeddings.js", import.meta.url),
    );

    await mkdir(coreDir, { recursive: true });
    await mkdir(sharpLibDir, { recursive: true });
    const coreSource = (await readFile(installedEmbeddings, "utf-8")).replace(
      /\n\/\/# sourceMappingURL=.*\n?$/,
      "\n",
    );
    await writeFile(join(coreDir, "embeddings.js"), coreSource);
    await writeFile(join(root, "package.json"), JSON.stringify({ type: "module" }));
    await writeFile(
      join(transformersDir, "package.json"),
      JSON.stringify({
        name: "@huggingface/transformers",
        version: "3.8.1",
        type: "module",
        exports: "./index.js",
      }),
    );
    await writeFile(
      join(transformersDir, "index.js"),
      `import { writeFileSync } from "node:fs";\n` +
        `writeFileSync(${JSON.stringify(nativeLoadMarker)}, "native import reached");\n` +
        `throw new Error("native transformer load must not be reached");\n`,
    );
    await writeFile(
      join(sharpDir, "package.json"),
      JSON.stringify({ name: "sharp", version: "0.34.5", main: "lib/index.js" }),
    );
    await writeFile(
      join(sharpLibDir, "index.js"),
      "throw new Error('native sharp load reached');\n",
    );

    const copied = (await import(
      `${pathToFileURL(join(coreDir, "embeddings.js")).href}?case=vulnerable`
    )) as typeof import("@jim80net/memex-core");
    const provider = new copied.LocalEmbeddingProvider("Xenova/all-MiniLM-L6-v2");

    await expect(provider.embed(["security guard probe"])).rejects.toThrow(
      /refused to load vulnerable sharp 0\.34\.5/,
    );
    await expect(readFile(nativeLoadMarker, "utf-8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.runIf(process.env.MEMEX_REAL_EMBEDDING === "1")(
    "allows the accepted runtime graph to yield a real local embedding vector",
    async () => {
      const provider = new LocalEmbeddingProvider(
        "Xenova/all-MiniLM-L6-v2",
        process.env.MEMEX_MODEL_CACHE,
      );
      const vectors = await provider.embed(["Memex local embedding acceptance"]);

      expect(vectors).toHaveLength(1);
      expect(vectors[0].length).toBeGreaterThan(100);
      expect(vectors[0].every(Number.isFinite)).toBe(true);
    },
    120_000,
  );
});
