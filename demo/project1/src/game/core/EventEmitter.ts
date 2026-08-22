/**
 * Типизированная шина событий (Observer pattern).
 * Используется для связи движка с UI, магазином, HUD и т.д.
 */
export type EventMap = Record<string, unknown>;
export type Handler<T> = (payload: T) => void;

export class EventEmitter<M extends EventMap = EventMap> {
  private map = new Map<keyof M, Set<Handler<never>>>();

  /** Подписка на событие. Возвращает функцию отписки. */
  on<K extends keyof M>(event: K, handler: Handler<M[K]>): () => void {
    let set = this.map.get(event);
    if (!set) {
      set = new Set();
      this.map.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => this.off(event, handler);
  }

  off<K extends keyof M>(event: K, handler: Handler<M[K]>): void {
    this.map.get(event)?.delete(handler as Handler<never>);
  }

  /** Подписка на одно срабатывание. */
  once<K extends keyof M>(event: K, handler: Handler<M[K]>): void {
    const off = this.on(event, (payload) => {
      off();
      handler(payload);
    });
  }

  emit<K extends keyof M>(event: K, payload?: M[K]): void {
    const set = this.map.get(event);
    if (!set || set.size === 0) return;
    // Копия: хендлеры могут отписываться во время рассылки.
    for (const handler of [...set]) {
      try {
        (handler as Handler<M[K]>)(payload as M[K]);
      } catch (err) {
        console.error(`[EventEmitter] handler error on "${String(event)}":`, err);
      }
    }
  }

  clear(): void {
    this.map.clear();
  }

  listenerCount(event: keyof M): number {
    return this.map.get(event)?.size ?? 0;
  }
}
