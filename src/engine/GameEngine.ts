import * as THREE from 'three';
import { BiomeType, FormationType, LevelConfig, LevelDynamicEvent, CoinData } from '../types/game';
import { CrowdManager } from './CrowdManager';
import { GateManager } from './GateManager';
import { ObstacleManager } from './ObstacleManager';
import { BossManager } from './BossManager';
import { FinishLineManager } from './FinishLineManager';
import { ParticleSystem } from './ParticleSystem';
import { LevelGenerator, DEFAULT_TRACK_WIDTH } from './LevelGenerator';
import { stateManager } from '../core/StateManager';
import { soundEngine } from '../audio/SoundEngine';
import { eventBus } from '../core/EventBus';
import { perfMonitor } from '../core/Performance';
import { clamp } from '../utils/math';

export interface HudSnapshot {
  crowd: number;
  isHyper: boolean;
  adrenalineCharge: number; // 0..100
  progress: number; // 0..1 дистанции до финиша
  metersLeft: number;
  bossProgress: number; // 0..1, -1 если на уровне нет босса
  nextHazardDistance: number; // метров до ближайшего живого препятствия впереди, -1 если нет
  fps: number;
  drawCalls: number;
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
  private onLevelWinCb?: (score: number, mult: number, mobs: number) => void;
  private onLevelLoseCb?: () => void;
  private callbacks: GameEngineCallbacks;
  private unsubShake: (() => void) | null = null;
  private unsubGateCharge: (() => void) | null = null;
  private unsubMobFell: (() => void) | null = null;

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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.graphicsQuality === 'high' ? 2.0 : 1.0));
    this.renderer.shadowMap.enabled = settings.enableShadows;
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

    // 5. Instantiate sub-systems
    // Потолок толпы снижен с 400 до 200: меньше бойцов = меньше объектов на сцене,
    // меньше нагрузка на CPU/GPU и проще балансировать бонусы/препятствия.
    this.crowd = new CrowdManager(this.scene, 200);
    this.gates = new GateManager(this.scene);
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

    this.animate = this.animate.bind(this);
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
    onWin: (score: number, mult: number, mobs: number) => void,
    onLose: () => void
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

    // Start background music
    soundEngine.playMusic(
      levelConfig.biome === 'magma_citadel'
        ? 'magma'
        : levelConfig.biome === 'crystal_cavern'
        ? 'crystal'
        : levelConfig.biome === 'quantum_void'
        ? 'void'
        : levelConfig.biome === 'celestial_core'
        ? 'celestial'
        : 'cyber'
    );
  }

  public startEndlessMode(onLose: () => void): void {
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
  private buildTrackDecor(length: number, width: number, biome: BiomeType): void {
    const group = new THREE.Group();
    const accent = biome === 'magma_citadel' ? 0xf97316 : biome === 'crystal_cavern' ? 0x10b981 : biome === 'quantum_void' ? 0xa855f7 : biome === 'celestial_core' ? 0xfacc15 : 0x00f0ff;

    const pylonGeo = new THREE.CylinderGeometry(0.12, 0.18, 2.2, 6);
    const pylonMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.85,
      roughness: 0.25,
      emissive: accent,
      emissiveIntensity: 0.5,
    });
    const capGeo = new THREE.SphereGeometry(0.16, 8, 8);
    const capMat = new THREE.MeshBasicMaterial({ color: accent });

    const half = width / 2 + 1.2;
    const step = 18;
    for (let z = 10; z < length; z += step) {
      for (const side of [-1, 1]) {
        const pylon = new THREE.Mesh(pylonGeo, pylonMat);
        pylon.position.set(side * half, 1.1, z);
        group.add(pylon);
        const cap = new THREE.Mesh(capGeo, capMat);
        cap.position.set(side * half, 2.3, z);
        group.add(cap);
      }
    }

    // Floating energy orbs drifting ALONGSIDE the track (outside the lane) —
    // decorative elements must NOT sit on the playable surface.
    const orbGeo = new THREE.SphereGeometry(0.18, 8, 8);
    const orbMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.85 });
    const orbSide = width / 2 + 1.6;
    for (let z = 20; z < length; z += 26) {
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
    const sceneryStep = 30;
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
      const off = 0.5 + rnd() * 4; // вариация расстояния от края
      const x = side * (half + off);
      const obj = this.makeBiomeScenery(biome, accent, rnd);
      obj.position.set(x, 0, z);
      obj.scale.setScalar(0.6 + rnd() * 0.9);
      obj.rotation.y = rnd() * Math.PI * 2;
      // Лёгкая анимация (вращение у колец-монолитов) через тег
      if (rnd() < 0.5) {
        obj.userData.animate = 'scenerySpin';
      }
      group.add(obj);
    }

    // ==== ОБЪЕКТЫ-ЗАГОЛОВКИ ====
    // Прожекторные кольца ПО БОКАМ дорожки (вне игровой зоны) — вращаются (анимация)
    const ringGeo = new THREE.TorusGeometry(1.6, 0.08, 6, 20);
    const ringMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.6 });
    const ringSide = width / 2 + 2.2;
    for (let z = 30; z < length; z += 44) {
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

    this.scene.add(group);
    this.decorGroup = group;
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
        // Небоскрёбы с светящимися окнами
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
    // Откатываем активные эффекты событий (ЭМИ-шторм, множители скорости), чтобы они
    // не протекли в следующий забег.
    if (this.gates.isEmpActive()) this.gates.clearEmpStorm();
    this.resetEventState();
    stateManager.commitRun();
    if (win) {
      this.onLevelWinCb?.(score, mult, mobs);
    } else {
      this.onLevelLoseCb?.();
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
          this.crowd.isHyperMode ? 0xfacc15 : 0x00f0ff,
          2.5
        );
      }
    }

    // Update Sub-systems
    this.gates.update(dt, this.crowd, this.particles);
    this.obstacles.update(dt, this.crowd, this.particles);
    this.boss.update(dt, this.crowd, this.particles);
    this.particles.update(dt);

    // Динамические события уровня (триггер по leaderZ + тик активных эффектов).
    this.updateDynamicEvents(dt);

    if (!this.isEndless) {
      this.finishLine.update(dt, this.crowd, this.particles, (finalScore, finalMult, remainingMobs) => {
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

    // Animate floating energy orbs (bob + gentle spin) — zero-alloc scan of decor group
    if (this.decorGroup) {
      const t = performance.now() * 0.001;
      for (const child of this.decorGroup.children) {
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
          // Вращение фоновых объектов (кольца монолитов, антенны)
          child.rotation.y += dt * 0.5;
        } else if (tag === 'pulse') {
          // Пульсация лавовых колонн
          const m = (child as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
          if (m) m.opacity = 0.3 + Math.abs(Math.sin(t * 2 + child.position.z)) * 0.4;
        }
      }
    }

    // Update Light Position to follow crowd
    this.dirLight.position.set(this.crowd.leaderX + 15, 30, this.crowd.leaderZ + 15);
    this.dirLight.target.position.set(this.crowd.leaderX, 0, this.crowd.leaderZ + 10);
    this.dirLight.target.updateMatrixWorld();

    // Адреналин заряжается сам собой (плюс бонусы за ворота из подписки в конструкторе)
    this.adrenalineCharge = Math.min(100, this.adrenalineCharge + 8 * dt);
  }

  private updateEndlessStreaming(): void {
    // Раньше генерировался ровно один сегмент на 120м и дальше была пустота без
    // финиша и без возможности проиграть за пределами трассы. Догенерируем сегменты
    // по мере приближения игрока к концу текущего.
    if (this.crowd.leaderZ > this.currentEndlessZ - 150) {
      this.endlessSegmentIndex++;
      const seg = LevelGenerator.generateEndlessSegment(this.endlessSegmentIndex, this.currentEndlessZ);
      this.gates.appendGates(seg.gates);
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
      isHyper: this.crowd.isHyperMode,
      adrenalineCharge: this.adrenalineCharge,
      progress: this.isEndless ? 0 : clamp(this.crowd.leaderZ / len, 0, 1),
      metersLeft: this.isEndless ? -1 : Math.max(0, Math.round(len - this.crowd.leaderZ)),
      bossProgress: bossArenaZ > 0 ? clamp(bossArenaZ / len, 0, 1) : -1,
      nextHazardDistance: this.obstacles.getNextHazardDistance(this.crowd.leaderZ),
      fps: perfMonitor.getFPS(),
      drawCalls: perfMonitor.getDrawCalls(),
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
