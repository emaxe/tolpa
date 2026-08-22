/**
 * ThreeRenderer: слой отрисовки на Three.js.
 * - InstancedMesh для толпы, препятствий, ворот, монет, бонусов, метеоров (draw calls ~30)
 * - LOD: качество low/med/high (pixelRatio, тени, декор, спрайты, частицы)
 * - Процедурные canvas-текстуры (земля, стены, вывески ворот)
 * - Пул частиц на THREE.Points (1 draw call)
 * В игровом цикле не создаёт аллокаций (модульные temp-объекты).
 */
import * as THREE from "three";
import type { ObstacleKind, ThemeId, ThemePalette } from "../world/LevelGenerator";
import { THEMES } from "../world/LevelGenerator";
import type { GateKind } from "../world/Gates";

export type Quality = "low" | "med" | "high";

export interface GateView {
  x: number;
  z: number;
  kind: GateKind;
  n: number;
  good: boolean; // цвет арки (зелёная/красная) — для условных ворот
}

export interface ObstacleView {
  x: number;
  z: number;
  kind: ObstacleKind;
  w: number;
  active: boolean;
}

export interface CoinView {
  x: number;
  z: number;
}

export interface BonusView {
  x: number;
  z: number;
  kind: string;
}

export interface MeteorView {
  x: number;
  z: number;
  y: number;
  active: boolean;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

const MOB_COLORS = {
  normal: [0xff6b6b, 0x4fc3f7, 0xffd23f, 0x81c784, 0xba68c8, 0xff8a65, 0x4db6ac, 0xe57373],
  speedster: 0xffd23f,
  tank: 0x9aa3b2,
  magnet: 0x4fc3f7,
  clover: 0x69f0ae,
};

const OBSTACLE_COLORS: Record<ObstacleKind, number> = {
  barrier: 0xd84343,
  crate: 0xa1794a,
  cone: 0xff8f00,
  spikes: 0xcfd8dc,
  saw: 0x90a4ae,
  mine: 0x512da8,
  block: 0x6d7a8d,
};

export class ThreeRenderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private container: HTMLElement;
  quality: Quality = "med";
  private ro: ResizeObserver | null = null;
  private time = 0;
  private wallWidth = 13;

  // Толпа
  private crowdMesh!: THREE.InstancedMesh;
  private crowdColors = new Float32Array(256 * 3);

  // Препятствия по видам
  private obstacleMeshes = new Map<ObstacleKind, THREE.InstancedMesh>();

  // Ворота
  private gatePillars = new Map<string, THREE.InstancedMesh>(); // "good"/"bad"
  private gateTops = new Map<string, THREE.InstancedMesh>();
  private gateSprites: THREE.Sprite[] = [];
  private gateSpriteTex = new Map<string, THREE.CanvasTexture>();

  // Монеты/бонусы/метеоры
  private coinMesh!: THREE.InstancedMesh;
  private bonusMesh!: THREE.InstancedMesh;
  private meteorMesh!: THREE.InstancedMesh;
  private coinCount = 0;
  private bonusCount = 0;
  private coinBase: { x: number; z: number; phase: number }[] = [];
  private bonusBase: { x: number; z: number; phase: number }[] = [];

  // Частицы
  private points!: THREE.Points;
  private pPos = new Float32Array(400 * 3);
  private pCol = new Float32Array(400 * 3);
  private pLife = new Float32Array(400);
  private pMax = new Float32Array(400);
  private pVel = new Float32Array(400 * 3);
  private pSize = new Float32Array(400);
  private pCursor = 0;

  // Стена босса
  private wallMesh: THREE.Mesh | null = null;
  private wallMat: THREE.MeshStandardMaterial | null = null;
  private wallBaseZ = 0;
  private wallMaxHp = 1;
  private wallFlash = 0;
  private shockwave: THREE.Mesh | null = null;
  private shockActive = false;
  private shockT = 0;
  private spikesMesh: THREE.InstancedMesh | null = null;
  private spikesUp = 0;

  // Окружение
  private ground!: THREE.Mesh;
  private decorMesh!: THREE.InstancedMesh;
  private decorCount = 0;
  private decorItems: { x: number; z: number; s: number; h: number }[] = [];
  private eventFx: THREE.Points | null = null;
  private fxPos = new Float32Array(120 * 3);
  private shakeAmp = 0;
  private fovKick = 0;
  private flashMesh: THREE.Mesh | null = null;
  private flashT = 0;
  private disposed = false;

  constructor(container: HTMLElement, quality: Quality) {
    this.container = container;
    this.quality = quality;
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 400);
    this.camera.position.set(0, 7.2, -9);
    this.camera.lookAt(0, 1.4, 0);

    this.renderer = new THREE.WebGLRenderer({
      antialias: quality !== "low",
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === "high" ? 2 : quality === "med" ? 1.5 : 1));
    this.renderer.setSize(container.clientWidth || 1, container.clientHeight || 1);
    if (quality !== "low") {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
    }
    container.appendChild(this.renderer.domElement);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);

    const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x3a3f4d, 1.1);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(6, 14, 6);
    if (quality !== "low") {
      dir.castShadow = true;
      dir.shadow.mapSize.set(1024, 1024);
      dir.shadow.camera.left = -20;
      dir.shadow.camera.right = 20;
      dir.shadow.camera.top = 40;
      dir.shadow.camera.bottom = -40;
    }
    this.scene.add(dir);
    this.scene.fog = new THREE.Fog(0x101827, 45, 150);

    this.buildEnvironment();
    this.buildCrowd();
    this.buildObstacles();
    this.buildGates();
    this.buildPickups();
    this.buildParticles();
    this.makeFlash();
  }

  // ---------- Процедурные текстуры ----------
  private canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, repeat = false): THREE.CanvasTexture {
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext("2d")!;
    draw(ctx);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    if (repeat) {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    }
    tex.anisotropy = 4;
    return tex;
  }

  private groundTexture(pal: ThemePalette): THREE.CanvasTexture {
    return this.canvasTex(256, 256, (ctx) => {
      ctx.fillStyle = pal.ground;
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = pal.groundLine;
      ctx.lineWidth = 3;
      for (let i = 0; i <= 256; i += 32) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 256);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(256, i);
        ctx.stroke();
      }
      ctx.fillStyle = pal.accent;
      ctx.globalAlpha = 0.5;
      for (let i = 0; i < 6; i++) {
        ctx.fillRect((i * 97) % 256, (i * 53) % 256, 6, 6);
      }
    }, true);
  }

  private wallTexture(world: number): THREE.CanvasTexture {
    return this.canvasTex(256, 256, (ctx) => {
      const colors = ["#5b4a3f", "#4a3c33", "#6d5a4c", "#3f342d"];
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          ctx.fillStyle = colors[(x + y * 3 + world) % colors.length];
          ctx.fillRect(x * 32 + 1, y * 32 + 1, 30, 30);
          ctx.fillStyle = "rgba(0,0,0,0.35)";
          ctx.fillRect(x * 32, y * 32 + 28, 32, 4);
        }
      }
      ctx.fillStyle = `rgba(255,60,60,${0.15 + world * 0.05})`;
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = "#ff5252";
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, 248, 248);
    });
  }

  private symbolTexture(symbol: string, good: boolean): THREE.CanvasTexture {
    return this.canvasTex(128, 64, (ctx) => {
      ctx.fillStyle = good ? "rgba(46,204,113,0.92)" : "rgba(231,76,60,0.92)";
      ctx.beginPath();
      ctx.roundRect(4, 4, 120, 56, 14);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(4, 4, 120, 56, 14);
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 34px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(symbol, 64, 34);
    });
  }

  // ---------- Окружение ----------
  private buildEnvironment(): void {
    const pal = THEMES.city;
    // Небо-купол с градиентом
    const skyTex = this.canvasTex(64, 256, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, pal.skyTop);
      g.addColorStop(1, pal.skyBottom);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 256);
    });
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(170, 20, 12),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }),
    );
    this.scene.add(dome);

    // Земля
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 900),
      new THREE.MeshStandardMaterial({ map: this.groundTexture(pal), roughness: 0.95 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.z = -140;
    this.ground.receiveShadow = this.quality !== "low";
    this.scene.add(this.ground);

    // Боковые стены
    const wallGeo = new THREE.BoxGeometry(0.9, 3.2, 900);
    const wallMat = new THREE.MeshStandardMaterial({ color: pal.decor[1], roughness: 0.9 });
    for (const x of [-8.4, 8.4]) {
      const w = new THREE.Mesh(wallGeo, wallMat);
      w.position.set(x, 1.6, -140);
      this.scene.add(w);
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(0.95, 0.16, 900),
        new THREE.MeshBasicMaterial({ color: pal.accent }),
      );
      strip.position.set(x, 3.3, -140);
      this.scene.add(strip);
    }

    // Декор-здания (instanced)
    const decGeo = new THREE.BoxGeometry(1, 1, 1);
    const decMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    this.decorMesh = new THREE.InstancedMesh(decGeo, decMat, 120);
    this.decorMesh.count = 0;
    this.decorMesh.frustumCulled = false;
    this.scene.add(this.decorMesh);
  }

  setTheme(theme: ThemeId, seed: number): void {
    const pal = THEMES[theme];
    (this.scene.fog as THREE.Fog).color.set(pal.fog);
    const skyTex = this.canvasTex(64, 256, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, pal.skyTop);
      g.addColorStop(1, pal.skyBottom);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 256);
    });
    const dome = this.scene.children.find((c) => c instanceof THREE.Mesh && (c.material as THREE.MeshBasicMaterial).side === THREE.BackSide);
    if (dome) (dome as THREE.Mesh).material = new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false });
    (this.ground.material as THREE.MeshStandardMaterial).map = this.groundTexture(pal);

    // Декор вдоль трассы (детерминированный)
    this.decorCount = this.quality === "low" ? 0 : 44;
    this.decorMesh.count = this.decorCount;
    this.decorItems = [];
    let s = seed * 2654435761;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < this.decorCount; i++) {
      const z = -20 - i * 16 - rnd() * 8;
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (10 + rnd() * 10);
      const h = 4 + rnd() * 14;
      const w = 3 + rnd() * 5;
      this.decorItems.push({ x, z, s: w, h });
      _m.makeTranslation(x, h / 2 - 0.1, z);
      this.decorMesh.setMatrixAt(i, _m);
      _c.set(pal.decor[Math.floor(rnd() * pal.decor.length)]);
      this.decorMesh.setColorAt(i, _c);
      const sc = new THREE.Vector3(w, h, w);
      _m.compose(_v.set(x, h / 2 - 0.1, z), _q.identity(), sc);
      this.decorMesh.setMatrixAt(i, _m);
    }
    this.decorMesh.instanceMatrix.needsUpdate = true;
    if (this.decorMesh.instanceColor) this.decorMesh.instanceColor.needsUpdate = true;
  }

  // ---------- Толпа ----------
  private buildCrowd(): void {
    const geo = new THREE.BoxGeometry(0.62, 1.25, 0.42);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.75 });
    this.crowdMesh = new THREE.InstancedMesh(geo, mat, 256);
    this.crowdMesh.count = 0;
    this.crowdMesh.frustumCulled = false;
    this.crowdMesh.castShadow = this.quality !== "low";
    this.scene.add(this.crowdMesh);
  }

  updateCrowd(
    count: number,
    positions: Float32Array,
    types: Uint8Array,
    themeSeed: number,
  ): void {
    this.crowdMesh.count = count;
    for (let i = 0; i < count; i++) {
      const px = positions[i * 3];
      const py = positions[i * 3 + 1];
      const pz = positions[i * 3 + 2];
      _m.makeTranslation(px, py, pz);
      this.crowdMesh.setMatrixAt(i, _m);
      const t = types[i];
      const pal = MOB_COLORS;
      if (t === 1) _c.setHex(pal.speedster);
      else if (t === 2) _c.setHex(pal.tank);
      else if (t === 3) _c.setHex(pal.magnet);
      else if (t === 4) _c.setHex(pal.clover);
      else _c.setHex(pal.normal[(i * 3 + themeSeed) % pal.normal.length]);
      this.crowdColors[i * 3] = _c.r;
      this.crowdColors[i * 3 + 1] = _c.g;
      this.crowdColors[i * 3 + 2] = _c.b;
    }
    this.crowdMesh.instanceMatrix.needsUpdate = true;
    if (this.crowdMesh.instanceColor) this.crowdMesh.instanceColor.needsUpdate = true;
  }

  // ---------- Препятствия ----------
  private buildObstacles(): void {
    const defs: Record<ObstacleKind, { geo: THREE.BufferGeometry; y: number }> = {
      barrier: { geo: new THREE.BoxGeometry(1, 1.5, 0.55), y: 0.75 },
      crate: { geo: new THREE.BoxGeometry(1.1, 1.1, 1.1), y: 0.55 },
      cone: { geo: new THREE.ConeGeometry(0.55, 1.3, 7), y: 0.65 },
      spikes: { geo: new THREE.ConeGeometry(0.4, 1.1, 6), y: 0.55 },
      saw: { geo: new THREE.CylinderGeometry(1.0, 1.0, 0.18, 18), y: 0.45 },
      mine: { geo: new THREE.SphereGeometry(0.5, 10, 8), y: 0.5 },
      block: { geo: new THREE.BoxGeometry(1, 2.4, 1), y: 1.2 },
    };
    for (const kind of Object.keys(defs) as ObstacleKind[]) {
      const { geo, y } = defs[kind];
      const mat = new THREE.MeshStandardMaterial({ color: OBSTACLE_COLORS[kind], roughness: 0.7 });
      if (kind === "barrier") {
        mat.map = this.canvasTex(64, 96, (ctx) => {
          ctx.fillStyle = "#d84343";
          ctx.fillRect(0, 0, 64, 96);
          ctx.fillStyle = "#ffffff";
          for (let y2 = 0; y2 < 96; y2 += 24) ctx.fillRect(0, y2 + 8, 64, 8);
        });
      }
      if (kind === "crate") {
        mat.map = this.canvasTex(64, 64, (ctx) => {
          ctx.fillStyle = "#a1794a";
          ctx.fillRect(0, 0, 64, 64);
          ctx.strokeStyle = "#5d4327";
          ctx.lineWidth = 5;
          ctx.strokeRect(2, 2, 60, 60);
          ctx.beginPath();
          ctx.moveTo(4, 4);
          ctx.lineTo(60, 60);
          ctx.moveTo(60, 4);
          ctx.lineTo(4, 60);
          ctx.stroke();
        });
      }
      const mesh = new THREE.InstancedMesh(geo, mat, 48);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = this.quality !== "low";
      this.scene.add(mesh);
      this.obstacleMeshes.set(kind, mesh);
      mesh.userData.y = y;
    }
  }

  syncObstacles(items: ObstacleView[]): void {
    for (const [kind, mesh] of this.obstacleMeshes) {
      let n = 0;
      const y = mesh.userData.y as number;
      for (const it of items) {
        if (!it.active || it.kind !== kind) continue;
        _m.makeTranslation(it.x, y, it.z);
        mesh.setMatrixAt(n, _m);
        n++;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // ---------- Ворота ----------
  private buildGates(): void {
    const pillarGeo = new THREE.BoxGeometry(0.5, 3.6, 0.5);
    const topGeo = new THREE.BoxGeometry(2.6, 0.6, 0.5);
    for (const key of ["good", "bad"]) {
      const color = key === "good" ? 0x2ecc71 : 0xe74c3c;
      const pillarMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35 });
      const topMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5 });
      const p = new THREE.InstancedMesh(pillarGeo, pillarMat, 48);
      p.count = 0;
      p.frustumCulled = false;
      this.scene.add(p);
      const t = new THREE.InstancedMesh(topGeo, topMat, 24);
      t.count = 0;
      t.frustumCulled = false;
      this.scene.add(t);
      this.gatePillars.set(key, p);
      this.gateTops.set(key, t);
    }
  }

  syncGates(gates: GateView[]): void {
    // Спрайты
    for (const sp of this.gateSprites) this.scene.remove(sp);
    this.gateSprites.length = 0;
    const wantSprites = this.quality !== "low";
    for (const key of ["good", "bad"]) {
      const pillars = this.gatePillars.get(key)!;
      const tops = this.gateTops.get(key)!;
      let n = 0;
      let m = 0;
      for (const g of gates) {
        const isGood = g.good;
        if ((key === "good") !== isGood) continue;
        const x = g.x;
        _m.makeTranslation(x - 1.1, 1.8, g.z);
        pillars.setMatrixAt(n, _m);
        _m.makeTranslation(x + 1.1, 1.8, g.z);
        pillars.setMatrixAt(n + 1, _m);
        _m.makeTranslation(x, 3.75, g.z);
        tops.setMatrixAt(m, _m);
        n += 2;
        m++;
        if (wantSprites) {
          const sym = symbolForGate(g.kind, g.n);
          const texKey = `${sym}:${isGood ? 1 : 0}`;
          let tex = this.gateSpriteTex.get(texKey);
          if (!tex) {
            tex = this.symbolTexture(sym, isGood);
            this.gateSpriteTex.set(texKey, tex);
          }
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
          sp.position.set(x, 4.9, g.z);
          sp.scale.set(1.7, 0.85, 1);
          this.scene.add(sp);
          this.gateSprites.push(sp);
        }
      }
      pillars.count = n;
      tops.count = m;
      pillars.instanceMatrix.needsUpdate = true;
      tops.instanceMatrix.needsUpdate = true;
    }
  }

  // ---------- Монеты и бонусы ----------
  private buildPickups(): void {
    const coinGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.12, 14);
    coinGeo.rotateX(Math.PI / 2);
    const coinMat = new THREE.MeshStandardMaterial({
      color: 0xffd23f,
      emissive: 0xffb300,
      emissiveIntensity: 0.45,
      metalness: 0.6,
      roughness: 0.3,
    });
    this.coinMesh = new THREE.InstancedMesh(coinGeo, coinMat, 160);
    this.coinMesh.count = 0;
    this.coinMesh.frustumCulled = false;
    this.scene.add(this.coinMesh);

    const bonusGeo = new THREE.OctahedronGeometry(0.55);
    const bonusMat = new THREE.MeshStandardMaterial({ color: 0x69f0ae, emissive: 0x00e676, emissiveIntensity: 0.5 });
    this.bonusMesh = new THREE.InstancedMesh(bonusGeo, bonusMat, 24);
    this.bonusMesh.count = 0;
    this.bonusMesh.frustumCulled = false;
    this.scene.add(this.bonusMesh);

    // Метеоры
    const metGeo = new THREE.SphereGeometry(0.7, 8, 6);
    const metMat = new THREE.MeshStandardMaterial({ color: 0xff5722, emissive: 0xff3d00, emissiveIntensity: 0.8 });
    this.meteorMesh = new THREE.InstancedMesh(metGeo, metMat, 10);
    this.meteorMesh.count = 0;
    this.meteorMesh.frustumCulled = false;
    this.scene.add(this.meteorMesh);
  }

  syncCoins(coins: CoinView[]): void {
    this.coinCount = coins.length;
    this.coinBase = coins.map((c, i) => ({ x: c.x, z: c.z, phase: i * 1.7 }));
  }

  syncBonuses(bonuses: BonusView[]): void {
    this.bonusCount = bonuses.length;
    this.bonusBase = bonuses.map((b, i) => ({ x: b.x, z: b.z, phase: i * 2.1 }));
  }

  // ---------- Частицы ----------
  private buildParticles(): void {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.pCol, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.55,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  spawnParticles(x: number, y: number, z: number, color: number, n: number, speed = 6): void {
    for (let i = 0; i < n; i++) {
      const idx = this.pCursor;
      this.pCursor = (this.pCursor + 1) % 400;
      this.pPos[idx * 3] = x;
      this.pPos[idx * 3 + 1] = y;
      this.pPos[idx * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.7 + 0.3;
      this.pVel[idx * 3] = Math.cos(a) * speed * (0.4 + Math.random() * 0.6);
      this.pVel[idx * 3 + 1] = up * speed;
      this.pVel[idx * 3 + 2] = Math.sin(a) * speed * (0.4 + Math.random() * 0.6);
      this.pMax[idx] = this.pLife[idx] = 0.5 + Math.random() * 0.6;
      this.pSize[idx] = 0.3 + Math.random() * 0.5;
      _c.setHex(color);
      this.pCol[idx * 3] = _c.r;
      this.pCol[idx * 3 + 1] = _c.g;
      this.pCol[idx * 3 + 2] = _c.b;
    }
  }

  // ---------- Стена босса ----------
  setupWall(world: number, hp: number, z: number, width: number): void {
    this.wallMaxHp = hp;
    this.wallBaseZ = z;
    this.wallWidth = width;
    if (this.wallMesh) {
      this.scene.remove(this.wallMesh);
      this.wallMesh.geometry.dispose();
    }
    if (this.wallMat) this.wallMat.dispose();
    this.wallMat = new THREE.MeshStandardMaterial({
      map: this.wallTexture(world),
      emissive: 0x541010,
      emissiveIntensity: 0.2,
      roughness: 0.8,
    });
    this.wallMesh = new THREE.Mesh(new THREE.BoxGeometry(width, 6.5, 1.4), this.wallMat);
    this.wallMesh.position.set(0, 3.25, z);
    this.wallMesh.castShadow = this.quality !== "low";
    this.scene.add(this.wallMesh);

    // Шипы стены
    const spikeGeo = new THREE.ConeGeometry(0.35, 2.2, 6);
    const spikeMat = new THREE.MeshStandardMaterial({ color: 0xcfd8dc, emissive: 0xff1744, emissiveIntensity: 0.3 });
    this.spikesMesh = new THREE.InstancedMesh(spikeGeo, spikeMat, 14);
    this.spikesMesh.count = 0;
    this.spikesMesh.frustumCulled = false;
    this.scene.add(this.spikesMesh);

    // Ударная волна
    const ring = new THREE.TorusGeometry(1, 0.14, 8, 28);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
    this.shockwave = new THREE.Mesh(ring, ringMat);
    this.shockwave.rotation.x = Math.PI / 2;
    this.shockwave.visible = false;
    this.scene.add(this.shockwave);
  }

  updateWall(hp: number, active: boolean): void {
    if (!this.wallMesh || !this.wallMat) return;
    const frac = Math.max(0, hp / this.wallMaxHp);
    this.wallMesh.position.z = this.wallBaseZ + (1 - frac) * 2.4;
    if (this.wallFlash > 0) {
      this.wallFlash -= 0.06;
      this.wallMat.emissiveIntensity = 0.2 + this.wallFlash * 1.2;
    } else {
      this.wallMat.emissiveIntensity = 0.2;
    }
    this.wallMesh.visible = active;
    if (!active && this.shockwave) this.shockwave.visible = false;
  }

  flashWall(): void {
    this.wallFlash = 1;
  }

  triggerShockwave(x: number, z: number): void {
    if (!this.shockwave) return;
    this.shockActive = true;
    this.shockT = 0;
    this.shockwave.visible = true;
    this.shockwave.position.set(x, 0.3, z);
  }

  setSpikes(count: number, up: boolean): void {
    if (!this.spikesMesh || !this.wallMesh) return;
    this.spikesUp = up ? 1 : 0;
    this.spikesMesh.count = count;
    const w = this.wallWidth;
    for (let i = 0; i < count; i++) {
      const x = -w / 2 + 1 + (i * (w - 2)) / Math.max(1, count - 1);
      _m.makeTranslation(x, 0.1 + this.spikesUp * 1.05, this.wallMesh.position.z - 0.75);
      this.spikesMesh.setMatrixAt(i, _m);
    }
    this.spikesMesh.instanceMatrix.needsUpdate = true;
  }

  breakWall(): void {
    if (!this.wallMesh) return;
    this.spawnParticles(this.wallMesh.position.x, 3, this.wallMesh.position.z, 0xffb74d, 90, 10);
    this.spawnParticles(this.wallMesh.position.x, 3, this.wallMesh.position.z, 0xffffff, 40, 8);
    this.wallMesh.visible = false;
    if (this.spikesMesh) this.spikesMesh.count = 0;
    this.flashMesh!.material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this.flashMesh!.visible = true;
    this.flashT = 0.5;
    this.shockwave!.visible = false;
  }

  // ---------- Эффекты событий ----------
  setupEventFx(kind: string): void {
    if (this.eventFx) {
      this.scene.remove(this.eventFx);
      this.eventFx.geometry.dispose();
    }
    if (kind === "none") return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.fxPos, 3));
    const mat = new THREE.PointsMaterial({
      color: kind === "wind" ? 0xbfe8ff : 0xffd23f,
      size: 0.3,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });
    this.eventFx = new THREE.Points(geo, mat);
    this.eventFx.frustumCulled = false;
    this.scene.add(this.eventFx);
  }

  updateEventFx(kind: string, leaderX: number, leaderZ: number, dt: number): void {
    if (!this.eventFx || kind === "none") return;
    const arr = this.fxPos;
    for (let i = 0; i < 120; i++) {
      if (kind === "wind") {
        arr[i * 3] += dt * 14;
        if (arr[i * 3] > leaderX + 12) arr[i * 3] = leaderX - 12 - Math.random() * 4;
        arr[i * 3 + 1] = 0.8 + Math.sin(i * 1.3) * 0.4;
        arr[i * 3 + 2] = leaderZ - 6 + (i % 24) * 0.5;
      } else {
        arr[i * 3] = leaderX - 8 + (i % 20) * 0.8;
        arr[i * 3 + 1] = 2.5 + ((i * 7) % 10) * 0.8;
        arr[i * 3 + 2] = leaderZ + 4 + (i % 30) * 0.4;
      }
    }
    (this.eventFx.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  syncMeteors(meteors: MeteorView[]): void {
    this.meteorMesh.count = meteors.filter((m) => m.active).length;
    let n = 0;
    for (const m of meteors) {
      if (!m.active) continue;
      _m.makeTranslation(m.x, m.y, m.z);
      this.meteorMesh.setMatrixAt(n, _m);
      n++;
    }
    this.meteorMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------- Прочее ----------
  shake(amp: number): void {
    this.shakeAmp = Math.min(0.8, this.shakeAmp + amp);
  }

  kickFov(v: number): void {
    this.fovKick = Math.min(14, this.fovKick + v);
  }

  setFlash(): void {
    if (!this.flashMesh) return;
    this.flashMesh.visible = true;
    this.flashT = 0.25;
  }

  private makeFlash(): void {
    const geo = new THREE.PlaneGeometry(200, 200);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.flashMesh = new THREE.Mesh(geo, mat);
    this.flashMesh.renderOrder = 999;
    this.flashMesh.visible = false;
    this.scene.add(this.flashMesh);
  }

  /** Главный кадр: камера, частицы, анимации. */
  update(dt: number, leaderX: number, leaderZ: number, speed: number): void {
    this.time += dt;
    // Частицы
    const posAttr = this.points.geometry.getAttribute("position") as THREE.BufferAttribute;
    const colAttr = this.points.geometry.getAttribute("color") as THREE.BufferAttribute;
    for (let i = 0; i < 400; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      this.pVel[i * 3 + 1] -= 9 * dt;
      const life = Math.max(0, this.pLife[i] / this.pMax[i]);
      this.pCol[i * 3] *= 0.999;
      if (life <= 0.02) {
        this.pLife[i] = 0;
        this.pPos[i * 3 + 1] = -10;
      }
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;

    // Монеты крутятся
    this.coinMesh.count = this.coinCount;
    for (let i = 0; i < this.coinCount; i++) {
      const c = this.coinBase[i];
      _e.set(0, this.time * 3 + c.phase, 0);
      _q.setFromEuler(_e);
      _m.compose(_v.set(c.x, 0.8 + Math.sin(this.time * 2 + c.phase) * 0.15, c.z), _q, _s.set(1, 1, 1));
      this.coinMesh.setMatrixAt(i, _m);
    }
    this.coinMesh.instanceMatrix.needsUpdate = true;

    // Бонусы парят
    this.bonusMesh.count = this.bonusCount;
    for (let i = 0; i < this.bonusCount; i++) {
      const b = this.bonusBase[i];
      _e.set(this.time * 1.4, this.time * 2, 0);
      _q.setFromEuler(_e);
      _m.compose(_v.set(b.x, 1.35 + Math.sin(this.time * 2.4 + b.phase) * 0.2, b.z), _q, _s.set(1, 1, 1));
      this.bonusMesh.setMatrixAt(i, _m);
    }
    this.bonusMesh.instanceMatrix.needsUpdate = true;

    // Ударная волна
    if (this.shockActive && this.shockwave) {
      this.shockT += dt * 3.2;
      const sc = 1 + this.shockT * 2.2;
      this.shockwave.scale.set(sc, sc, 1);
      (this.shockwave.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - this.shockT * 0.35);
      this.shockwave.position.z += dt * 16;
      if (this.shockT >= 2.4) {
        this.shockActive = false;
        this.shockwave.visible = false;
      }
    }

    // Вспышка
    if (this.flashMesh && this.flashMesh.visible) {
      this.flashT -= dt;
      (this.flashMesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, this.flashT * 1.8);
      if (this.flashT <= 0) this.flashMesh.visible = false;
    }

    // Камера
    const shakeX = (Math.random() - 0.5) * this.shakeAmp * 0.4;
    const shakeY = (Math.random() - 0.5) * this.shakeAmp * 0.35;
    this.shakeAmp *= Math.pow(0.001, dt);
    const targetFov = 62 + Math.min(12, speed * 0.9) + this.fovKick;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 4);
    this.camera.updateProjectionMatrix();
    this.fovKick *= Math.pow(0.001, dt);

    const camX = leaderX * 0.55 + shakeX;
    const camY = 7.2 + shakeY;
    const camZ = leaderZ - 9;
    this.camera.position.x += (camX - this.camera.position.x) * Math.min(1, dt * 6);
    this.camera.position.y += (camY - this.camera.position.y) * Math.min(1, dt * 6);
    this.camera.position.z += (camZ - this.camera.position.z) * Math.min(1, dt * 6);
    this.camera.lookAt(leaderX * 0.8, 1.4, leaderZ + 4);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /** Настройка качества на лету (LOD). */
  setQuality(q: Quality): void {
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q === "high" ? 2 : q === "med" ? 1.5 : 1));
    this.renderer.shadowMap.enabled = q !== "low";
    this.decorMesh.count = q === "low" ? 0 : this.decorCount;
  }

  /** Сброс уровня: очистить ворота, монеты, стену. */
  resetLevel(): void {
    for (const [key, mesh] of this.obstacleMeshes) {
      mesh.count = 0;
      void key;
    }
    for (const key of ["good", "bad"]) {
      this.gatePillars.get(key)!.count = 0;
      this.gateTops.get(key)!.count = 0;
    }
    for (const sp of this.gateSprites) this.scene.remove(sp);
    this.gateSprites.length = 0;
    this.coinCount = 0;
    this.bonusCount = 0;
    this.coinBase = [];
    this.bonusBase = [];
    this.meteorMesh.count = 0;
    this.crowdMesh.count = 0;
    if (this.wallMesh) this.wallMesh.visible = false;
    if (this.spikesMesh) this.spikesMesh.count = 0;
    this.setupEventFx("none");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ro?.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function symbolForGate(kind: GateKind, n: number): string {
  switch (kind) {
    case "double":
      return "×2";
    case "triple":
      return "×3";
    case "plus":
      return `+${n}`;
    case "minus":
      return `−${n}`;
    case "half":
      return "÷2";
    case "gamble":
      return "?";
    case "special":
      return "★";
    case "conditional":
      return "⚖";
  }
}
