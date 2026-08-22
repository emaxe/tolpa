export class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private fps: number = 60;
  private frameCount: number = 0;
  private lastTime: number = performance.now();
  private drawCallsEstimate: number = 0;
  private lowFpsCount: number = 0;
  private onLowFpsCallback?: () => void;

  private constructor() {}

  public static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  public update(): void {
    this.frameCount++;
    const now = performance.now();
    const elapsed = now - this.lastTime;

    if (elapsed >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / elapsed);
      this.frameCount = 0;
      this.lastTime = now;

      if (this.fps < 25) {
        this.lowFpsCount++;
        if (this.lowFpsCount >= 3 && this.onLowFpsCallback) {
          this.onLowFpsCallback();
          this.lowFpsCount = 0;
        }
      } else {
        this.lowFpsCount = 0;
      }
    }
  }

  /** Пересинхронизирует окно измерения — вызывать при возобновлении rAF-цикла после
   *  паузы, иначе первое измерение после простоя посчитает время паузы как "0 кадров
   *  за N секунд" и покажет обманчиво низкий FPS. */
  public reset(): void {
    this.frameCount = 0;
    this.lastTime = performance.now();
  }

  public setDrawCalls(calls: number): void {
    this.drawCallsEstimate = calls;
  }

  public getFPS(): number {
    return this.fps;
  }

  public getDrawCalls(): number {
    return this.drawCallsEstimate;
  }

  public onLowPerformance(cb: () => void): void {
    this.onLowFpsCallback = cb;
  }
}

export const perfMonitor = PerformanceMonitor.getInstance();
