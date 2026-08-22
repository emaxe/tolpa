/**
 * InputManager: клавиатура (десктоп), сенсор (мобильные), мышь.
 * Эмитит steer в [-1, 1] и действия. Без аллокаций в горячем пути.
 */
export type GameAction = "adrenaline" | "pause" | "formation" | "confirm";

export interface InputCallbacks {
  onSteer(steer: number): void;
  onAction(action: GameAction): void;
}

const clamp = (v: number) => Math.max(-1, Math.min(1, v));

export class InputManager {
  private keys = new Set<string>();
  private pointerSteer = 0;
  private touching = false;
  private touchStartY = 0;
  private touchStartT = 0;
  private swipeDone = false;
  private cb: InputCallbacks;
  private el: HTMLElement;

  constructor(el: HTMLElement, cb: InputCallbacks) {
    this.el = el;
    this.cb = cb;
  }

  attach(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.el.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
    window.addEventListener("blur", this.onBlur);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.el.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    window.removeEventListener("blur", this.onBlur);
  }

  /** Итоговый steer: клавиши + указатель, без аллокаций. */
  getSteer(): number {
    let s = 0;
    if (this.keys.has("ArrowLeft") || this.keys.has("KeyA")) s -= 1;
    if (this.keys.has("ArrowRight") || this.keys.has("KeyD")) s += 1;
    s += this.pointerSteer;
    return clamp(s);
  }

  private onBlur = (): void => {
    this.keys.clear();
    this.pointerSteer = 0;
    this.touching = false;
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(e.code)) {
      e.preventDefault();
    }
    this.keys.add(e.code);
    if (e.repeat) return;
    switch (e.code) {
      case "Space":
        this.cb.onAction("adrenaline");
        break;
      case "KeyF":
        this.cb.onAction("formation");
        break;
      case "Escape":
      case "KeyP":
        this.cb.onAction("pause");
        break;
      case "Enter":
        this.cb.onAction("confirm");
        break;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.touching = true;
    this.swipeDone = false;
    this.touchStartY = e.clientY;
    this.touchStartT = performance.now();
    const rect = this.el.getBoundingClientRect();
    this.pointerSteer = clamp(((e.clientX - rect.left) / rect.width) * 2 - 1);
    this.cb.onSteer(this.pointerSteer);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.touching) return;
    const rect = this.el.getBoundingClientRect();
    this.pointerSteer = clamp(((e.clientX - rect.left) / rect.width) * 2 - 1);
    this.cb.onSteer(this.pointerSteer);
    // Свайп вверх → адреналин
    const dy = this.touchStartY - e.clientY;
    const dt = performance.now() - this.touchStartT;
    if (!this.swipeDone && dy > 48 && dt < 420) {
      this.swipeDone = true;
      this.cb.onAction("adrenaline");
    }
  };

  private onPointerUp = (): void => {
    this.touching = false;
    this.pointerSteer = 0;
    this.cb.onSteer(0);
  };
}
