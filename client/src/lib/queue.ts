export type ConcurrencyMode = "SERIES" | "PARALLEL";

interface QueueItem<T> {
  fn: () => Promise<T>;
  priority: number;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
}

export class RequestQueue {
  private queue: QueueItem<any>[] = [];
  private activeCount = 0;
  private mode: ConcurrencyMode = "SERIES";

  // Default configurations
  private readonly CONFIG = {
    SERIES: 1,
    PARALLEL: 3,
  };

  /**
   * Get current concurrency limit based on mode
   */
  private get concurrencyLimit(): number {
    return this.CONFIG[this.mode];
  }

  /**
   * Set concurrency mode
   */
  public setMode(mode: ConcurrencyMode) {
    this.mode = mode;
    this.processNext(); // Trigger processing in case we just increased limits
  }

  public getMode(): ConcurrencyMode {
    return this.mode;
  }

  /**
   * Add a request to the queue
   * @param fn Async function to execute
   * @param priority Priority (higher number = higher priority)
   */
  public add<T>(fn: () => Promise<T>, priority: number = 1): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        fn,
        priority,
        resolve,
        reject,
      } as QueueItem<T>);

      // Sort queue by priority (descending)
      this.queue.sort((a, b) => b.priority - a.priority);

      this.processNext();
    });
  }

  private async processNext() {
    if (this.activeCount >= this.concurrencyLimit || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    this.activeCount++;

    try {
      const result = await item.fn();
      item.resolve(result);
    } catch (error) {
      item.reject(error);
    } finally {
      this.activeCount--;
      this.processNext();
    }
  }
}

// Singleton instance
export const apiQueue = new RequestQueue();
