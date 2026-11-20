/**
 * 轻量级按 key 串行化的异步锁，防止同一用户并发执行抓水母/放生/刷新导致数据竞态。
 */
export class KeyedAsyncLock {
  private readonly chains = new Map<string, Promise<unknown>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = previous.then(() => current);
    this.chains.set(key, next);

    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.chains.get(key) === next) {
        this.chains.delete(key);
      }
    }
  }
}
