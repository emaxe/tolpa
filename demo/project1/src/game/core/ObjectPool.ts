/**
 * Обобщённый пул объектов (Object Pool pattern).
 * Используется для мобов, препятствий, ворот, монет, частиц —
 * минимизирует аллокации в игровом цикле и при перезапуске уровней.
 */
export class ObjectPool<T> {
  private free: T[] = [];
  private activeSet = new Set<T>();

  constructor(
    private factory: () => T,
    private reset?: (obj: T) => void,
    initial = 0,
  ) {
    for (let i = 0; i < initial; i++) this.free.push(factory());
  }

  /** Взять объект из пула (или создать, если пул пуст). */
  acquire(): T {
    const obj = this.free.pop() ?? this.factory();
    this.activeSet.add(obj);
    return obj;
  }

  /** Вернуть объект в пул. */
  release(obj: T): void {
    if (!this.activeSet.has(obj)) return;
    this.activeSet.delete(obj);
    this.reset?.(obj);
    this.free.push(obj);
  }

  /** Вернуть все активные объекты. */
  releaseAll(): void {
    for (const obj of [...this.activeSet]) this.release(obj);
  }

  get active(): ReadonlySet<T> {
    return this.activeSet;
  }

  get freeCount(): number {
    return this.free.length;
  }

  get activeCount(): number {
    return this.activeSet.size;
  }

  dispose(): void {
    this.free.length = 0;
    this.activeSet.clear();
  }
}
