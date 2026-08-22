export interface Poolable {
  reset(): void;
}

export class ObjectPool<T extends Poolable> {
  private pool: T[] = [];
  private factory: () => T;
  private maxCapacity: number;

  constructor(factory: () => T, initialCapacity: number = 100, maxCapacity: number = 1000) {
    this.factory = factory;
    this.maxCapacity = maxCapacity;

    for (let i = 0; i < initialCapacity; i++) {
      this.pool.push(this.factory());
    }
  }

  public acquire(): T {
    if (this.pool.length > 0) {
      const item = this.pool.pop()!;
      item.reset();
      return item;
    }
    const item = this.factory();
    item.reset();
    return item;
  }

  public release(item: T): void {
    if (this.pool.length < this.maxCapacity) {
      item.reset();
      this.pool.push(item);
    }
  }

  public releaseAll(items: T[]): void {
    for (const item of items) {
      this.release(item);
    }
  }

  public size(): number {
    return this.pool.length;
  }
}
