import * as THREE from 'three';
import { BiomeType, FormationType, LevelConfig } from '../types/game';
import { CrowdManager } from './CrowdManager';
import { GateManager } from './GateManager';
import { ObstacleManager } from './ObstacleManager';
import { BossManager } from './BossManager';
import { FinishLineManager } from './FinishLineManager';
import { ParticleSystem } from './ParticleSystem';
import { LevelGenerator } from './LevelGenerator';
import { stateManager } from '../core/StateManager';
import { soundEngine } from '../audio/SoundEngine';
import { eventBus } from '../core/EventBus';
import { perfMonitor } from '../core/Performance';

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

  // State
  public isRunning: boolean = false;
  public currentLevel: LevelConfig | null = null;
  public isEndless: boolean = false;
  public endlessSegmentIndex: number = 0;
  public currentEndlessZ: number = 0;

  // Controls
  private steerInput: number = 0;
  private isPointerDown: boolean = false;
  private lastPointerX: number = 0;
  private baseSpeed: number = 18.0;

  // Screen shake
  private screenShakeIntensity: number = 0;

  // Callbacks
  private onLevelWinCb?: (score: number, mult: number, mobs: number) => void;
  private onLevelLoseCb?: () => void;

  constructor(container: HTMLElement) {
    this.container = container;

    // 1. Scene
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x080c14, 0.015);

    // 2. Camera (Third person chase camera)
    const aspect = container.clientWidth / container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 800);
    this.camera.position.set(0, 10, -12);
    this.camera.lookAt(0, 2, 8);

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
    this.crowd = new CrowdManager(this.scene, 400);
    this.gates = new GateManager(this.scene);
    this.obstacles = new ObstacleManager(this.scene);
    this.boss = new BossManager(this.scene);
    this.finishLine = new FinishLineManager(this.scene);
    this.particles = new ParticleSystem(this.scene, 300);

    // 6. Setup Inputs and Resizing
    this.setupInputs();
    window.addEventListener('resize', this.onResize);

    // Subscribe to shake events
    eventBus.on('screenShake', (data: { intensity: number }) => {
      if (stateManager.getState().settings.enableScreenShake) {
        this.screenShakeIntensity = Math.min(1.0, this.screenShakeIntensity + (data.intensity || 0.4));
      }
    });

    this.animate = this.animate.bind(this);
  }

  private setupInputs(): void {
    // Pointer / Mouse / Touch
    const dom = this.renderer.domElement;

    const onStart = (clientX: number) => {
      this.isPointerDown = true;
      this.lastPointerX = clientX;
      soundEngine.resume();
    };

    const onMove = (clientX: number) => {
      if (!this.isPointerDown) return;
      const settings = stateManager.getState().settings;
      const deltaX = clientX - this.lastPointerX;
      this.lastPointerX = clientX;

      const sensitivity = settings.controlsSensitivity * (settings.invertX ? -1 : 1);
      const factor = (deltaX / window.innerWidth) * 45 * sensitivity;
      this.steerInput = factor;
    };

    const onEnd = () => {
      this.isPointerDown = false;
      this.steerInput = 0;
    };

    dom.addEventListener('mousedown', (e) => onStart(e.clientX));
    window.addEventListener('mousemove', (e) => onMove(e.clientX));
    window.addEventListener('mouseup', onEnd);

    dom.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length > 0) onStart(e.touches[0].clientX);
      },
      { passive: true }
    );
    window.addEventListener(
      'touchmove',
      (e) => {
        if (e.touches.length > 0) onMove(e.touches[0].clientX);
      },
      { passive: true }
    );
    window.addEventListener('touchend', onEnd);

    // Keyboard controls
    window.addEventListener('keydown', (e) => {
      if (e.key === 'a' || e.key === 'ArrowLeft' || e.key === 'A') {
        this.steerInput = -1.0;
      } else if (e.key === 'd' || e.key === 'ArrowRight' || e.key === 'D') {
        this.steerInput = 1.0;
      } else if (e.key === ' ' || e.code === 'Space') {
        this.crowd.activateHyperMode();
      } else if (e.key === '1') {
        this.crowd.setFormation('wedge');
      } else if (e.key === '2') {
        this.crowd.setFormation('wide');
      } else if (e.key === '3') {
        this.crowd.setFormation('circle');
      } else if (e.key === '4') {
        this.crowd.setFormation('arrow');
      }
    });

    window.addEventListener('keyup', (e) => {
      if (
        e.key === 'a' ||
        e.key === 'ArrowLeft' ||
        e.key === 'd' ||
        e.key === 'ArrowRight' ||
        e.key === 'A' ||
        e.key === 'D'
      ) {
        this.steerInput = 0;
      }
    });
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

    const levelConfig = LevelGenerator.generateLevel(levelNum);
    this.currentLevel = levelConfig;

    this.setupBiomeEnvironment(levelConfig.biome);
    this.buildTrack(levelConfig.trackLength, levelConfig.trackWidth, levelConfig.biome);

    // Reset sub-systems
    this.crowd.reset(levelConfig.startingMobs, 0);
    this.gates.initGates(levelConfig.gates);
    this.obstacles.initObstacles(levelConfig.obstacles, levelConfig.coins);

    if (levelConfig.boss) {
      this.boss.initBoss(levelConfig.boss, levelConfig.trackLength - 20);
    } else {
      this.boss.clear();
    }

    this.finishLine.initFinishLine(levelConfig.trackLength, levelConfig.multiplierWallSteps);
    this.particles.clear();

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

  public startEndlessMode(
    onLose: () => void
  ): void {
    this.isEndless = true;
    this.onLevelLoseCb = onLose;
    this.endlessSegmentIndex = 0;
    this.currentEndlessZ = 0;

    const biome: BiomeType = 'cyber_city';
    this.setupBiomeEnvironment(biome);
    this.buildTrack(500, 10, biome);

    this.crowd.reset(5, 0);
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

  private buildTrack(length: number, width: number, biome: BiomeType): void {
    if (this.trackMesh) this.scene.remove(this.trackMesh);
    if (this.leftBorder) this.scene.remove(this.leftBorder);
    if (this.rightBorder) this.scene.remove(this.rightBorder);

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

    this.rightBorder = new THREE.Mesh(railGeo, railMat);
    this.rightBorder.position.set(width / 2, 0.4, (length + 80) / 2 - 20);
    this.scene.add(this.rightBorder);
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();
    this.reqId = requestAnimationFrame(this.animate);
  }

  public pause(): void {
    this.isRunning = false;
    if (this.reqId !== null) {
      cancelAnimationFrame(this.reqId);
      this.reqId = null;
    }
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

    this.reqId = requestAnimationFrame(this.animate);
  }

  private update(dt: number): void {
    const trackWidth = this.currentLevel?.trackWidth || 10;

    // Update Crowd
    this.crowd.update(dt, this.baseSpeed, this.steerInput, trackWidth);

    // Smooth return of steer input if released
    if (!this.isPointerDown && Math.abs(this.steerInput) > 0.01) {
      this.steerInput *= Math.pow(0.05, dt);
    }

    // Check Defeat Condition (all mobs died)
    if (this.crowd.getAliveCount() <= 0) {
      this.pause();
      soundEngine.playSound('level_lose');
      if (this.onLevelLoseCb) this.onLevelLoseCb();
      return;
    }

    // Update Sub-systems
    this.gates.update(dt, this.crowd, this.particles);
    this.obstacles.update(dt, this.crowd, this.particles);
    this.boss.update(dt, this.crowd, this.particles);
    this.particles.update(dt);

    if (!this.isEndless) {
      this.finishLine.update(
        dt,
        this.crowd,
        this.particles,
        (finalScore, finalMult, remainingMobs) => {
          this.pause();
          if (this.onLevelWinCb) {
            this.onLevelWinCb(finalScore, finalMult, remainingMobs);
          }
        }
      );
    }

    // Update Camera Follow
    const targetCamX = this.crowd.leaderX * 0.4;
    const targetCamZ = this.crowd.leaderZ - 10;
    this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, targetCamX, 10 * dt);
    this.camera.position.z = THREE.MathUtils.lerp(this.camera.position.z, targetCamZ, 12 * dt);
    this.camera.position.y = 8.5;

    // Apply Screen Shake
    if (this.screenShakeIntensity > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.screenShakeIntensity * 0.8;
      this.camera.position.y += (Math.random() - 0.5) * this.screenShakeIntensity * 0.8;
      this.screenShakeIntensity = Math.max(0, this.screenShakeIntensity - dt * 3.0);
    }

    this.camera.lookAt(this.crowd.leaderX * 0.2, 1.8, this.crowd.leaderZ + 12);

    // Update Light Position to follow crowd
    this.dirLight.position.set(this.crowd.leaderX + 15, 30, this.crowd.leaderZ + 15);
    this.dirLight.target.position.set(this.crowd.leaderX, 0, this.crowd.leaderZ + 10);
    this.dirLight.target.updateMatrixWorld();
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  public setFormation(f: FormationType): void {
    this.crowd.setFormation(f);
  }

  public activateAdrenaline(): void {
    this.crowd.activateHyperMode();
  }

  public dispose(): void {
    this.pause();
    window.removeEventListener('resize', this.onResize);

    this.crowd.dispose();
    this.gates.clear();
    this.obstacles.dispose();
    this.boss.clear();
    this.finishLine.clear();
    this.particles.dispose();

    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
    this.renderer.dispose();
  }
}
