/**
 * ModelQueue — serialises LLM calls per model key.
 *
 * Jobs for the same model run sequentially (one at a time).
 * Jobs for different models run freely in parallel.
 *
 * Usage:
 *   const { promise, queued } = queue.enqueue('ollama/qwen2.5:32b', async () => { ... });
 *   const result = await promise;
 */
export class ModelQueue {
  constructor() {
    this._chain = new Map(); // modelKey → tail of the promise chain
    this._count = new Map(); // modelKey → number of active/pending jobs
  }

  /** Returns true if at least one job is active or pending for this model key */
  isBusy(modelKey) {
    return (this._count.get(modelKey) ?? 0) > 0;
  }

  /**
   * Enqueue a job for the given model key.
   *
   * @param {string}            modelKey  e.g. "ollama/qwen2.5:32b"
   * @param {() => Promise<T>}  fn        The async work to run when the model is free
   * @returns {{ promise: Promise<T>, queued: boolean }}
   *   queued = true  → job had to wait for a predecessor
   *   queued = false → job started immediately
   */
  enqueue(modelKey, fn) {
    const queued = this.isBusy(modelKey);
    this._count.set(modelKey, (this._count.get(modelKey) ?? 0) + 1);

    const tail = this._chain.get(modelKey) ?? Promise.resolve();

    // Chain this job after the current tail
    const job = tail.then(() => fn()).finally(() => {
      this._count.set(modelKey, Math.max(0, (this._count.get(modelKey) ?? 1) - 1));
    });

    // Store a non-rejecting version as the new tail so one failure doesn't
    // break the chain for subsequent jobs
    this._chain.set(modelKey, job.catch(() => {}));

    return { promise: job, queued };
  }
}
