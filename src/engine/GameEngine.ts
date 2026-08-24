import * as THREE from 'three';
import { BiomeType, FormationType, LevelConfig, LevelDynamicEvent, CoinData } from '../types/game';
import { CrowdManager } from './CrowdManager';
import { GateManager } from './GateManager';
import { BonusManager } from './BonusManager';
import { ObstacleManager } from './ObstacleManager';
import { WallManager } from './WallManager';
import { BossManager } from './BossManager';
import { FinishLineManager } from './FinishLineManager';
import { ParticleSystem } from './ParticleSystem';
import { LevelGenerator, DEFAULT_TRACK_WIDTH } from './LevelGenerator';
import { stateManager, RunStats } from '../core/StateManager';
import { soundEngine } from '../audio/SoundEngine';
import { MusicTheme } from '../types/audio';
import { eventBus } from '../core/EventBus';
import { perfMonitor } from '../core/Performance';
import { clamp, getNearMissMultiplier } from '../utils/math';
import { createSpectatorGeometry } from '../utils/proceduralMeshes';

export interface HudSnapshot {
  crowd: number;
  coins: number; // Собранные за текущий забег монеты (трасса + боссы), сырое значение
  isHyper: boolean;
  adrenalineCharge: number; // 0..100
  progress: number; // 0..1 дистанции до финиша
  metersLeft: number;
  bossProgress: number; // 0..1, -1 если на уровне нет босса
  bossDistance: number; // метров до арены босса, -1 если на уровне нет босса
  nextHazardDistance: number; // метров до ближайшего живого препятствия впереди, -1 если нет
  distanceTraveled: number; // метров, пройденных с начала забега (Бесконечный режим)
  fps: number;
  drawCalls: number;
  // Индикатор финишной фазы: текущий множитель, прогресс по стенам, активность финиша.
  finishMultiplier: number;
  finishStepsDone: number;
  finishStepsTotal: number;
  isFinishActive: boolean;
  // Серия уворотов в упор (Near-Miss Streak) — текущая длина и множитель награды.
  nearMissStreak: number;
  nearMissMultiplier: number;
}

export interface GameEngineCallbacks {
  onPauseRequest?: () => void;
}

export class GameEngine {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private reqId: number | null = null;
  private lastTime: number = 0;

  // Sub-systems
  public crowd: CrowdManager;
  public gates: GateManager;
  public walls: WallManager;
  public bonus: BonusManager;
  public obstacles: ObstacleManager;
  public boss: BossManager;
  public finishLine: FinishLineManager;
  public particles: ParticleSystem;

  // Environment & Track
  private dirLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private trackMesh: THREE.Mesh | null = null;
  private leftBorder: THREE.Mesh | null = null;
  private rightBorder: THREE.Mesh | null = null;
  private decorGroup: THREE.Group | null = null;

  // ==== Трибуны и зрители ====
  // Зрители — InstancedMesh (тела + 2 машущие руки + головы + лайтстики), 1 draw call каждый.
  // frustumCulled=false, иначе меш пропадает после ~60м из-за кэшируемого boundingSphere.
  private spectatorMesh: THREE.InstancedMesh | null = null;
  private spectatorArmMesh: THREE.InstancedMesh | null = null;
  private spectatorArm2Mesh: THREE.InstancedMesh | null = null;
  private spectatorHeadMesh: THREE.InstancedMesh | null = null;
  private spectatorGlowMesh: THREE.InstancedMesh | null = null;
  private spectatorCount: number = 0;
  // Флаг видимости зрителя (1 = активен/в окне обзора, 0 = скрыт scale=0). 0-GC.
  private spectatorVisibility: Uint8Array = new Uint8Array(0);
  // Per-instance данные зрителей (per stride 12): baseX, baseY, baseZ, phase, freq, amp,
  // armPhase, armFreq, side, baseRotZ, armBaseX, armBaseY. Предаллоцированы — 0-GC.
  private spectatorData: Float32Array = new Float32Array(0);
  private spectatorDummy: THREE.Object3D = new THREE.Object3D();
  private spectatorArmDummy: THREE.Object3D = new THREE.Object3D();
  private spectatorArm2Dummy: THREE.Object3D = new THREE.Object3D();
  private spectatorHeadDummy: THREE.Object3D = new THREE.Object3D();
  private spectatorGlowDummy: THREE.Object3D = new THREE.Object3D();
  private spectatorColorDummy: THREE.Color = new THREE.Color();

  // ==== Спецэффекты декора ====
  // Объёмные световые лучи (additive конусы) — покачиваются в update.
  private beamMeshes: THREE.Mesh[] = [];
  private beamDummy: THREE.Object3D = new THREE.Object3D();
  // Флаги (покачивание sin) и дроны (дрейф по X) за дальним краем.
  private flagMeshes: THREE.Mesh[] = [];
  private droneMeshes: THREE.Mesh[] = [];

  // ==== Плоский список анимируемого декора ====
  // Анимация в update() не умеет рекурсивно спускаться в decorGroup.children —
  // меши с userData.animate, лежащие ВНУТРИ биомных групп, не анимировались.
  // Собираем их в плоский массив при постройке (0-GC в кадре: только итерация).
  private decorAnimated: THREE.Object3D[] = [];
  // Якоря частиц декора (мировые x,y,z), stride 3 — для «искр» с верхушек
  // башен/кристаллов/монолитов. Предаллоцированы при постройке.
  private decorFxAnchors: Float32Array = new Float32Array(0);
  private decorFxAccum: number = 0;
  // Накапливаемая фаза бегущей волны по пилонам (смещается по Z — волна «едет»).
  private pylonWavePhase: number = 0;

  // State
  public isRunning: boolean = false;
  public isPaused: boolean = false;
  private runEnded: boolean = false;
  private deathGrace: number = 0;
  public currentLevel: LevelConfig | null = null;
  public isEndless: boolean = false;
  public endlessSegmentIndex: number = 0;
  public currentEndlessZ: number = 0;

  // Controls
  private inputEnabled: boolean = true;
  private steerInput: number = 0;
  private isPointerDown: boolean = false;
  private lastPointerX: number = 0;
  private baseSpeed: number = 18.0;

  // Camera follow (третье лицо). Толпа стоит близко к земле и близко к камере —
  // при старой геометрии (высота 8.5, дистанция 10, взгляд на +12 вперёд) она
  // проецировалась на ~86-91% высоты экрана, то есть под нижнюю HUD-панель
  // (адреналин/формации, ~17% вьюпорта снизу). Эти константы отодвигают камеру
  // дальше и ниже и сокращают взгляд вперёд, поднимая толпу до ~69% высоты кадра.
  private static readonly CAMERA_HEIGHT = 6.0;
  private static readonly CAMERA_BASE_DISTANCE = 16.0;
  private static readonly CAMERA_LOOKAT_HEIGHT = 2.5;
  private static readonly CAMERA_LOOKAT_LEAD = 6.0;
  // Окно видимости зрителей по Z вокруг leaderZ: зрители за пределами этого окна
  // анимируются только при пересечении границы (scale=0), а не каждый кадр. Запас
  // назад > CAMERA_BASE_DISTANCE + speedLag, вперёд — до предела читаемости силуэта.
  private static readonly SPECTATOR_WINDOW_BACK = 30.0;
  private static readonly SPECTATOR_WINDOW_AHEAD = 90.0;

  // Adrenaline (перенесено сюда из HUD-таймера — заряд должен стоять на паузе
  // и не быть отвязан от реальной игры)
  public adrenalineCharge: number = 0;

  // Screen shake
  private screenShakeIntensity: number = 0;

  // Speed-trail particle accumulator (hyper mode / arrow formation)
  private trailAccum: number = 0;

  // Динамические события уровня (ambush/coin_train/emp_storm/meteor_rain/speed_boost).
  // Система была "мёртвой" — события генерировались в LevelGenerator, но не исполнялись.
  // Теперь они триггерятся по leaderZ в updateDynamicEvents().
  private pendingEvents: LevelDynamicEvent[] = [];
  private nextEventIndex: number = 0;
  private activeEvent: { event: LevelDynamicEvent; timer: number } | null = null;
  private eventSpeedMult: number = 1.0; // множитель скорости толпы от событий (boost>1, ambush<1)
  private meteorAccum: number = 0;
  private eventFxAccum: number = 0;

  // Callbacks
  private onLevelWinCb?: (score: number, mult: number, mobs: number, runStats: RunStats) => void;
  private onLevelLoseCb?: (runStats: RunStats) => void;
  private callbacks: GameEngineCallbacks;
  private unsubShake: (() => void) | null = null;
  private unsubGateCharge: (() => void) | null = null;
  private unsubMobFell: (() => void) | null = null;
  private unsubCombo: (() => void) | null = null;
  private unsubNearMiss: (() => void) | null = null;
  private unsubSettings: (() => void) | null = null;

  // ==== Адаптивное разрешение (watchdog) ====
  // Следит за средним временем кадра и при просадке FPS плавно снижает pixelRatio,
  // восстанавливая его, когда кадр снова быстрый. Снижает нагрузку на GPU на слабых
  // устройствах без ручного вмешательства игрока.
  private adaptiveAccum: number = 0;
  private adaptiveFrames: number = 0;
  private adaptiveLastChange: number = 0;
  private currentPixelRatio: number = 1;

  constructor(container: HTMLElement, callbacks: GameEngineCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;

    // 1. Scene
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x080c14, 0.015);

    // 2. Camera (Third person chase camera)
    const aspect = container.clientWidth / container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 800);
    this.camera.position.set(0, GameEngine.CAMERA_HEIGHT, -GameEngine.CAMERA_BASE_DISTANCE);
    this.camera.lookAt(0, GameEngine.CAMERA_LOOKAT_HEIGHT, GameEngine.CAMERA_LOOKAT_LEAD);

    // 3. Renderer
    const settings = stateManager.getState().settings;
    this.renderer = new THREE.WebGLRenderer({
      antialias: settings.graphicsQuality !== 'low',
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    container.appendChild(this.renderer.domElement);

    // 4. Lights
    this.hemiLight = new THREE.HemisphereLight(0x38bdf8, 0x0f172a, 0.7);
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
    this.dirLight.position.set(15, 30, 20);
    this.dirLight.castShadow = settings.enableShadows;
    this.dirLight.shadow.mapSize.width = 1024;
    this.dirLight.shadow.mapSize.height = 1024;
    this.dirLight.shadow.camera.near = 1;
    this.dirLight.shadow.camera.far = 120;
    this.dirLight.shadow.camera.left = -20;
    this.dirLight.shadow.camera.right = 20;
    this.dirLight.shadow.camera.top = 30;
    this.dirLight.shadow.camera.bottom = -20;
    this.scene.add(this.dirLight);

    // Применяем настройки графики (pixelRatio, тени) сразу после создания света —
    // applyGraphicsSettings обращается к this.dirLight, поэтому он должен быть готов.
    this.applyGraphicsSettings();

    // 5. Instantiate sub-systems
    // Потолок толпы снижен с 400 до 200: меньше бойцов = меньше объектов на сцене,
    // меньше нагрузка на CPU/GPU и проще балансировать бонусы/препятствия.
    this.crowd = new CrowdManager(this.scene, 200);
    this.gates = new GateManager(this.scene);
    this.walls = new WallManager(this.scene);
    this.bonus = new BonusManager(this.scene);
    this.obstacles = new ObstacleManager(this.scene);
    this.boss = new BossManager(this.scene);
    this.finishLine = new FinishLineManager(this.scene);
    this.particles = new ParticleSystem(this.scene, 300);

    // 6. Setup Inputs and Resizing
    this.setupInputs();
    window.addEventListener('resize', this.onResize);

    // Subscribe to shake events (unsubscribe сохраняем — раньше терялась при dispose)
    this.unsubShake = eventBus.on('screenShake', (data: { intensity: number }) => {
      if (stateManager.getState().settings.enableScreenShake) {
        this.screenShakeIntensity = Math.min(1.0, this.screenShakeIntensity + (data.intensity || 0.4));
      }
    });

    // Адреналин заряжается за успешные положительные ворота
    this.unsubGateCharge = eventBus.on('gatePassed', (data: { isPositive?: boolean }) => {
      if (data?.isPositive) {
        this.adrenalineCharge = Math.min(100, this.adrenalineCharge + 15);
      }
    });

    // Спецэффект при падении человечка с края дорожки: вспышка частиц + звук
    this.unsubMobFell = eventBus.on('mobFell', (data: { x: number; z: number }) => {
      this.particles.emitBurst(data.x, 0.6, data.z, 10, 0x94a3b8, 3.0);
      soundEngine.playSound('mob_fall');
    });

    // Конфетти при комбо (серия успешных ворот) — праздничный спецэффект.
    this.unsubCombo = eventBus.on('gatePassed', (data: { comboStreak?: number; x?: number; z?: number }) => {
      if ((data?.comboStreak ?? 0) >= 3) {
        this.particles.emitConfetti(data.x ?? this.crowd.leaderX, 1.5, data.z ?? this.crowd.leaderZ, 20);
        // Толпа на трибунах радуется серии успешных ворот — нарастающий крик.
        soundEngine.playCrowdCheer(Math.min(1, 0.3 + (data.comboStreak ?? 3) * 0.1));
      }
    });

    // Near-Miss (уворот в упор): рискованный проход вплотную к ловушке без касания
    // даёт импульс заряда адреналина — поощряет филигранное микроуправление.
    // Серия уворотов эскалирует награду: множитель x2/x5/x10 даёт больше заряда и
    // более яркий визуальный фидбек.
    this.unsubNearMiss = eventBus.on('nearMiss', (data: { x?: number; z?: number; multiplier?: number }) => {
      const mult = data?.multiplier ?? 1;
      const adrenalineBonus = mult >= 10 ? 30 : mult >= 5 ? 22 : mult >= 2 ? 16 : 12;
      this.adrenalineCharge = Math.min(100, this.adrenalineCharge + adrenalineBonus);
      const count = mult >= 10 ? 36 : mult >= 5 ? 26 : mult >= 2 ? 18 : 12;
      const color = mult >= 10 ? 0xfacc15 : mult >= 5 ? 0xa855f7 : mult >= 2 ? 0x00f0ff : 0x38bdf8;
      this.particles.emitBurst(data.x ?? this.crowd.leaderX, 1.2, data.z ?? this.crowd.leaderZ, count, color, 4.0);
      if (mult >= 10) eventBus.emit('screenShake', { intensity: 0.15 });
    });

    // Живое применение настроек графики: смена качества/теней в настройках сразу
    // влияет на рендер, без перезапуска забега.
    this.unsubSettings = eventBus.on('settingsChanged', () => this.applyGraphicsSettings());

    this.animate = this.animate.bind(this);
  }

  /** Применяет текущие настройки графики к рендереру (pixelRatio, тени, antialias).
   *  Вызывается при создании и при каждом изменении настроек. */
  private applyGraphicsSettings(): void {
    const settings = stateManager.getState().settings;
    const dpr = window.devicePixelRatio || 1;
    // Целевой pixelRatio по качеству: high = до 2.0, medium/low = 1.0 (дешевле на мобильных).
    const target = settings.graphicsQuality === 'high' ? Math.min(dpr, 2.0) : 1.0;
    // Не поднимаем выше, чем уже установил адаптивный watchdog (если он снизил из-за FPS).
    this.currentPixelRatio = Math.min(target, this.currentPixelRatio || target);
    if (this.renderer) {
      this.renderer.setPixelRatio(this.currentPixelRatio);
      if (this.renderer.shadowMap) this.renderer.shadowMap.enabled = settings.enableShadows;
    }
    if (this.dirLight) this.dirLight.castShadow = settings.enableShadows;
    // antialias нельзя менять на лету у существующего рендерера — он задаётся при создании.
    // Здесь только синхронизируем тени и разрешение; antialias остаётся как при старте.
  }

  /** Адаптивный watchdog разрешения: накапливает среднее время кадра и при просадке
   *  FPS плавно снижает pixelRatio (до 0.75), восстанавливая его, когда кадр снова
   *  быстрый. Работает только на high-качестве (там есть запас по разрешению). */
  private updateAdaptiveResolution(dt: number): void {
    const settings = stateManager.getState().settings;
    if (settings.graphicsQuality !== 'high') return;

    this.adaptiveAccum += dt;
    this.adaptiveFrames++;
    if (this.adaptiveFrames < 30) return; // ждём ~0.5с накопления

    const avgFrame = this.adaptiveAccum / this.adaptiveFrames;
    this.adaptiveAccum = 0;
    this.adaptiveFrames = 0;
    const now = performance.now();

    // Просадка: средний кадр > 33мс (~30 FPS) и прошло >2.5с с последнего изменения.
    if (avgFrame > 0.033 && now - this.adaptiveLastChange > 2500) {
      const next = Math.max(0.75, this.currentPixelRatio * 0.9);
      if (next < this.currentPixelRatio) {
        this.currentPixelRatio = next;
        this.renderer.setPixelRatio(this.currentPixelRatio);
        this.adaptiveLastChange = now;
      }
    } else if (avgFrame < 0.02 && now - this.adaptiveLastChange > 2500) {
      // Кадр быстрый — восстанавливаем к целевому качеству.
      const dpr = window.devicePixelRatio || 1;
      const target = Math.min(dpr, 2.0);
      const next = Math.min(target, this.currentPixelRatio * 1.1);
      if (next > this.currentPixelRatio) {
        this.currentPixelRatio = next;
        this.renderer.setPixelRatio(this.currentPixelRatio);
        this.adaptiveLastChange = now;
      }
    }
  }

  // Keyboard controls
  private keyLeft: boolean = false;
  private keyRight: boolean = false;
  private onKeyDownHandler: ((e: KeyboardEvent) => void) | null = null;
  private onKeyUpHandler: ((e: KeyboardEvent) => void) | null = null;
  private onMouseDownHandler: ((e: MouseEvent) => void) | null = null;
  private onMouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  private onMouseUpHandler: (() => void) | null = null;
  private onTouchStartHandler: ((e: TouchEvent) => void) | null = null;
  private onTouchMoveHandler: ((e: TouchEvent) => void) | null = null;
  private onTouchEndHandler: (() => void) | null = null;
  private onBlurHandler: (() => void) | null = null;
  private onVisibilityHandler: (() => void) | null = null;

  private static isTypingTarget(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    );
  }

  /** Сбрасывает все удерживаемые состояния ввода — используется при потере фокуса и на паузе. */
  private releaseInput(): void {
    this.keyLeft = false;
    this.keyRight = false;
    this.isPointerDown = false;
    this.steerInput = 0;
  }

  public setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
    if (!enabled) this.releaseInput();
  }

  private setupInputs(): void {
    // Pointer / Mouse / Touch
    const dom = this.renderer.domElement;

    const onStart = (clientX: number) => {
      if (!this.inputEnabled) return;
      this.isPointerDown = true;
      this.lastPointerX = clientX;
      soundEngine.resume();
    };

    const onMove = (clientX: number) => {
      if (!this.isPointerDown || !this.inputEnabled) return;
      const settings = stateManager.getState().settings;
      const deltaX = clientX - this.lastPointerX;
      this.lastPointerX = clientX;

      // Камера смотрит вдоль +Z (см. update()), поэтому мировой правый вектор камеры —
      // это -X: экранное "вправо" достигается УМЕНЬШЕНИЕМ leaderX. Свайп вправо
      // (deltaX > 0) должен снижать leaderX, отсюда знак минус ниже.
      const invertMult = settings.invertX ? -1 : 1;
      const baseFactor = (deltaX / window.innerWidth) * 45 * settings.controlsSensitivity;
      this.steerInput = clamp(-baseFactor * invertMult, -1, 1);
    };

    const onEnd = () => {
      this.isPointerDown = false;
      if (!this.keyLeft && !this.keyRight) {
        this.steerInput = 0;
      }
    };

    this.onMouseDownHandler = (e: MouseEvent) => onStart(e.clientX);
    this.onMouseMoveHandler = (e: MouseEvent) => onMove(e.clientX);
    this.onMouseUpHandler = onEnd;
    dom.addEventListener('mousedown', this.onMouseDownHandler);
    window.addEventListener('mousemove', this.onMouseMoveHandler);
    window.addEventListener('mouseup', this.onMouseUpHandler);

    this.onTouchStartHandler = (e: TouchEvent) => {
      if (e.touches.length > 0) onStart(e.touches[0].clientX);
    };
    this.onTouchMoveHandler = (e: TouchEvent) => {
      if (e.touches.length > 0) onMove(e.touches[0].clientX);
    };
    this.onTouchEndHandler = onEnd;
    dom.addEventListener('touchstart', this.onTouchStartHandler, { passive: true });
    window.addEventListener('touchmove', this.onTouchMoveHandler, { passive: true });
    window.addEventListener('touchend', this.onTouchEndHandler);

    // Keyboard controls (supports English, Russian, Arrow keys, Space, 1-4, Escape/P for pause)
    this.onKeyDownHandler = (e: KeyboardEvent) => {
      // Печать в поле ввода (например, код сохранения в настройках) не должна рулить толпой.
      if (GameEngine.isTypingTarget(e.target)) return;

      const code = e.code;
      const key = e.key.toLowerCase();

      if (code === 'Escape' || code === 'KeyP' || key === 'p') {
        this.callbacks.onPauseRequest?.();
        return;
      }

      if (!this.inputEnabled) return;

      if (code === 'Space' || code === 'ArrowLeft' || code === 'ArrowRight' || code === 'ArrowUp' || code === 'ArrowDown') {
        e.preventDefault(); // не скроллить страницу и не "нажимать" сфокусированную кнопку HUD
      }

      soundEngine.resume();

      if (code === 'KeyA' || code === 'ArrowLeft' || key === 'a' || key === 'arrowleft' || key === 'ф') {
        this.keyLeft = true;
      } else if (code === 'KeyD' || code === 'ArrowRight' || key === 'd' || key === 'arrowright' || key === 'в') {
        this.keyRight = true;
      } else if (code === 'Space' || key === ' ') {
        this.tryActivateAdrenaline();
      } else if (code === 'Digit1' || key === '1') {
        this.crowd.setFormation('wedge');
      } else if (code === 'Digit2' || key === '2') {
        this.crowd.setFormation('wide');
      } else if (code === 'Digit3' || key === '3') {
        this.crowd.setFormation('circle');
      } else if (code === 'Digit4' || key === '4') {
        this.crowd.setFormation('arrow');
      }
    };

    this.onKeyUpHandler = (e: KeyboardEvent) => {
      const code = e.code;
      const key = e.key.toLowerCase();
      if (code === 'KeyA' || code === 'ArrowLeft' || key === 'a' || key === 'arrowleft' || key === 'ф') {
        this.keyLeft = false;
      } else if (code === 'KeyD' || code === 'ArrowRight' || key === 'd' || key === 'arrowright' || key === 'в') {
        this.keyRight = false;
      }
    };

    window.addEventListener('keydown', this.onKeyDownHandler);
    window.addEventListener('keyup', this.onKeyUpHandler);

    // Alt+Tab / смена вкладки с зажатой клавишей раньше оставляли толпу навсегда
    // едущей вбок — сбрасываем ввод и просим паузу.
    this.onBlurHandler = () => {
      this.releaseInput();
      this.callbacks.onPauseRequest?.();
    };
    this.onVisibilityHandler = () => {
      if (document.visibilityState === 'hidden') {
        this.releaseInput();
        this.callbacks.onPauseRequest?.();
      }
    };
    window.addEventListener('blur', this.onBlurHandler);
    document.addEventListener('visibilitychange', this.onVisibilityHandler);
  }

  private onResize = (): void => {
    if (!this.container) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  public loadLevel(
    levelNum: number,
    onWin: (score: number, mult: number, mobs: number, runStats: RunStats) => void,
    onLose: (runStats: RunStats) => void
  ): void {
    this.isEndless = false;
    this.onLevelWinCb = onWin;
    this.onLevelLoseCb = onLose;
    this.runEnded = false;
    this.deathGrace = 0;
    this.adrenalineCharge = 0;
    stateManager.beginRun();

    const levelConfig = LevelGenerator.generateLevel(levelNum);
    this.currentLevel = levelConfig;

    this.setupBiomeEnvironment(levelConfig.biome);
    // +40 запаса: стена множителей и сундук стоят за formальным trackLength
    // (finishZ + 10 + stepsCount*8 + 4 ≈ trackLength + 94), трасса должна их накрывать.
    this.buildTrack(levelConfig.trackLength + 40, levelConfig.trackWidth, levelConfig.biome);

    // Reset sub-systems
    this.crowd.reset(levelConfig.startingMobs, 0, levelConfig.trackWidth);
    this.gates.initGates(levelConfig.gates);
    this.walls.initWalls(levelConfig.walls);
    this.bonus.initBonuses(levelConfig.bonuses);
    this.obstacles.initObstacles(levelConfig.obstacles, levelConfig.coins);

    if (levelConfig.boss) {
      this.boss.initBoss(levelConfig.boss, levelConfig.trackLength - 20);
    } else {
      this.boss.clear();
    }

    this.finishLine.initFinishLine(levelConfig.trackLength, levelConfig.multiplierWallSteps);
    this.particles.clear();

    // Reset dynamic events state (загружаем очередь событий уровня).
    this.resetEventState();
    this.pendingEvents = (levelConfig.events || []).slice();

    // Start background music — разные мелодии под уровень (ротация внутри биома)
    soundEngine.playMusic(this.getMusicThemeForLevel(levelNum, levelConfig.biome));
  }

  /**
   * Выбор фоновой мелодии под уровень. Внутри одного биома уровни получают
   * разные мелодии (ротация из базовой темы биома + 2 дополнительные), чтобы
   * геймплей не звучал одинаково на всём пролёте биома. Боссовые уровни всё
   * равно переключаются на boss_battle (см. BossManager).
   */
  private getMusicThemeForLevel(levelNum: number, biome: BiomeType): MusicTheme {
    const cycle = levelNum % 3;
    switch (biome) {
      case 'cyber_city':
        return cycle === 0 ? 'cyber' : cycle === 1 ? 'pulse' : 'tension';
      case 'magma_citadel':
        return cycle === 0 ? 'magma' : cycle === 1 ? 'tension' : 'pulse';
      case 'crystal_cavern':
        return cycle === 0 ? 'crystal' : cycle === 1 ? 'echo' : 'spark';
      case 'quantum_void':
        return cycle === 0 ? 'void' : cycle === 1 ? 'echo' : 'spark';
      case 'celestial_core':
        return cycle === 0 ? 'celestial' : cycle === 1 ? 'titan' : 'spark';
      default:
        return 'cyber';
    }
  }

  public startEndlessMode(onLose: (runStats: RunStats) => void): void {
    this.isEndless = true;
    this.onLevelLoseCb = onLose;
    this.endlessSegmentIndex = 0;
    this.currentEndlessZ = 0;
    this.currentLevel = null;
    this.runEnded = false;
    this.deathGrace = 0;
    this.adrenalineCharge = 0;
    stateManager.beginRun();

    const biome: BiomeType = 'cyber_city';
    this.setupBiomeEnvironment(biome);
    this.buildTrack(500, DEFAULT_TRACK_WIDTH, biome);

    this.crowd.reset(8, 0, DEFAULT_TRACK_WIDTH);
    this.particles.clear();
    this.boss.clear();
    this.finishLine.clear();

    const seg = LevelGenerator.generateEndlessSegment(0, 0);
    this.gates.initGates(seg.gates);
    this.walls.initWalls(seg.walls);
    this.bonus.initBonuses(seg.bonuses);
    this.obstacles.initObstacles(seg.obstacles, seg.coins);
    this.currentEndlessZ += seg.length;

    soundEngine.playMusic('cyber');
  }

  private setupBiomeEnvironment(biome: BiomeType): void {
    const colors: Record<BiomeType, { sky: number; fog: number; light: number; ground: number }> = {
      cyber_city: { sky: 0x080c14, fog: 0x080c14, light: 0x38bdf8, ground: 0x0f172a },
      magma_citadel: { sky: 0x1c0c08, fog: 0x260a08, light: 0xf97316, ground: 0x1e1210 },
      crystal_cavern: { sky: 0x051a14, fog: 0x061e18, light: 0x10b981, ground: 0x08201a },
      quantum_void: { sky: 0x120824, fog: 0x140828, light: 0xa855f7, ground: 0x180f2d },
      celestial_core: { sky: 0x181404, fog: 0x1f1908, light: 0xfacc15, ground: 0x241d0c },
    };

    const cfg = colors[biome] || colors.cyber_city;
    this.scene.background = new THREE.Color(cfg.sky);
    this.scene.fog = new THREE.FogExp2(cfg.fog, 0.014);
    this.hemiLight.color.setHex(cfg.light);
  }

  private disposeTrackMeshes(): void {
    if (this.trackMesh) {
      this.scene.remove(this.trackMesh);
      this.trackMesh.geometry.dispose();
      (this.trackMesh.material as THREE.Material).dispose();
      this.trackMesh = null;
    }
    if (this.leftBorder) {
      this.scene.remove(this.leftBorder);
      this.leftBorder.geometry.dispose();
      (this.leftBorder.material as THREE.Material).dispose();
      this.leftBorder = null;
    }
    if (this.rightBorder) {
      this.scene.remove(this.rightBorder);
      this.rightBorder.geometry.dispose();
      (this.rightBorder.material as THREE.Material).dispose();
      this.rightBorder = null;
    }
    if (this.decorGroup) {
      this.scene.remove(this.decorGroup);
      this.decorGroup.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
      this.decorGroup = null;
    }
    // Сброс ссылок на зрителей (меши уже удалены вместе с decorGroup).
    this.spectatorMesh = null;
    this.spectatorArmMesh = null;
    this.spectatorArm2Mesh = null;
    this.spectatorHeadMesh = null;
    this.spectatorGlowMesh = null;
    this.spectatorCount = 0;
    this.spectatorVisibility = new Uint8Array(0);
    this.spectatorData = new Float32Array(0);
    this.beamMeshes = [];
    this.flagMeshes = [];
    this.droneMeshes = [];
    this.decorAnimated = [];
    this.decorFxAnchors = new Float32Array(0);
    this.decorFxAccum = 0;
    this.pylonWavePhase = 0;
  }

  private buildTrack(length: number, width: number, biome: BiomeType): void {
    this.disposeTrackMeshes();

    // Track Surface
    const trackGeo = new THREE.PlaneGeometry(width, length + 80);
    const trackMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      metalness: 0.8,
      roughness: 0.3,
      emissive: biome === 'magma_citadel' ? 0x451a03 : 0x0284c7,
      emissiveIntensity: 0.15,
    });
    this.trackMesh = new THREE.Mesh(trackGeo, trackMat);
    this.trackMesh.rotation.x = -Math.PI / 2;
    this.trackMesh.position.set(0, 0, (length + 80) / 2 - 20);
    this.trackMesh.receiveShadow = true;
    this.scene.add(this.trackMesh);

    // Glowing Neon Side Rails
    const railGeo = new THREE.BoxGeometry(0.3, 0.8, length + 80);
    const railMat = new THREE.MeshBasicMaterial({
      color: biome === 'magma_citadel' ? 0xf97316 : 0x00f0ff,
    });

    this.leftBorder = new THREE.Mesh(railGeo, railMat);
    this.leftBorder.position.set(-width / 2, 0.4, (length + 80) / 2 - 20);
    this.scene.add(this.leftBorder);

    this.rightBorder = new THREE.Mesh(railGeo, railMat.clone());
    this.rightBorder.position.set(width / 2, 0.4, (length + 80) / 2 - 20);
    this.scene.add(this.rightBorder);

    this.buildTrackDecor(length, width, biome);
  }

  // Neon pylons + floating energy orbs + biome scenery along the track edges —
  // pure visual, zero gameplay. Никаких PointLight (мобильный бюджет): только
  // emissive/Basic материалы.
  // Рекурсивно собирает все потомки с userData.animate в плоский список
  // decorAnimated — update() не умеет спускаться в decorGroup.children, поэтому
  // вложенные анимируемые меши (антенны в башнях, кольца монолитов, лавовые
  // колонны) собираются здесь один раз при постройке (0-GC в кадре).
  private collectDecorAnimated(): void {
    this.decorAnimated = [];
    if (!this.decorGroup) return;
    this.decorGroup.traverse((obj) => {
      if (obj.userData.animate) this.decorAnimated.push(obj);
    });
  }

  // Добавляет якорь для периодических «искр» из декора (вершины башен/кристаллов/
  // монолитов). Принимает x, y, z. Коллекция идёт только при постройке (0-GC в кадре).
  private addDecorFxAnchor(x: number, y: number, z: number): void {
    const n = this.decorFxAnchors.length / 3;
    const next = new Float32Array((n + 1) * 3);
    next.set(this.decorFxAnchors);
    next[n * 3] = x;
    next[n * 3 + 1] = y;
    next[n * 3 + 2] = z;
    this.decorFxAnchors = next;
  }

  // Высота «верхушки» декора для якоря искр. Объект стоит на y=0; мировая высота
  // верхней точки = (локальный position + bb.max.y) * scale. Вызывается только при
  // постройке (build), НЕ в кадре — там 0-GC.
  private decorFxAnchorHeight(obj: THREE.Object3D): number {
    let topY = 0;
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) {
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const bb = mesh.geometry.boundingBox!;
        const localY = child.position.y + bb.max.y;
        if (localY > topY) topY = localY;
      }
    });
    return Math.max(2.0, topY * (obj.scale.y as number));
  }

  private buildTrackDecor(length: number, width: number, biome: BiomeType): void {
    const group = new THREE.Group();
    const accent = biome === 'magma_citadel' ? 0xf97316 : biome === 'crystal_cavern' ? 0x10b981 : biome === 'quantum_void' ? 0xa855f7 : biome === 'celestial_core' ? 0xfacc15 : 0x00f0ff;

    // Зоны трибун — в них НЕ ставим пилоны/орбы/кольца/биом, чтобы не загораживать
    // зрителей. Совпадает с зонами в buildTribunesAndSpectators.
    const isTribuneZone = (z: number): boolean => {
      const zones: Array<[number, number]> = [
        [0, 48],
        [Math.floor(length * 0.4) - 4, Math.floor(length * 0.4) + 34],
        [Math.floor(length * 0.7) - 4, Math.floor(length * 0.7) + 34],
        [Math.max(0, length - 65), length + 10],
      ];
      return zones.some(([z0, z1]) => z >= z0 && z <= z1);
    };

    // Пилоны — низкие столбики разметки на самом краю дорожки (x = trackHalfWidth),
    // ниже голов зрителей, вне линии трибун. В зонах трибун не ставим.
    const pylonGeo = new THREE.CylinderGeometry(0.12, 0.18, 1.4, 6);
    const pylonMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.85,
      roughness: 0.25,
      emissive: accent,
      emissiveIntensity: 0.5,
    });
    const capGeo = new THREE.SphereGeometry(0.14, 8, 8);
    const capMat = new THREE.MeshBasicMaterial({ color: accent });

    const half = width / 2 + 1.2;
    const step = 18;
    for (let z = 10; z < length; z += step) {
      if (isTribuneZone(z)) continue;
      for (const side of [-1, 1]) {
        const pylon = new THREE.Mesh(pylonGeo, pylonMat);
        pylon.position.set(side * half, 0.7, z);
        // Бегущая световая волна по пилонам — модуляция emissiveIntensity по Z.
        pylon.userData.animate = 'pylonWave';
        pylon.userData.baseZ = z;
        group.add(pylon);
        const cap = new THREE.Mesh(capGeo, capMat);
        cap.position.set(side * half, 1.45, z);
        group.add(cap);
      }
    }

    // Floating energy orbs drifting ALONGSIDE the track (outside the lane) —
    // decorative elements must NOT sit on the playable surface. В зонах трибун не ставим.
    const orbGeo = new THREE.SphereGeometry(0.18, 8, 8);
    const orbMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.85 });
    const orbSide = width / 2 + 1.6;
    for (let z = 20; z < length; z += 26) {
      if (isTribuneZone(z)) continue;
      const orb = new THREE.Mesh(orbGeo, orbMat);
      const baseY = 2.6 + Math.random() * 1.2;
      const side = Math.random() < 0.5 ? -1 : 1;
      orb.position.set(side * (orbSide + Math.random() * 1.2), baseY, z);
      orb.userData.animate = 'orb';
      orb.userData.baseY = baseY;
      group.add(orb);
    }

    // ==== Биомное окружение ЗА краями дорожки ====
    // Большие силуэты по бокам (здания / скалы / кристаллы / колонны) — дают ощущение
    // полноценного мира вокруг трассы, а не пустоты. Материалы emissive/Basic — 0 новых
    // PointLight, чтобы не прожечь мобильный GPU-бюджет.
    // Ставим ДАЛЕКО за трибунами (x >= 15.7), чтобы не загораживать зрителей.
    const sceneryStep = 30;
    const sceneryX = 15.7; // внешний край трибун (~14.2) + зазор
    // Детерминированный PRNG на основе биома — окружение стабильно между перезапусками уровня.
    const prng = (seed: number) => {
      let s = seed;
      return () => {
        s = (s * 1664525 + 1013904223) | 0;
        const t = (s ^ (s >>> 15)) >>> 0;
        return t / 4294967296;
      };
    };
    let seed = biome.charCodeAt(0) * 131 + biome.length;
    for (let z = 8; z < length; z += sceneryStep) {
      seed = (seed * 1103515245 + 12345) | 0;
      const rnd = prng(seed);
      const side = rnd() < 0.5 ? -1 : 1;
      const off = 1.0 + rnd() * 6; // вариация расстояния за трибунами
      const x = side * (sceneryX + off);
      const obj = this.makeBiomeScenery(biome, accent, rnd);
      obj.position.set(x, 0, z);
      obj.scale.setScalar(0.6 + rnd() * 0.9);
      obj.rotation.y = rnd() * Math.PI * 2;
      // Лёгкая анимация (вращение у колец-монолитов) через тег
      if (rnd() < 0.5) {
        obj.userData.animate = 'scenerySpin';
      }
      group.add(obj);
      // Якорь «искр» на верхней точке объекта (мировые координаты, с учётом scale).
      // Привязываем к локальному центру верхушки — без дополнительных bbox-вычислений.
      this.addDecorFxAnchor(x, this.decorFxAnchorHeight(obj), z);
    }

    // ==== ОБЪЕКТЫ-ЗАГОЛОВКИ ====
    // Прожекторные кольца ПО БОКАМ дорожки (вне игровой зоны) — вращаются (анимация).
    // В зонах трибун не ставим.
    const ringGeo = new THREE.TorusGeometry(1.6, 0.08, 6, 20);
    const ringMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.6 });
    const ringSide = width / 2 + 2.2;
    for (let z = 30; z < length; z += 44) {
      if (isTribuneZone(z)) continue;
      const ring = new THREE.Mesh(ringGeo, ringMat);
      const side = Math.random() < 0.5 ? -1 : 1;
      ring.position.set(side * ringSide, 3.2 + Math.random() * 1.5, z);
      ring.rotation.x = Math.PI / 2;
      ring.userData.animate = 'ring';
      ring.userData.baseY = ring.position.y;
      ring.userData.axis = Math.random() < 0.5 ? 'z' : 'y';
      group.add(ring);
    }

    // Голограммы-знаки УБРАНЫ — они отвлекали от игровых элементов. Остаются только
    // пилоны, орбы, биомное окружение и прожекторные кольца.

    // Трибуны со зрителями, световые лучи, фонари, рекламные щиты, флаги и дроны.
    this.buildTribunesAndSpectators(group, length, width, accent);
    this.buildLightBeams(group, length, width, accent);
    this.buildStreetFurniture(group, length, width, accent, biome);

    this.scene.add(group);
    this.decorGroup = group;
    // После сборки собрать плоский список анимируемых мешей (включая вложенные
    // в биомные группы) — update() итерирует его вместо плоского decorGroup.children.
    this.collectDecorAnimated();
  }

  // Ступенчатые трибуны со зрителями по бокам дорожки (|x| >= 9.5) на ключевых
  // зонах: старт (z 0-40), крупные ворота, предфиниш. Зрители — 2 InstancedMesh
  // (тела + машущие руки), позиции на ступенях через seeded PRNG (детерминизм).
  private buildTribunesAndSpectators(group: THREE.Group, length: number, width: number, accent: number): void {
    const half = width / 2 + 1.2; // 9.2 — край пилонов; трибуны ставим ещё дальше
    const tribuneX = half + 0.6; // ~9.8, строго вне игровой полосы (|x| >= 9.5)

    // Зоны трибун: [startZ, endZ] — старт, предфиниш, плюс пара секций по пути.
    const zones: Array<[number, number]> = [
      [0, 40],
      [Math.floor(length * 0.4), Math.floor(length * 0.4) + 30],
      [Math.floor(length * 0.7), Math.floor(length * 0.7) + 30],
      [Math.max(0, length - 60), length],
    ];

    // Материал ступеней — тёмный, с лёгким акцентным кантом.
    const stepMat = new THREE.MeshStandardMaterial({ color: 0x1a2233, metalness: 0.5, roughness: 0.6 });
    const stepEdgeMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.5 });

    // Собираем позиции зрителей (массив чисел, не объектов — 0-GC в цикле).
    const seats: number[] = [];
    const tiers = 4; // ярусов ступеней
    const stepDepth = 1.1;
    const stepHeight = 0.5;

    for (const [z0, z1] of zones) {
      for (const side of [-1, 1]) {
        // Ступени трибуны
        for (let tier = 0; tier < tiers; tier++) {
          const stepGeo = new THREE.BoxGeometry(stepDepth, stepHeight, z1 - z0);
          const step = new THREE.Mesh(stepGeo, stepMat);
          step.position.set(side * (tribuneX + tier * stepDepth), stepHeight / 2 + tier * stepHeight, (z0 + z1) / 2);
          group.add(step);
          // Светящийся кант передней кромки ступени
          const edgeGeo = new THREE.BoxGeometry(0.06, 0.05, z1 - z0);
          const edge = new THREE.Mesh(edgeGeo, stepEdgeMat);
          edge.position.set(side * (tribuneX + tier * stepDepth) - side * stepDepth / 2, stepHeight + tier * stepHeight, (z0 + z1) / 2);
          group.add(edge);
        }
        // Зрители на ступенях (кроме самого нижнего ряда — там барьер)
        for (let tier = 1; tier < tiers; tier++) {
          const rowZ = z0 + 1.5;
          const rowCount = Math.floor((z1 - z0 - 3) / 0.9); // реже (0.9 вместо 0.7) — меньше объектов на экране
          for (let i = 0; i < rowCount; i++) {
            const z = rowZ + i * 0.9 + (Math.random() - 0.5) * 0.3;
            const x = side * (tribuneX + tier * stepDepth + (Math.random() - 0.5) * 0.4);
            const y = stepHeight * tier + 0.1;
            seats.push(x, y, z);
          }
        }
      }
    }

    // ==== InstancedMesh зрителей ====
    // Специальная геометрия зрителя БЕЗ статичных рук (иначе «3 руки»: две из
    // createHumanoidGeometry + отдельная машущая). Руки анимируются отдельными
    // InstancedMesh. Ориентация: зрители смотрят ВНУТРЬ на трассу (X=0), а не вдоль Z.
    const humanoidGeo = createSpectatorGeometry();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.1 });
    const armGeo = new THREE.CylinderGeometry(0.05, 0.045, 0.5, 6);
    armGeo.translate(0, 0.25, 0); // ось вращения у плеча
    const armMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.1 });
    // Голова — отдельный InstancedMesh (телесный/контрастный цвет), читается как «человечки».
    const headGeo = new THREE.SphereGeometry(0.2, 8, 8);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xd9a066, roughness: 0.6, metalness: 0.05 });
    // Лайтстик (светящаяся палочка) на кончике машущей руки — «концертный» вид.
    const glowGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.3, 6);
    glowGeo.translate(0, 0.15, 0);
    const glowMat = new THREE.MeshBasicMaterial({ color: accent });

    const count = seats.length / 3;
    this.spectatorCount = count;
    this.spectatorData = new Float32Array(count * 12);
    // Все зрители изначально «активны» (матрицы уже выставлены видимыми при построении) —
    // первый кадр animateSpectators скроет тех, кто вне окна обзора.
    this.spectatorVisibility = new Uint8Array(count).fill(1);

    this.spectatorMesh = new THREE.InstancedMesh(humanoidGeo, bodyMat, count);
    this.spectatorMesh.frustumCulled = false;
    this.spectatorMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.spectatorMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.spectatorMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

    this.spectatorArmMesh = new THREE.InstancedMesh(armGeo, armMat, count);
    this.spectatorArmMesh.frustumCulled = false;
    this.spectatorArmMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this.spectatorArm2Mesh = new THREE.InstancedMesh(armGeo, armMat, count);
    this.spectatorArm2Mesh.frustumCulled = false;
    this.spectatorArm2Mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this.spectatorHeadMesh = new THREE.InstancedMesh(headGeo, headMat, count);
    this.spectatorHeadMesh.frustumCulled = false;
    this.spectatorHeadMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this.spectatorGlowMesh = new THREE.InstancedMesh(glowGeo, glowMat, count);
    this.spectatorGlowMesh.frustumCulled = false;
    this.spectatorGlowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // Яркая палитра одежды зрителей.
    const palette = [0xff3b30, 0xff9500, 0xffcc00, 0x34c759, 0x00c7be, 0x007aff, 0xaf52de, 0xff2d55, 0x5ac8fa, 0xffd60a, 0xffffff, 0x8e8e93];

    for (let i = 0; i < count; i++) {
      const bx = seats[i * 3];
      const by = seats[i * 3 + 1];
      const bz = seats[i * 3 + 2];
      const side = bx < 0 ? -1 : 1;
      const phase = Math.random() * Math.PI * 2;
      const freq = 3.0 + Math.random() * 2.0;
      const amp = 0.1 + Math.random() * 0.1;
      const armPhase = Math.random() * Math.PI * 2;
      const armFreq = 4.0 + Math.random() * 3.0;
      const baseRotZ = (Math.random() - 0.5) * 0.3;
      const armBaseX = side * 0.28;
      const armBaseY = 0.85;

      const o = i * 12;
      this.spectatorData[o] = bx;
      this.spectatorData[o + 1] = by;
      this.spectatorData[o + 2] = bz;
      this.spectatorData[o + 3] = phase;
      this.spectatorData[o + 4] = freq;
      this.spectatorData[o + 5] = amp;
      this.spectatorData[o + 6] = armPhase;
      this.spectatorData[o + 7] = armFreq;
      this.spectatorData[o + 8] = side;
      this.spectatorData[o + 9] = baseRotZ;
      this.spectatorData[o + 10] = armBaseX;
      this.spectatorData[o + 11] = armBaseY;

      // Ориентация к трассе: левая трибуна (x<0) смотрит на +X, правая (x>0) на -X.
      const faceYaw = side < 0 ? Math.PI / 2 : -Math.PI / 2;

      // Начальная матрица тела
      this.spectatorDummy.position.set(bx, by, bz);
      this.spectatorDummy.rotation.set(0, faceYaw, baseRotZ);
      this.spectatorDummy.scale.setScalar(0.9);
      this.spectatorDummy.updateMatrix();
      this.spectatorMesh.setMatrixAt(i, this.spectatorDummy.matrix);

      // Цвет тела
      this.spectatorColorDummy.setHex(palette[(Math.random() * palette.length) | 0]);
      this.spectatorMesh.setColorAt(i, this.spectatorColorDummy);

      // Голова (на теле, чуть выше)
      this.spectatorHeadDummy.position.set(bx, by + 1.35 * 0.9, bz);
      this.spectatorHeadDummy.rotation.set(0, faceYaw, 0);
      this.spectatorHeadDummy.scale.setScalar(0.9);
      this.spectatorHeadDummy.updateMatrix();
      this.spectatorHeadMesh.setMatrixAt(i, this.spectatorHeadDummy.matrix);

      // Рука 1 (машет)
      this.spectatorArmDummy.position.set(bx + armBaseX, by + armBaseY, bz);
      this.spectatorArmDummy.rotation.set(0, faceYaw, 0);
      this.spectatorArmDummy.scale.setScalar(0.9);
      this.spectatorArmDummy.updateMatrix();
      this.spectatorArmMesh.setMatrixAt(i, this.spectatorArmDummy.matrix);

      // Рука 2 (зеркальная, машет в противофазе)
      this.spectatorArm2Dummy.position.set(bx - armBaseX, by + armBaseY, bz);
      this.spectatorArm2Dummy.rotation.set(0, faceYaw, 0);
      this.spectatorArm2Dummy.scale.setScalar(0.9);
      this.spectatorArm2Dummy.updateMatrix();
      this.spectatorArm2Mesh.setMatrixAt(i, this.spectatorArm2Dummy.matrix);

      // Лайтстик на кончике руки 1
      this.spectatorGlowDummy.position.set(bx + armBaseX, by + armBaseY + 0.5 * 0.9, bz);
      this.spectatorGlowDummy.rotation.set(0, faceYaw, 0);
      this.spectatorGlowDummy.scale.setScalar(0.9);
      this.spectatorGlowDummy.updateMatrix();
      this.spectatorGlowMesh.setMatrixAt(i, this.spectatorGlowDummy.matrix);
    }
    this.spectatorMesh.instanceMatrix.needsUpdate = true;
    this.spectatorMesh.instanceColor!.needsUpdate = true;
    this.spectatorArmMesh.instanceMatrix.needsUpdate = true;
    this.spectatorArm2Mesh.instanceMatrix.needsUpdate = true;
    this.spectatorHeadMesh.instanceMatrix.needsUpdate = true;
    this.spectatorGlowMesh.instanceMatrix.needsUpdate = true;

    group.add(this.spectatorMesh);
    group.add(this.spectatorArmMesh);
    group.add(this.spectatorArm2Mesh);
    group.add(this.spectatorHeadMesh);
    group.add(this.spectatorGlowMesh);
  }

  // Объёмные световые лучи (additive конусы) по бокам — покачиваются в update.
  private buildLightBeams(group: THREE.Group, length: number, width: number, accent: number): void {
    const beamGeo = new THREE.CylinderGeometry(0.15, 1.4, 9, 8, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const beamX = 15.7 + 1.0; // за внешним краем трибун (~14.2) — зенитные прожекторы
    for (let z = 25; z < length; z += 40) {
      for (const side of [-1, 1]) {
        const beam = new THREE.Mesh(beamGeo, beamMat);
        beam.position.set(side * beamX, 4.5, z);
        beam.rotation.z = side * 0.12;
        beam.userData.baseY = 4.5;
        beam.userData.phase = Math.random() * Math.PI * 2;
        group.add(beam);
        this.beamMeshes.push(beam);
      }
    }
  }

  // Фонари (Г-образные, emissive-плафон), рекламные щиты (CanvasTexture),
  // флаги (покачивание sin) и дроны (дрейф по X) за дальним краем.
  private buildStreetFurniture(group: THREE.Group, length: number, width: number, accent: number, biome: BiomeType): void {
    // Фонари — низкое придорожное освещение на самом краю дорожки (x = trackHalfWidth),
    // ниже голов зрителей, вне линии трибун.
    const lampX = width / 2;

    // Фонари каждые ~12м
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.08, 2.2, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.3 });
    const armGeo = new THREE.BoxGeometry(0.7, 0.06, 0.06);
    const armMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.3 });
    const lampGeo = new THREE.SphereGeometry(0.12, 8, 8);
    const lampMat = new THREE.MeshBasicMaterial({ color: accent });

    for (let z = 6; z < length; z += 12) {
      for (const side of [-1, 1]) {
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.set(side * lampX, 1.1, z);
        group.add(pole);
        const arm = new THREE.Mesh(armGeo, armMat);
        arm.position.set(side * (lampX + 0.35), 2.2, z);
        arm.rotation.y = side > 0 ? Math.PI : 0;
        group.add(arm);
        const lamp = new THREE.Mesh(lampGeo, lampMat);
        lamp.position.set(side * (lampX + 0.7), 2.2, z);
        group.add(lamp);
      }
    }

    // Рекламные щиты каждые ~40м (CanvasTexture, как createGateTexture) — за трибунами.
    const billboardGeo = new THREE.PlaneGeometry(3.2, 2.0);
    const billboardX = 15.7 + 1.5;
    for (let z = 20; z < length; z += 40) {
      for (const side of [-1, 1]) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 160;
        const ctx = canvas.getContext('2d')!;
        const grad = ctx.createLinearGradient(0, 0, 0, 160);
        grad.addColorStop(0, '#0ea5e9');
        grad.addColorStop(1, '#7c3aed');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 256, 160);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 40px Orbitron, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('TOLPA', 128, 60);
        ctx.font = 'bold 22px Orbitron, sans-serif';
        ctx.fillStyle = '#fef08a';
        ctx.fillText('БЕГИ!', 128, 110);
        const tex = new THREE.CanvasTexture(canvas);
        tex.needsUpdate = true;
        const billMat = new THREE.MeshBasicMaterial({ map: tex });
        const bill = new THREE.Mesh(billboardGeo, billMat);
        bill.position.set(side * billboardX, 3.0, z);
        bill.rotation.y = side > 0 ? Math.PI : 0;
        group.add(bill);
        // Опоры щита
        const postGeo = new THREE.CylinderGeometry(0.08, 0.1, 3.0, 6);
        const postMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.3 });
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(side * billboardX, 1.5, z);
        group.add(post);
      }
    }

    // Флаги (покачивание sin) за дальним краем (за трибунами)
    const flagPoleGeo = new THREE.CylinderGeometry(0.04, 0.05, 2.6, 6);
    const flagPoleMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7, roughness: 0.4 });
    const flagGeo = new THREE.PlaneGeometry(0.9, 0.55);
    const flagMat = new THREE.MeshBasicMaterial({ color: accent, side: THREE.DoubleSide });
    const flagX = 15.7 + 2.5;
    for (let z = 15; z < length; z += 22) {
      for (const side of [-1, 1]) {
        const pole = new THREE.Mesh(flagPoleGeo, flagPoleMat);
        pole.position.set(side * flagX, 1.3, z);
        group.add(pole);
        const flag = new THREE.Mesh(flagGeo, flagMat);
        flag.position.set(side * flagX + side * 0.45, 2.3, z);
        flag.userData.phase = Math.random() * Math.PI * 2;
        flag.userData.baseX = flag.position.x;
        group.add(flag);
        this.flagMeshes.push(flag);
      }
    }

    // Дроны/транспорт (дрейф по X) за дальним краем (за трибунами)
    const droneGeo = new THREE.BoxGeometry(0.5, 0.12, 0.7);
    const droneMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.7 });
    const droneX = 15.7 + 3.5;
    for (let z = 30; z < length; z += 50) {
      const drone = new THREE.Mesh(droneGeo, droneMat);
      drone.position.set(droneX, 4.0 + Math.random() * 2.0, z);
      drone.userData.phase = Math.random() * Math.PI * 2;
      drone.userData.baseX = droneX;
      drone.userData.baseY = drone.position.y;
      drone.userData.speed = 0.5 + Math.random() * 0.8;
      group.add(drone);
      this.droneMeshes.push(drone);
    }
  }

  // Конструктор биомного фонового объекта (здание/скала/кристалл/колонна) без новых PointLight.
  private makeBiomeScenery(
    biome: BiomeType,
    accent: number,
    rnd: () => number
  ): THREE.Object3D {
    const group = new THREE.Group();
    switch (biome) {
      case 'cyber_city': {
        // Небоскрёб с сужающимся верхним ярусом и светящимися окнами
        const w = 1.0 + rnd() * 1.4;
        const d = 1.0 + rnd() * 1.4;
        const h = 4 + rnd() * 6;
        const towerGeo = new THREE.BoxGeometry(w, h, d);
        const towerMat = new THREE.MeshStandardMaterial({
          color: 0x1e293b,
          metalness: 0.6,
          roughness: 0.4,
          emissive: accent,
          emissiveIntensity: 0.25,
        });
        const tower = new THREE.Mesh(towerGeo, towerMat);
        tower.position.y = h / 2;
        group.add(tower);
        // окна-точки
        const winGeo = new THREE.BoxGeometry(w * 0.8, 0.06, 0.06);
        const winMat = new THREE.MeshBasicMaterial({ color: 0x67e8f9 });
        for (let wy = 0.5; wy < h - 0.5; wy += 1.1) {
          for (let wx = -1; wx <= 1; wx++) {
            const win = new THREE.Mesh(winGeo, winMat);
            win.position.set(wx * w * 0.3, wy, d / 2 + 0.01);
            group.add(win);
          }
        }
        // неоновая антенна
        const antGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.2, 4);
        const antMat = new THREE.MeshBasicMaterial({ color: accent });
        const ant = new THREE.Mesh(antGeo, antMat);
        ant.position.y = h + 1.1;
        ant.userData.animate = 'scenerySpin';
        ant.userData.spin = 'y';
        group.add(ant);
        // Верхний сужающийся ярус (пентхаус) — ритм этажности, читаемый силуэт
        if (rnd() < 0.7) {
          const tw = w * 0.55;
          const th = 1.6 + rnd() * 1.4;
          const tierGeo = new THREE.BoxGeometry(tw, th, d * 0.55);
          const tierMat = new THREE.MeshStandardMaterial({
            color: 0x1e293b,
            metalness: 0.6,
            roughness: 0.4,
            emissive: accent,
            emissiveIntensity: 0.35,
          });
          const tier = new THREE.Mesh(tierGeo, tierMat);
          tier.position.y = h + th / 2;
          group.add(tier);
          // Яркая полоса-подсветка на стыке ярусов (аддитивное свечение)
          const bandGeo = new THREE.BoxGeometry(w * 1.02, 0.08, d * 1.02);
          const bandMat = new THREE.MeshBasicMaterial({
            color: accent,
            transparent: true,
            opacity: 0.7,
          });
          const band = new THREE.Mesh(bandGeo, bandMat);
          band.position.y = h + 0.04;
          band.userData.animate = 'pulse';
          group.add(band);
          // Неоновая вывеска на фасаде пентхауса
          const signGeo = new THREE.BoxGeometry(tw * 0.7, 0.18, 0.04);
          const signMat = new THREE.MeshBasicMaterial({
            color: 0xfef08a,
            transparent: true,
            opacity: 0.85,
          });
          const sign = new THREE.Mesh(signGeo, signMat);
          sign.position.set(0, h + th - 0.3, d * 0.55 / 2 + 0.02);
          sign.userData.animate = 'pulse';
          group.add(sign);
        }
        break;
      }
      case 'magma_citadel': {
        // лавовые скалы с огненными прожилками
        const rockGeo = new THREE.DodecahedronGeometry(1.6 + rnd() * 1.8, 1);
        const rockMat = new THREE.MeshStandardMaterial({
          color: 0x451a03,
          roughness: 0.9,
          emissive: 0x7c2d12,
          emissiveIntensity: 0.5,
        });
        const rock = new THREE.Mesh(rockGeo, rockMat);
        rock.position.y = 1.6;
        group.add(rock);
        // светящаяся трещина-прожилка на скале
        if (rnd() < 0.8) {
          const crackGeo = new THREE.CylinderGeometry(0.05, 0.12, 1.2 + rnd() * 1.2, 5);
          const crackMat = new THREE.MeshBasicMaterial({
            color: 0xfb923c,
            transparent: true,
            opacity: 0.9,
          });
          const crack = new THREE.Mesh(crackGeo, crackMat);
          crack.position.set((rnd() - 0.5) * 1.2, 1.4 + rnd() * 0.6, (rnd() - 0.5) * 1.2);
          crack.rotation.z = (rnd() - 0.5) * 0.5;
          crack.userData.animate = 'pulse';
          group.add(crack);
        }
        // лавовые колонны
        const pillarGeo = new THREE.CylinderGeometry(0.5, 0.7, 3.5, 6);
        const pillarMat = new THREE.MeshBasicMaterial({
          color: 0xf97316,
          transparent: true,
          opacity: 0.5,
        });
        const pillar = new THREE.Mesh(pillarGeo, pillarMat);
        pillar.position.y = 1.75;
        pillar.userData.animate = 'pulse';
        group.add(pillar);
        // Базальтовая колонна-спутник (кластер «Дорога гигантов»)
        if (rnd() < 0.6) {
          const basGeo = new THREE.CylinderGeometry(0.4, 0.6, 2.6 + rnd() * 1.4, 6);
          const basMat = new THREE.MeshStandardMaterial({
            color: 0x2d1505,
            roughness: 0.9,
            emissive: 0x7c2d12,
            emissiveIntensity: 0.35,
          });
          const bas = new THREE.Mesh(basGeo, basMat);
          bas.position.set(1.4 + rnd() * 0.6, 1.3, (rnd() - 0.5) * 1.2);
          bas.rotation.z = (rnd() - 0.5) * 0.2;
          group.add(bas);
        }
        break;
      }
      case 'crystal_cavern': {
        // кристаллы
        for (let i = 0; i < 3; i++) {
          const cGeo = new THREE.ConeGeometry(0.4 + rnd() * 0.5, 3 + rnd() * 3, 5);
          const cMat = new THREE.MeshStandardMaterial({
            color: 0x10b981,
            metalness: 0.3,
            roughness: 0.2,
            emissive: accent,
            emissiveIntensity: 0.5,
            transparent: true,
            opacity: 0.9,
          });
          const crystal = new THREE.Mesh(cGeo, cMat);
          crystal.position.set((rnd() - 0.5) * 3, 1.5 + rnd() * 1.5, (rnd() - 0.5) * 2);
          crystal.rotation.y = rnd() * Math.PI;
          group.add(crystal);
        }
        // Внутреннее светящееся ядро-друза (пульсирует)
        const coreGeo = new THREE.OctahedronGeometry(0.7 + rnd() * 0.4, 0);
        const coreMat = new THREE.MeshBasicMaterial({
          color: 0x6ee7b7,
          transparent: true,
          opacity: 0.85,
        });
        const core = new THREE.Mesh(coreGeo, coreMat);
        core.position.set((rnd() - 0.5) * 1.2, 1.4 + rnd() * 1.0, (rnd() - 0.5) * 1.0);
        core.userData.animate = 'pulse';
        group.add(core);
        // Парящий осколок-спутник с микролевитацией (bob)
        if (rnd() < 0.6) {
          const shardGeo = new THREE.OctahedronGeometry(0.3 + rnd() * 0.3, 0);
          const shardMat = new THREE.MeshBasicMaterial({
            color: accent,
            transparent: true,
            opacity: 0.7,
          });
          const shard = new THREE.Mesh(shardGeo, shardMat);
          shard.position.set(1.6 + rnd() * 1.0, 3.0 + rnd() * 1.5, (rnd() - 0.5) * 1.5);
          shard.userData.animate = 'orb';
          shard.userData.baseY = shard.position.y;
          group.add(shard);
        }
        break;
      }
      case 'quantum_void':
      case 'celestial_core': {
        // парящие энерго-монолиты / колонны
        const monoGeo = new THREE.BoxGeometry(1.4, 5 + rnd() * 4, 1.4);
        const monoMat = new THREE.MeshStandardMaterial({
          color: biome === 'quantum_void' ? 0x180f2d : 0x241d0c,
          metalness: 0.4,
          roughness: 0.3,
          emissive: accent,
          emissiveIntensity: 0.45,
        });
        const mono = new THREE.Mesh(monoGeo, monoMat);
        mono.position.y = 2.5;
        group.add(mono);
        // Средний сегмент (зазор) — эффект «разорванного» монолита
        const segH = 1.2 + rnd() * 0.8;
        const segGeo = new THREE.BoxGeometry(1.1, segH, 1.1);
        const segMat = new THREE.MeshStandardMaterial({
          color: monoMat.color,
          metalness: 0.4,
          roughness: 0.3,
          emissive: accent,
          emissiveIntensity: 0.5,
        });
        const seg = new THREE.Mesh(segGeo, segMat);
        seg.position.y = 6.0 + rnd() * 1.0;
        seg.rotation.y = (rnd() - 0.5) * 0.5;
        seg.userData.animate = 'scenerySpin';
        seg.userData.spin = 'y';
        group.add(seg);
        // кольцо вокруг монолита
        const ringGeo = new THREE.TorusGeometry(1.3, 0.09, 6, 18);
        const ringMat = new THREE.MeshBasicMaterial({
          color: accent,
          transparent: true,
          opacity: 0.6,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.y = 3.5;
        ring.userData.animate = 'scenerySpin';
        ring.userData.spin = 'y';
        group.add(ring);
        // второе наклонное кольцо (двойной гимбал)
        if (rnd() < 0.7) {
          const ring2Geo = new THREE.TorusGeometry(1.7, 0.06, 6, 18);
          const ring2Mat = new THREE.MeshBasicMaterial({
            color: accent,
            transparent: true,
            opacity: 0.4,
          });
          const ring2 = new THREE.Mesh(ring2Geo, ring2Mat);
          ring2.position.y = 3.5;
          ring2.rotation.x = Math.PI / 2;
          ring2.userData.animate = 'scenerySpin';
          ring2.userData.spin = 'x';
          group.add(ring2);
        }
        // орбитальные спутники-осколки вокруг монолита
        if (rnd() < 0.7) {
          const satGeo = new THREE.IcosahedronGeometry(0.22, 0);
          const satMat = new THREE.MeshBasicMaterial({ color: accent });
          for (let s = 0; s < 3; s++) {
            const sat = new THREE.Mesh(satGeo, satMat);
            const ang = (s / 3) * Math.PI * 2 + rnd() * 0.5;
            sat.position.set(Math.cos(ang) * 2.1, 2.5 + Math.sin(ang * 2) * 0.6, Math.sin(ang) * 2.1);
            sat.userData.animate = 'orbital';
            sat.userData.baseX = sat.position.x;
            sat.userData.baseY = sat.position.y;
            sat.userData.baseZ = sat.position.z;
            sat.userData.angle = ang;
            group.add(sat);
          }
        }
        break;
      }
      default:
        break;
    }
    return group;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isPaused = false;
    this.lastTime = performance.now();
    perfMonitor.reset(); // иначе первое измерение после паузы посчитает время простоя
    this.reqId = requestAnimationFrame(this.animate);
  }

  /** Полная остановка цикла (используется при завершении забега и dispose). */
  private stopLoop(): void {
    this.isRunning = false;
    if (this.reqId !== null) {
      cancelAnimationFrame(this.reqId);
      this.reqId = null;
    }
  }

  /** @deprecated используйте setPaused(true) или dispose() — оставлено для обратной совместимости. */
  public pause(): void {
    this.stopLoop();
  }

  /** Настоящая пауза: цикл останавливается, но состояние забега (runEnded/currentLevel) не трогается. */
  public setPaused(paused: boolean): void {
    if (this.runEnded || this.isPaused === paused) return;
    this.isPaused = paused;
    if (paused) {
      this.stopLoop();
      this.releaseInput();
      soundEngine.setBgmVolume(0);
    } else {
      soundEngine.setBgmVolume(stateManager.getState().settings.musicVolume);
      this.start();
    }
  }

  public tryActivateAdrenaline(): boolean {
    if (this.crowd.isHyperMode) return false;
    if (this.adrenalineCharge < 100) return false;
    this.adrenalineCharge = 0;
    this.crowd.activateHyperMode();
    return true;
  }

  private animate(now: number): void {
    if (!this.isRunning) return;

    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    // Clamp delta time to avoid large physics steps
    dt = Math.min(0.05, Math.max(0.001, dt));

    this.update(dt);
    this.render();

    perfMonitor.update();
    perfMonitor.setDrawCalls(this.renderer.info.render.calls);
    this.updateAdaptiveResolution(dt);

    // Гонка rAF: update() может было остановить цикл (pause()/победа/поражение) внутри
    // этого же кадра — не планировать следующий rAF, если это произошло.
    if (this.isRunning) {
      this.reqId = requestAnimationFrame(this.animate);
    }
  }

  private endRun(win: boolean, score: number = 0, mult: number = 1, mobs: number = 0): void {
    if (this.runEnded) return;
    this.runEnded = true;
    this.stopLoop();
    // Забег окончен — гасим крики трибун, чтобы не висели после выхода.
    soundEngine.stopCrowdCheer();
    // Снимок статистики забега ДО commitRun() — тот обнуляет run, а нам нужно
    // показать детали (макс. комбо, макс. толпа, сломанные препятствия) на экране итогов.
    const runStats: RunStats = stateManager.getRun() || {
      coins: 0, mobsSpawned: 0, gatesPassed: 0, obstaclesSmashed: 0,
      bossesDefeated: 0, bossCoins: 0, bossGems: 0, maxCombo: 0, maxCrowd: 0,
      distance: 0, nearMisses: 0, nearMissStreak: 0, maxNearMissStreak: 0,
    };
    // Откатываем активные эффекты событий (ЭМИ-шторм, множители скорости), чтобы они
    // не протекли в следующий забег.
    if (this.gates.isEmpActive()) this.gates.clearEmpStorm();
    this.resetEventState();
    stateManager.commitRun();
    if (win) {
      this.onLevelWinCb?.(score, mult, mobs, runStats);
    } else {
      this.onLevelLoseCb?.(runStats);
    }
  }

  /** Сбрасывает состояние динамических событий (очередь, активное событие, множители). */
  private resetEventState(): void {
    this.pendingEvents = [];
    this.nextEventIndex = 0;
    if (this.gates.isEmpActive()) this.gates.clearEmpStorm();
    this.activeEvent = null;
    this.eventSpeedMult = 1.0;
    this.meteorAccum = 0;
    this.eventFxAccum = 0;
  }

  /**
   * Цвет частиц speed-trail за толпой. В hyper mode — усиленный золотой;
   * иначе — цвет/акцент снаряжённого трейла игрока.
   */
  private trailColorForState(): number {
    if (this.crowd.isHyperMode) return 0xfacc15;
    switch (stateManager.getState().equippedTrail) {
      case 'fire': return 0xff4400;
      case 'matrix': return 0x00ff66;
      case 'rainbow': return 0x9933ff;
      case 'lightning': return 0x38bdf8;
      case 'stars': return 0xfacc15;
      case 'glow':
      default: return 0x00f0ff;
    }
  }

  /** Обновляет динамические события уровня: триггерит новые по leaderZ и тикает активные. */
  private updateDynamicEvents(dt: number): void {
    const trackWidth = this.currentLevel?.trackWidth || DEFAULT_TRACK_WIDTH;

    // Триггер нового события, когда толпа достигла triggerZ. В endless-режиме события пропускаются.
    if (!this.isEndless && this.pendingEvents.length > 0) {
      while (this.nextEventIndex < this.pendingEvents.length) {
        const evt = this.pendingEvents[this.nextEventIndex];
        if (this.crowd.leaderZ < evt.triggerZ) break;
        this.nextEventIndex++;
        this.triggerEvent(evt, trackWidth);
      }
    }

    // Тик активного события.
    if (this.activeEvent) {
      const { event, timer } = this.activeEvent;
      const newTimer = timer - dt;

      if (event.type === 'meteor_rain') {
        // Метеоритный дождь: периодические взрывы по краям трассы, малый шанс урона толпе.
        this.meteorAccum += dt;
        if (this.meteorAccum >= 0.8 / Math.max(0.5, event.intensity)) {
          this.meteorAccum = 0;
          const half = trackWidth / 2 - 1;
          const mx = (Math.random() - 0.5) * 2 * half;
          const mz = this.crowd.leaderZ + Math.random() * 18;
          this.particles.emitBurst(mx, 3.0, mz, 14, 0xf97316, 6.0);
          if (Math.random() < 0.35) {
            const killCount = Math.min(2 + Math.floor(event.intensity), Math.floor(this.crowd.getAliveCount() * 0.12));
            if (killCount > 0) this.crowd.killMobs(killCount, 'obstacle');
            soundEngine.playSound('boss_slam');
          }
        }
      } else if (event.type === 'ambush') {
        // Засада: периодические красные вспышки позади толпы (замедление уже применено).
        this.eventFxAccum += dt;
        if (this.eventFxAccum >= 0.4) {
          this.eventFxAccum = 0;
          this.particles.emitBurst(
            this.crowd.leaderX + (Math.random() - 0.5) * 3,
            1.0,
            this.crowd.leaderZ - 3 - Math.random() * 3,
            8,
            0xef4444,
            3.5
          );
        }
      }

      if (newTimer <= 0) {
        this.cleanupEvent(event);
        this.activeEvent = null;
      } else {
        this.activeEvent.timer = newTimer;
      }
    }
  }

  /** Запускает событие: применяет стартовые эффекты, эмитит алерт в HUD, звук. */
  private triggerEvent(evt: LevelDynamicEvent, trackWidth: number): void {
    this.activeEvent = { event: evt, timer: evt.duration };

    switch (evt.type) {
      case 'speed_boost':
        this.eventSpeedMult = Math.min(1.5, 1 + 0.25 * evt.intensity);
        soundEngine.playSound('adrenaline_whoosh');
        this.particles.emitBurst(this.crowd.leaderX, 1.0, this.crowd.leaderZ, 20, 0x00f0ff, 4.0);
        break;
      case 'ambush':
        this.eventSpeedMult = 0.55;
        soundEngine.playSound('boss_roar');
        eventBus.emit('screenShake', { intensity: 0.25 });
        this.particles.emitBurst(this.crowd.leaderX, 1.0, this.crowd.leaderZ, 20, 0xef4444, 5.0);
        break;
      case 'coin_train': {
        // Золотой караван: кластер монет дугой впереди по текущей полосе.
        soundEngine.playSound('coin_pickup');
        const cluster: CoinData[] = [];
        const startZ = this.crowd.leaderZ + 45;
        for (let i = 0; i < 10; i++) {
          cluster.push({
            id: `evt_coin_${this.nextEventIndex}_${i}`,
            x: this.crowd.leaderX + (Math.random() - 0.5) * 3,
            y: 0.5,
            z: startZ + i * 3,
            value: 10,
          });
        }
        this.obstacles.appendObstacles([], cluster);
        // Монеты спавнятся сразу — событие мгновенно завершается.
        this.cleanupEvent(evt);
        this.activeEvent = null;
        break;
      }
      case 'emp_storm':
        this.gates.applyEmpStorm();
        soundEngine.playSound('boss_laser');
        this.particles.emitBurst(this.crowd.leaderX, 2.0, this.crowd.leaderZ, 20, 0xa855f7, 5.0);
        break;
      case 'meteor_rain':
        soundEngine.playSound('boss_slam');
        this.particles.emitBurst(this.crowd.leaderX, 3.0, this.crowd.leaderZ + 10, 16, 0xf97316, 6.0);
        break;
    }

    // Алерт в HUD.
    eventBus.emit('levelEvent', { type: evt.type });
  }

  /** Откатывает эффекты события по его окончании. */
  private cleanupEvent(evt: LevelDynamicEvent): void {
    switch (evt.type) {
      case 'speed_boost':
      case 'ambush':
        this.eventSpeedMult = 1.0;
        break;
      case 'emp_storm':
        if (this.gates.isEmpActive()) this.gates.clearEmpStorm();
        break;
    }
  }

  private update(dt: number): void {
    const trackWidth = this.currentLevel?.trackWidth || DEFAULT_TRACK_WIDTH;

    // Keyboard & Pointer Steering.
    // Камера смотрит вдоль +Z (см. camera.lookAt ниже), поэтому мировой правый вектор
    // камеры — это -X: экранное "вправо" достигается УМЕНЬШЕНИЕМ leaderX. Раньше клавиша
    // D увеличивала leaderX и толпа визуально ехала влево — знаки здесь намеренно
    // противоположны наивному "D = вправо = +1".
    const settings = stateManager.getState().settings;
    const invertMult = settings.invertX ? -1 : 1;

    if (this.keyLeft && !this.keyRight) {
      this.steerInput = clamp(1.0 * invertMult * settings.controlsSensitivity, -1, 1);
    } else if (this.keyRight && !this.keyLeft) {
      this.steerInput = clamp(-1.0 * invertMult * settings.controlsSensitivity, -1, 1);
    } else if (!this.isPointerDown) {
      this.steerInput = 0;
    } else {
      // Указатель зажат, но новых mousemove/touchmove в этом кадре не было — плавно
      // гасим импульс, чтобы толпа не ехала вбок до упора на затёкшем свайпе.
      this.steerInput *= Math.pow(0.001, dt);
    }

    // Update Crowd. eventSpeedMult — временный множитель скорости от динамических
    // событий (speed_boost ускоряет, ambush замедляет).
    this.crowd.update(dt, this.baseSpeed * this.eventSpeedMult, this.steerInput, trackWidth);

    // Пройденная дистанция забега (метры) — обновляем по leaderZ, чтобы в Бесконечном
    // режиме было чем побить рекорд. leaderZ монотонно растёт вдоль +Z (1 unit = 1 м).
    stateManager.runRecordDistance(Math.max(0, Math.round(this.crowd.leaderZ)));

    // Speed-trail particles behind the crowd in hyper mode / arrow formation / speed_boost — pure juice
    if (this.crowd.isHyperMode || this.crowd.formation === 'arrow' || this.activeEvent?.event.type === 'speed_boost') {
      this.trailAccum += dt;
      if (this.trailAccum >= 0.05) {
        this.trailAccum = 0;
        this.particles.emitBurst(
          this.crowd.leaderX + (Math.random() - 0.5) * 2,
          0.4 + Math.random() * 0.6,
          this.crowd.leaderZ - 2 - Math.random() * 2,
          2,
          this.trailColorForState(),
          2.5
        );
      }
    }

    // Update Sub-systems
    this.gates.update(dt, this.crowd, this.particles);
    this.walls.update(dt, this.crowd, this.particles);
    this.bonus.update(dt, this.crowd, this.particles);
    this.obstacles.update(dt, this.crowd, this.particles);
    this.boss.update(dt, this.crowd, this.particles);
    this.particles.update(dt);

    // Динамические события уровня (триггер по leaderZ + тик активных эффектов).
    this.updateDynamicEvents(dt);

    if (!this.isEndless) {
      this.finishLine.update(dt, this.crowd, this.particles, (finalScore, finalMult, remainingMobs) => {
        // Праздничное конфетти над финишной чертой при победе.
        this.particles.emitConfetti(this.crowd.leaderX, 2.0, this.crowd.leaderZ, 60);
        this.particles.emitLightPillar(this.crowd.leaderX, this.crowd.leaderZ, 40, 0xfacc15);
        // Трибуны ликуют на финише.
        soundEngine.playCrowdCheer(1.0);
        this.endRun(true, finalScore, finalMult, remainingMobs);
      });
    } else {
      this.updateEndlessStreaming();
    }

    // Check Defeat Condition (all mobs died). Стоит ПОСЛЕ апдейта подсистем и частиц,
    // чтобы партиклы гибели последнего моба реально успели отрисоваться хотя бы кадр,
    // и с небольшой грейс-паузой, чтобы игрок увидел, от чего умер, а не увидел сразу
    // экран поражения на том же кадре.
    if (this.crowd.getAliveCount() <= 0 && !this.runEnded) {
      if (this.deathGrace === 0) {
        soundEngine.playSound('level_lose');
        eventBus.emit('screenShake', { intensity: 0.7 });
        this.particles.emitBurst(this.crowd.leaderX, 1.0, this.crowd.leaderZ, 40, 0xef4444, 6.0);
      }
      this.deathGrace += dt;
      if (this.deathGrace >= 0.9) {
        this.endRun(false);
        return;
      }
    }

    // Update Camera Follow.
    // Упреждающая компенсация скорости: вместо того чтобы камера реактивно
    // подтягивалась лерпом ПОСЛЕ того как толпа уже ускорилась (гипер-режим,
    // формация "стрела"), считаем целевую дистанцию сразу с учётом текущего
    // множителя скорости — камера заранее отъезжает дальше.
    const speedMult = (this.crowd.isHyperMode ? 1.4 : this.crowd.formation === 'arrow' ? 1.15 : 1.0) * this.eventSpeedMult;
    const speedLag = (speedMult - 1) * this.baseSpeed;
    const targetCamX = this.crowd.leaderX * 0.4;
    const targetCamZ = this.crowd.leaderZ - (GameEngine.CAMERA_BASE_DISTANCE + speedLag);
    this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, targetCamX, 10 * dt);
    this.camera.position.z = THREE.MathUtils.lerp(this.camera.position.z, targetCamZ, 12 * dt);
    this.camera.position.y = GameEngine.CAMERA_HEIGHT;

    // Apply Screen Shake
    if (this.screenShakeIntensity > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.screenShakeIntensity * 0.8;
      this.camera.position.y += (Math.random() - 0.5) * this.screenShakeIntensity * 0.8;
      this.screenShakeIntensity = Math.max(0, this.screenShakeIntensity - dt * 3.0);
    }

    this.camera.lookAt(
      this.crowd.leaderX * 0.2,
      GameEngine.CAMERA_LOOKAT_HEIGHT,
      this.crowd.leaderZ + GameEngine.CAMERA_LOOKAT_LEAD
    );

    // Animate floating energy orbs (bob + gentle spin), rings, biome scenery
    // (scenerySpin), pulse columns, pylon light-wave and monolith orbitals.
    // Итерируем ПЛОСКИЙ список decorAnimated (собран рекурсивно при постройке),
    // а не decorGroup.children — иначе вложенные меши внутри биомных групп
    // (антенны в башнях, кольца монолитов) не анимировались бы. 0-GC в кадре.
    if (this.decorGroup) {
      const t = performance.now() * 0.001;
      const list = this.decorAnimated;
      for (let i = 0; i < list.length; i++) {
        const child = list[i];
        const tag = child.userData.animate;
        if (tag === 'orb') {
          child.position.y = (child.userData.baseY ?? 2.6) + Math.sin(t * 1.5 + child.position.z) * 0.25;
          child.rotation.y += dt * 0.8;
        } else if (tag === 'ring') {
          // Прожекторные кольца: вращение вокруг выбранной оси + лёгкое покачивание
          const axis = child.userData.axis ?? 'y';
          if (axis === 'z') child.rotation.z += dt * 1.6;
          else child.rotation.y += dt * 1.6;
          child.position.y = (child.userData.baseY ?? 5.5) + Math.sin(t * 1.2 + child.position.z) * 0.2;
        } else if (tag === 'scenerySpin') {
          // Вращение фоновых объектов (кольца монолитов, антенны, сегменты)
          const axis = child.userData.spin ?? 'y';
          if (axis === 'x') child.rotation.x += dt * 0.5;
          else child.rotation.y += dt * 0.5;
        } else if (tag === 'pulse') {
          // Пульсация прозрачных мешей (лавовые колонны, кристалл-ядро, полосы).
          // Стандартный материал — пульсируем emissiveIntensity; Basic — opacity.
          const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial | undefined;
          if (mat) {
            if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
              (mat as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + Math.abs(Math.sin(t * 2 + child.position.z)) * 0.45;
            } else {
              mat.opacity = 0.3 + Math.abs(Math.sin(t * 2 + child.position.z)) * 0.4;
            }
          }
        } else if (tag === 'pylonWave') {
          // Бегущая световая волна по пилонам: модуляция emissiveIntensity по Z.
          // Волна «едет» вдоль дорожки (фаза смещается с ростом t).
          const baseZ = child.userData.baseZ ?? child.position.z;
          const m = (child as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
          if (m) {
            const wave = Math.sin(t * 4.0 - baseZ * 0.18);
            m.emissiveIntensity = 0.35 + (wave * 0.5 + 0.5) * 0.65;
          }
        } else if (tag === 'orbital') {
          // Орбитальные осколки вокруг монолита — вращение по эллипсу
          const bx = (child.userData.baseX as number) ?? 0;
          const by = (child.userData.baseY as number) ?? 0;
          const bz = (child.userData.baseZ as number) ?? 0;
          const a = (child.userData.angle as number) ?? 0;
          const ang = a + t * 0.8;
          child.position.set(bx + Math.cos(ang) * 2.1, by + Math.sin(ang * 2) * 0.6, bz + Math.sin(ang) * 2.1);
        }
      }
    }

    // Спецэффект декора: периодические «искры» с верхушек биомных объектов.
    // 0-GC: якоря предаллоцированы в decorFxAnchors, эмиссия через ParticleSystem.
    // Эмитируем только в окне вокруг лидера, чтобы не спавнить невидимые частицы далеко.
    if (this.decorFxAnchors.length >= 3) {
      this.decorFxAccum += dt;
      if (this.decorFxAccum >= 0.35) {
        this.decorFxAccum = 0;
        const count = this.decorFxAnchors.length / 3;
        if (count > 0) {
          const idx = Math.floor(Math.random() * count) * 3;
          const ax = this.decorFxAnchors[idx];
          const ay = this.decorFxAnchors[idx + 1];
          const az = this.decorFxAnchors[idx + 2];
          const dzf = Math.abs(az - this.crowd.leaderZ);
          // Эмитируем только рядом с камерой/толпой (влияние спецэффектов ниже вдали).
          if (dzf < 80) {
            this.particles.emitBurst(ax, ay, az, 2, 0x67e8f9, 1.6, 1.2);
          }
        }
      }
    }

    // Анимация зрителей (прыжки, качание, махание руками) + световые лучи, флаги, дроны.
    this.animateSpectators(dt);
    this.animateBeamsFlagsDrones(dt);

    // Update Light Position to follow crowd
    this.dirLight.position.set(this.crowd.leaderX + 15, 30, this.crowd.leaderZ + 15);
    this.dirLight.target.position.set(this.crowd.leaderX, 0, this.crowd.leaderZ + 10);
    this.dirLight.target.updateMatrixWorld();

    // Адреналин заряжается сам собой (плюс бонусы за ворота из подписки в конструкторе)
    this.adrenalineCharge = Math.min(100, this.adrenalineCharge + 8 * dt);
  }

  // Анимация зрителей: прыжки (sin по Y), качание (rotation.z), махание руками
  // (отдельные InstancedMesh рук), голова и лайтстик. При приближении толпы игрока
  // (leaderZ близко к трибуне) частота/амплитуда удваиваются. Эффект «стадионной
  // волны» (Mexican Wave) — фазовый сдвиг по Z. 0-GC: только предаллоцированные dummy.
  private animateSpectators(dt: number): void {
    if (!this.spectatorMesh || !this.spectatorArmMesh || !this.spectatorArm2Mesh || !this.spectatorHeadMesh || !this.spectatorGlowMesh || this.spectatorCount === 0) return;
    const t = performance.now() * 0.001;
    const leaderZ = this.crowd.leaderZ;
    const count = this.spectatorCount;
    const data = this.spectatorData;
    const vis = this.spectatorVisibility;
    // Окно видимости по Z вокруг лидера: зрители вне его не анимируются и скрыты
    // (scale 0), чтобы не жечь CPU/GPU вдали от камеры. Запас на поворот/рывки.
    const loZ = leaderZ - GameEngine.SPECTATOR_WINDOW_BACK;
    const hiZ = leaderZ + GameEngine.SPECTATOR_WINDOW_AHEAD;
    let bodyChanged = false;
    let armChanged = false;
    let arm2Changed = false;
    let headChanged = false;
    let glowChanged = false;

    for (let i = 0; i < count; i++) {
      const o = i * 12;
      const bx = data[o];
      const by = data[o + 1];
      const bz = data[o + 2];
      const inWindow = bz > loZ && bz < hiZ;
      const wasActive = vis[i] !== 0;

      if (!inWindow) {
        // Вне окна: анимируем/обновляем только в момент пересечения границы (скрываем).
        if (wasActive) {
          // Прячем: scale 0 один раз, дальше кадр не трогаем.
          this.spectatorDummy.position.set(bx, -100, bz);
          this.spectatorDummy.rotation.set(0, 0, 0);
          this.spectatorDummy.scale.setScalar(0);
          this.spectatorDummy.updateMatrix();
          this.spectatorMesh.setMatrixAt(i, this.spectatorDummy.matrix);
          bodyChanged = true;

          this.spectatorHeadDummy.position.set(bx, -100, bz);
          this.spectatorHeadDummy.rotation.set(0, 0, 0);
          this.spectatorHeadDummy.scale.setScalar(0);
          this.spectatorHeadDummy.updateMatrix();
          this.spectatorHeadMesh.setMatrixAt(i, this.spectatorHeadDummy.matrix);
          headChanged = true;

          this.spectatorArmDummy.position.set(bx, -100, bz);
          this.spectatorArmDummy.rotation.set(0, 0, 0);
          this.spectatorArmDummy.scale.setScalar(0);
          this.spectatorArmDummy.updateMatrix();
          this.spectatorArmMesh.setMatrixAt(i, this.spectatorArmDummy.matrix);
          armChanged = true;

          this.spectatorArm2Dummy.position.set(bx, -100, bz);
          this.spectatorArm2Dummy.rotation.set(0, 0, 0);
          this.spectatorArm2Dummy.scale.setScalar(0);
          this.spectatorArm2Dummy.updateMatrix();
          this.spectatorArm2Mesh.setMatrixAt(i, this.spectatorArm2Dummy.matrix);
          arm2Changed = true;

          this.spectatorGlowDummy.position.set(bx, -100, bz);
          this.spectatorGlowDummy.rotation.set(0, 0, 0);
          this.spectatorGlowDummy.scale.setScalar(0);
          this.spectatorGlowDummy.updateMatrix();
          this.spectatorGlowMesh.setMatrixAt(i, this.spectatorGlowDummy.matrix);
          glowChanged = true;

          vis[i] = 0;
        }
        continue;
      }

      // Внутри окна — полная анимация (как было).
      const phase = data[o + 3];
      const freq = data[o + 4];
      const amp = data[o + 5];
      const armPhase = data[o + 6];
      const armFreq = data[o + 7];
      const side = data[o + 8];
      const baseRotZ = data[o + 9];
      const armBaseX = data[o + 10];
      const armBaseY = data[o + 11];

      // Реакция на близость толпы: в радиусе ~14м удваиваем частоту и амплитуду.
      const dz = Math.abs(bz - leaderZ);
      const hype = dz < 14 ? 2.0 : 1.0;

      // «Стадионная волна» — фазовый сдвиг по Z, бегущая вдоль трибуны.
      const wave = bz * 0.35 + t * 2.5;

      const jump = Math.sin(t * freq * hype + phase + wave) * amp * hype;
      const sway = Math.sin(t * freq * 0.5 + phase + wave) * 0.12 * hype;
      const faceYaw = side < 0 ? Math.PI / 2 : -Math.PI / 2;

      // Тело: прыжок по Y + лёгкое качание вокруг Z.
      this.spectatorDummy.position.set(bx, by + jump, bz);
      this.spectatorDummy.rotation.set(0, faceYaw, baseRotZ + sway);
      this.spectatorDummy.scale.setScalar(0.9);
      this.spectatorDummy.updateMatrix();
      this.spectatorMesh.setMatrixAt(i, this.spectatorDummy.matrix);
      bodyChanged = true;

      // Голова (следует за телом)
      this.spectatorHeadDummy.position.set(bx, by + 1.35 * 0.9 + jump, bz);
      this.spectatorHeadDummy.rotation.set(0, faceYaw, 0);
      this.spectatorHeadDummy.scale.setScalar(0.9);
      this.spectatorHeadDummy.updateMatrix();
      this.spectatorHeadMesh.setMatrixAt(i, this.spectatorHeadDummy.matrix);
      headChanged = true;

      // Рука 1: машет вверх-вниз вокруг Z (ось у плеча).
      const armSwing = Math.sin(t * armFreq * hype + armPhase + wave) * 1.1 * hype;
      this.spectatorArmDummy.position.set(bx + armBaseX, by + armBaseY + jump, bz);
      this.spectatorArmDummy.rotation.set(0, faceYaw, armSwing);
      this.spectatorArmDummy.scale.setScalar(0.9);
      this.spectatorArmDummy.updateMatrix();
      this.spectatorArmMesh.setMatrixAt(i, this.spectatorArmDummy.matrix);
      armChanged = true;

      // Рука 2: зеркальная, машет в противофазе.
      const armSwing2 = Math.sin(t * armFreq * hype + armPhase + Math.PI + wave) * 1.1 * hype;
      this.spectatorArm2Dummy.position.set(bx - armBaseX, by + armBaseY + jump, bz);
      this.spectatorArm2Dummy.rotation.set(0, faceYaw, armSwing2);
      this.spectatorArm2Dummy.scale.setScalar(0.9);
      this.spectatorArm2Dummy.updateMatrix();
      this.spectatorArm2Mesh.setMatrixAt(i, this.spectatorArm2Dummy.matrix);
      arm2Changed = true;

      // Лайтстик на кончике руки 1 (следует за рукой).
      this.spectatorGlowDummy.position.set(bx + armBaseX, by + armBaseY + 0.5 * 0.9 + jump, bz);
      this.spectatorGlowDummy.rotation.set(0, faceYaw, armSwing);
      this.spectatorGlowDummy.scale.setScalar(0.9);
      this.spectatorGlowDummy.updateMatrix();
      this.spectatorGlowMesh.setMatrixAt(i, this.spectatorGlowDummy.matrix);
      glowChanged = true;

      vis[i] = 1;
    }

    // Выставляем needsUpdate только если в этом кадре реально меняли матрицы.
    if (bodyChanged) this.spectatorMesh.instanceMatrix.needsUpdate = true;
    if (armChanged) this.spectatorArmMesh.instanceMatrix.needsUpdate = true;
    if (arm2Changed) this.spectatorArm2Mesh.instanceMatrix.needsUpdate = true;
    if (headChanged) this.spectatorHeadMesh.instanceMatrix.needsUpdate = true;
    if (glowChanged) this.spectatorGlowMesh.instanceMatrix.needsUpdate = true;
  }

  // Световые лучи (покачивание), флаги (sin-волна) и дроны (дрейф по X). 0-GC.
  private animateBeamsFlagsDrones(dt: number): void {
    const t = performance.now() * 0.001;

    for (let i = 0; i < this.beamMeshes.length; i++) {
      const beam = this.beamMeshes[i];
      const baseY = (beam.userData.baseY as number) ?? 4.5;
      const phase = (beam.userData.phase as number) ?? 0;
      beam.position.y = baseY + Math.sin(t * 0.8 + phase) * 0.4;
      beam.rotation.z += Math.sin(t * 0.5 + phase) * dt * 0.3;
    }

    for (let i = 0; i < this.flagMeshes.length; i++) {
      const flag = this.flagMeshes[i];
      const phase = (flag.userData.phase as number) ?? 0;
      const baseX = (flag.userData.baseX as number) ?? flag.position.x;
      flag.rotation.y = Math.sin(t * 2.2 + phase) * 0.35;
      flag.position.x = baseX + Math.sin(t * 2.2 + phase) * 0.12;
    }

    for (let i = 0; i < this.droneMeshes.length; i++) {
      const drone = this.droneMeshes[i];
      const phase = (drone.userData.phase as number) ?? 0;
      const baseX = (drone.userData.baseX as number) ?? drone.position.x;
      const baseY = (drone.userData.baseY as number) ?? 4.0;
      const speed = (drone.userData.speed as number) ?? 0.6;
      drone.position.x = baseX + Math.sin(t * speed + phase) * 1.5;
      drone.position.y = baseY + Math.sin(t * 1.3 + phase) * 0.3;
      drone.rotation.z = Math.sin(t * speed + phase) * 0.15;
    }
  }

  private updateEndlessStreaming(): void {
    // Раньше генерировался ровно один сегмент на 120м и дальше была пустота без
    // финиша и без возможности проиграть за пределами трассы. Догенерируем сегменты
    // по мере приближения игрока к концу текущего.
    if (this.crowd.leaderZ > this.currentEndlessZ - 150) {
      this.endlessSegmentIndex++;
      const seg = LevelGenerator.generateEndlessSegment(this.endlessSegmentIndex, this.currentEndlessZ);
      this.gates.appendGates(seg.gates);
      this.walls.appendWalls(seg.walls);
      this.bonus.appendBonuses(seg.bonuses);
      this.obstacles.appendObstacles(seg.obstacles, seg.coins);
      this.currentEndlessZ += seg.length;
    }
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  public setFormation(f: FormationType): void {
    this.crowd.setFormation(f);
  }

  /** Вызывается кнопкой АДРЕНАЛИН в HUD — тот же гейт по заряду, что и у пробела. */
  public activateAdrenaline(): void {
    this.tryActivateAdrenaline();
  }

  public getHudSnapshot(): HudSnapshot {
    const len = this.currentLevel?.trackLength ?? 1;
    const bossArenaZ = this.currentLevel?.boss ? this.currentLevel.trackLength - 20 : -1;
    return {
      crowd: this.crowd.getAliveCount(),
      coins: stateManager.getRunCoins(),
      isHyper: this.crowd.isHyperMode,
      adrenalineCharge: this.adrenalineCharge,
      progress: this.isEndless ? 0 : clamp(this.crowd.leaderZ / len, 0, 1),
      metersLeft: this.isEndless ? -1 : Math.max(0, Math.round(len - this.crowd.leaderZ)),
      bossProgress: bossArenaZ > 0 ? clamp(bossArenaZ / len, 0, 1) : -1,
      bossDistance: bossArenaZ > 0 ? Math.max(0, Math.round(bossArenaZ - this.crowd.leaderZ)) : -1,
      nextHazardDistance: this.obstacles.getNextHazardDistance(this.crowd.leaderZ),
      distanceTraveled: Math.max(0, Math.round(this.crowd.leaderZ)),
      fps: perfMonitor.getFPS(),
      drawCalls: perfMonitor.getDrawCalls(),
      finishMultiplier: this.finishLine.finalMultiplier,
      finishStepsDone: this.finishLine.getFinishStepsDone(),
      finishStepsTotal: this.finishLine.getFinishStepsTotal(),
      isFinishActive: this.finishLine.hasCrossedFinish,
      nearMissStreak: this.obstacles.getNearMissStreak(),
      nearMissMultiplier: getNearMissMultiplier(this.obstacles.getNearMissStreak()),
    };
  }

  /** Проецирует мировую точку в пиксели контейнера — используется для флоатинг-текста в HUD. */
  public projectToScreen(x: number, y: number, z: number): { x: number; y: number } {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
  }

  public dispose(): void {
    this.stopLoop();
    soundEngine.stopCrowdCheer();

    // Если забег так и не завершился явно (например, игрок вышел в меню посреди игры) —
    // всё равно зачисляем накопленные за забег монеты, не молча теряем прогресс.
    if (!this.runEnded) {
      stateManager.commitRun();
    }

    window.removeEventListener('resize', this.onResize);
    if (this.onKeyDownHandler) window.removeEventListener('keydown', this.onKeyDownHandler);
    if (this.onKeyUpHandler) window.removeEventListener('keyup', this.onKeyUpHandler);
    if (this.onMouseMoveHandler) window.removeEventListener('mousemove', this.onMouseMoveHandler);
    if (this.onMouseUpHandler) window.removeEventListener('mouseup', this.onMouseUpHandler);
    if (this.onTouchMoveHandler) window.removeEventListener('touchmove', this.onTouchMoveHandler);
    if (this.onTouchEndHandler) window.removeEventListener('touchend', this.onTouchEndHandler);
    if (this.onBlurHandler) window.removeEventListener('blur', this.onBlurHandler);
    if (this.onVisibilityHandler) document.removeEventListener('visibilitychange', this.onVisibilityHandler);
    // mousedown/touchstart висят на domElement, который сейчас будет удалён из DOM —
    // снимаем явно на всякий случай, чтобы не держать замыкание на this.
    const dom = this.renderer.domElement;
    if (this.onMouseDownHandler) dom.removeEventListener('mousedown', this.onMouseDownHandler);
    if (this.onTouchStartHandler) dom.removeEventListener('touchstart', this.onTouchStartHandler);

    this.unsubShake?.();
    this.unsubGateCharge?.();
    this.unsubMobFell?.();
    this.unsubCombo?.();
    this.unsubNearMiss?.();
    this.unsubSettings?.();

    this.crowd.dispose();
    this.gates.clear();
    this.obstacles.dispose();
    this.boss.clear();
    this.finishLine.clear();
    this.particles.dispose();
    this.disposeTrackMeshes();

    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
