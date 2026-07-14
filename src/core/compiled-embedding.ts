/**
 * Local embedding provider for the bun-compiled standalone binary.
 *
 * memex-core's LocalEmbeddingProvider uses dynamic import("@huggingface/transformers")
 * with pluginDir fallbacks derived from import.meta.url. In a compiled binary that URL
 * is a virtual /$bunfs path, so all resolution paths fail even though bun traced the
 * package at build time. A static import keeps transformers in the executable graph.
 */
import type { EmbeddingProvider } from "@jim80net/memex-core";
import * as transformers from "@huggingface/transformers";

export class CompiledLocalEmbeddingProvider implements EmbeddingProvider {
  private extractorPromise: Promise<unknown> | null = null;
  private model: string;
  private cacheDir?: string;

  constructor(
    model: string = "Xenova/all-MiniLM-L6-v2",
    cacheDir?: string,
  ) {
    this.model = model;
    this.cacheDir = cacheDir;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const extractor = await this.getExtractor();
    const output = await (extractor as CallableFunction)(texts, {
      pooling: "mean",
      normalize: true,
    });

    const data = (output as { data: Float32Array; dims: number[] }).data;
    const dims = (output as { data: Float32Array; dims: number[] }).dims;
    const dim = dims[dims.length - 1];
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      results.push(Array.from(data.slice(i * dim, (i + 1) * dim)));
    }
    return results;
  }

  private async getExtractor(): Promise<unknown> {
    if (!this.extractorPromise) {
      this.extractorPromise = this.initExtractor();
    }
    return this.extractorPromise;
  }

  private async initExtractor(): Promise<unknown> {
    if (this.cacheDir) {
      transformers.env.cacheDir = this.cacheDir;
    }
    return transformers.pipeline("feature-extraction", this.model, {
      dtype: "q8",
    });
  }
}
