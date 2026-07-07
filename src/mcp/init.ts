/**
 * Run an async initialization exactly once across concurrent callers.
 * If the work fails, the next caller retries.
 */
export class OnceInit<T> {
  private pending: Promise<T> | null = null;
  private done = false;
  private value: T | undefined;

  constructor(private work: () => Promise<T>) {}

  async ensure(): Promise<T> {
    if (this.done) return this.value as T;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      try {
        const v = await this.work();
        this.value = v;
        this.done = true;
        return v;
      } finally {
        if (!this.done) this.pending = null;
      }
    })();
    return this.pending;
  }
}
