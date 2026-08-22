type EventCallback<T = any> = (data: T) => void;

export class EventBus {
  private static instance: EventBus;
  private listeners: Map<string, Set<EventCallback>> = new Map();

  private constructor() {}

  public static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  public on<T = any>(event: string, callback: EventCallback<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    // Return unbind function
    return () => {
      this.off(event, callback);
    };
  }

  public off(event: string, callback: EventCallback): void {
    const eventSet = this.listeners.get(event);
    if (eventSet) {
      eventSet.delete(callback);
      if (eventSet.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  public emit<T = any>(event: string, data?: T): void {
    const eventSet = this.listeners.get(event);
    if (eventSet) {
      eventSet.forEach((cb) => {
        try {
          cb(data);
        } catch (e) {
          console.error(`Error in event listener for [${event}]:`, e);
        }
      });
    }
  }

  public clearAll(): void {
    this.listeners.clear();
  }
}

export const eventBus = EventBus.getInstance();
