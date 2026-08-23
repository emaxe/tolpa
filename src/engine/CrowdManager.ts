import * as THREE from 'three';
import { MobInstance, MobType, FormationType } from '../types/game';
import { calculateFormationOffset, clamp, lerp, TRACK_RAIL_MARGIN } from '../utils/math';
import { createHumanoidGeometry } from '../utils/proceduralMeshes';
import { stateManager, INITIAL_SKINS } from '../core/StateManager';
import { eventBus } from '../core/EventBus';
import { soundEngine } from '../audio/SoundEngine';

export class CrowdManager {
  private scene: THREE.Scene;
  private instancedMesh: THREE.InstancedMesh;
  private maxCapacity: number = 400;
  private mobs: MobInstance[] = [];
  // Живой счётчик толпы — getAliveCount() раньше сканировал все 200 слотов на каждый
  // вызов (а вызывался по многу раз за кадр из FinishLine/GameEngine/Gate/Boss).
  private aliveCount: number = 0;
  // Переиспользуемый буфер для killMobs/consumeMobs — раньше каждый вызов делал
  // .filter().sort() (две аллокации на каждое убийство).
  private aliveScratch: MobInstance[] = [];

  // Reusable 3D math objects to guarantee ZERO runtime GC allocations
  private dummy: THREE.Object3D = new THREE.Object3D();
  private colorDummy: THREE.Color = new THREE.Color();
  private animTime: number = 0;
  /** Цвет обычных мобов из снаряжённого скина игрока (обновляется при reset). */
  private currentSkinColor: number = 0x00f0ff;

  // Crowd State
  public leaderX: number = 0;
  public leaderZ: number = 0;
  // Дефолтная формация — ОВАЛ, вытянутый вперёд: толпа по умолчанию строится в эллипс
  // вдоль трассы, а не стягивается в клин. Клин/шеренга остаются доступны как выбор игрока.
  public formation: FormationType = 'oval';
  public isHyperMode: boolean = false;
  public hyperTimer: number = 0;

  // Игровая половина ширины трассы (trackWidth/2 - TRACK_RAIL_MARGIN) — считается в
  // update()/reset() и используется и для формации (calculateFormationOffset), и для
  // жёсткого клампа позиции каждого бойца, и для клампа точки спавна.
  private playableHalfWidth: number = 5;
  // Физическая половина ширины трассы (trackWidth/2) — за этим краем бойцы падают.
  private trackHalfWidth: number = 8;

  constructor(scene: THREE.Scene, maxMobs: number = 400) {
    this.scene = scene;
    this.maxCapacity = maxMobs;

    const geo = createHumanoidGeometry();
    // ВАЖНО: InstancedMesh перемножает material.color × instanceColor в шейдере.
    // Если базовый цвет не белый (например, cyan), любой инстанс, окрашенный в другой
    // цвет скина, получит искажённый (почти чёрный) результат. Поэтому базовый цвет —
    // чистый белый, а реальный цвет каждого моба задаётся через instanceColor.
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
      metalness: 0.7,
      emissive: 0x0284c7,
      emissiveIntensity: 0.35,
    });

    this.instancedMesh = new THREE.InstancedMesh(geo, mat, this.maxCapacity);
    this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instancedMesh.castShadow = true;
    this.instancedMesh.receiveShadow = true;
    // Three.js вычисляет boundingSphere для InstancedMesh один раз и кэширует навсегда —
    // инвалидации при setMatrixAt() нет. Мёртвые слоты вечно стоят в (0,-100,0), поэтому
    // сфера получается статичной (~50 единиц радиуса вокруг начала координат) и как только
    // камера уезжает дальше по Z, весь меш толпы молча выбрасывается из рендера. Отключаем
    // культинг для этого меша — он и так один draw call, отбрасывать его не нужно.
    this.instancedMesh.frustumCulled = false;
    this.scene.add(this.instancedMesh);

    this.initPool();
  }

  private initPool(): void {
    this.mobs = [];
    for (let i = 0; i < this.maxCapacity; i++) {
      this.mobs.push({
        id: i,
        type: 'regular',
        x: 0,
        y: -100,
        z: 0,
        targetX: 0,
        targetZ: 0,
        vx: 0,
        vz: 0,
        alive: false,
        scale: 1.0,
        color: 0x00f0ff,
        hp: 1,
        maxHp: 1,
        shieldHp: 0,
        animOffset: Math.random() * Math.PI * 2,
        invulnerableTime: 0,
      });
      this.dummy.position.set(0, -100, 0);
      this.dummy.updateMatrix();
      this.instancedMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  public reset(startingCount: number = 1, startZ: number = 0, trackWidth: number = 16): void {
    const upgrades = stateManager.getState().upgrades;
    const totalStart = startingCount + upgrades.startingMobs;

    // Цвет обычных мобов берём из снаряжённого скина игрока.
    const eqSkin = stateManager.getState().equippedSkin;
    const skin = INITIAL_SKINS.find((s) => s.id === eqSkin);
    this.currentSkinColor = skin ? parseInt(skin.colorHex.replace('#', ''), 16) : 0x00f0ff;
    // Синхронизируем emissive материала с emissive скина для целостного свечения.
    if (skin && this.instancedMesh.material instanceof THREE.MeshStandardMaterial) {
      this.instancedMesh.material.emissive.set(skin.emissiveHex);
    }

    this.leaderX = 0;
    this.leaderZ = startZ;
    this.animTime = 0;
    this.isHyperMode = false;
    this.hyperTimer = 0;
    // До первого спавна — иначе spawnMob() использовал бы клампы со старого/дефолтного уровня.
    this.playableHalfWidth = trackWidth / 2 - TRACK_RAIL_MARGIN;
    this.trackHalfWidth = trackWidth / 2;

    // Reset all mobs
    this.aliveCount = 0;
    for (let i = 0; i < this.maxCapacity; i++) {
      this.mobs[i].alive = false;
      this.mobs[i].y = -100;
      this.dummy.position.set(0, -100, 0);
      this.dummy.updateMatrix();
      this.instancedMesh.setMatrixAt(i, this.dummy.matrix);
    }

    // Spawn starting mobs
    for (let i = 0; i < totalStart; i++) {
      this.spawnMob('regular', 0, startZ);
    }

    this.updateMobPositions(0, true);
  }

  public getAliveCount(): number {
    return this.aliveCount;
  }

  /** Возвращает живых мобов. ВАЖНО: возвращает переиспользуемый внутренний буфер —
   *  содержимое валидно только до следующего вызова getAliveMobs()/killMobs()/consumeMobs().
   *  Не храни ссылку на результат между кадрами. */
  public getAliveMobs(): MobInstance[] {
    this.aliveScratch.length = 0;
    for (let i = 0; i < this.mobs.length; i++) {
      if (this.mobs[i].alive) this.aliveScratch.push(this.mobs[i]);
    }
    return this.aliveScratch;
  }

  public setFormation(f: FormationType): void {
    if (this.formation !== f) {
      this.formation = f;
      soundEngine.playSound('formation_change');
      eventBus.emit('formationChanged', f);
    }
  }

  public activateHyperMode(duration: number = 5.0): void {
    const upgrades = stateManager.getState().upgrades;
    const totalDuration = duration * (1 + upgrades.adrenalineDuration * 0.15);

    this.isHyperMode = true;
    this.hyperTimer = totalDuration;
    soundEngine.playSound('adrenaline_activate');
    // Прогресс достижения adrenaline_god — единая точка активации (кнопка + адреналиновые ворота).
    stateManager.recordAdrenalineActivation();
    eventBus.emit('adrenalineTriggered', { duration: totalDuration });
  }

  /** Лечит всех живых мобов на `amount` HP (не выше их максимума). Возвращает число вылеченных. */
  public healAll(amount: number): number {
    let healed = 0;
    for (const mob of this.mobs) {
      if (!mob.alive) continue;
      if (mob.hp >= mob.maxHp) continue;
      mob.hp = Math.min(mob.maxHp, mob.hp + amount);
      healed++;
    }
    if (healed > 0) soundEngine.playSound('heal');
    return healed;
  }

  public spawnMob(preferredType?: MobType, spawnX?: number, spawnZ?: number): MobInstance | null {
    const upgrades = stateManager.getState().upgrades;
    let mobType: MobType = preferredType || 'regular';

    if (!preferredType) {
      const rand = Math.random();
      const tankChance = upgrades.tankSpawnChance * 0.08;
      const ninjaChance = upgrades.ninjaSpawnChance * 0.08;
      const mageChance = upgrades.mageSpawnChance * 0.08;

      if (rand < tankChance) mobType = 'tank';
      else if (rand < tankChance + ninjaChance) mobType = 'ninja';
      else if (rand < tankChance + ninjaChance + mageChance) mobType = 'mage';
    }

    // Find first inactive slot
    for (let i = 0; i < this.mobs.length; i++) {
      const mob = this.mobs[i];
      // Пропускаем слоты, где моб ещё проигрывает death-анимацию, — иначе новый
      // персонаж перезапишет матрицу умирающего в одном и том же инстансе.
      if (!mob.alive && !mob.dying) {
        mob.alive = true;
        this.aliveCount++;
        mob.type = mobType;
        mob.x =
          spawnX !== undefined
            ? spawnX
            : clamp(this.leaderX + (Math.random() - 0.5) * 2, -this.playableHalfWidth, this.playableHalfWidth);
        mob.y = 0;
        mob.z = spawnZ !== undefined ? spawnZ : this.leaderZ - (Math.random() * 2);
        mob.targetX = mob.x;
        mob.targetZ = mob.z;
        mob.vx = 0;
        mob.vz = 0;
        mob.invulnerableTime = 0.5;

        // Colors and Stats per type. Масштаб ×0.65 от исходного — дорожка стала шире,
        // а юниты мельче, чтобы гарантированно помещалось намного больше бойцов.
        if (mobType === 'tank') {
          mob.scale = 0.88;
          mob.hp = 3;
          mob.maxHp = 3;
          mob.shieldHp = 2;
          mob.color = 0xf59e0b; // Amber / Gold
        } else if (mobType === 'ninja') {
          mob.scale = 0.55;
          mob.hp = 1;
          mob.maxHp = 1;
          mob.shieldHp = 0;
          mob.color = 0xa855f7; // Purple
        } else if (mobType === 'mage') {
          mob.scale = 0.65;
          mob.hp = 2;
          mob.maxHp = 2;
          mob.shieldHp = 1;
          mob.color = 0x10b981; // Emerald
        } else {
          // Regular mob: equip skin color из снаряжённого скина игрока
          mob.scale = 0.65;
          mob.hp = 1;
          mob.maxHp = 1;
          mob.shieldHp = 0;
          mob.color = this.currentSkinColor;
        }

        this.colorDummy.setHex(mob.color);
        this.instancedMesh.setColorAt(i, this.colorDummy);

        stateManager.runRecordMobSpawn(1);
        return mob;
      }
    }
    return null;
  }

  /** Возвращает фактически заспавненное число (может быть меньше count из-за потолка maxCapacity). */
  public addMobs(count: number): number {
    const toSpawn = Math.min(count, this.maxCapacity - this.getAliveCount());
    for (let i = 0; i < toSpawn; i++) {
      this.spawnMob();
    }
    if (toSpawn > 0) {
      soundEngine.playSound('mob_spawn');
      if (this.instancedMesh.instanceColor) {
        this.instancedMesh.instanceColor.needsUpdate = true;
      }
      stateManager.runRecordMaxCrowd(this.getAliveCount());
    }
    return toSpawn;
  }

  public killMobs(count: number, reason: string = 'obstacle'): number {
    if (this.isHyperMode) return 0; // Invulnerable in hyper mode
    if (count <= 0) return 0;

    const defenseAuraLvl = stateManager.getState().upgrades.defenseAura;
    const damageReduction = defenseAuraLvl * 0.1; // up to 50%
    // Урон 0 после брони должен оставаться 0, а не превращаться в гарантированную смерть.
    const finalCount = Math.max(0, Math.round(count * (1 - damageReduction)));
    if (finalCount <= 0) return 0;

    let killed = 0;
    let budget = finalCount; // сколько "ударов" осталось потратить в этом вызове
    const alive = this.getAliveMobs();

    // Frontline mobs take damage first
    alive.sort((a, b) => b.z - a.z);

    for (let mob of alive) {
      if (budget <= 0) break;

      // Свежеспавненный моб неуязвим короткое время (защита от смерти в кадре спавна)
      if (mob.invulnerableTime > 0) continue;

      // Ninja evasion check — уворот ТРАТИТ удар, не перекладывает его на соседа
      if (mob.type === 'ninja' && Math.random() < 0.5) {
        budget--;
        continue;
      }

      // Tank shield/armor check — щит/броня тоже поглощают удар целиком
      if (mob.shieldHp > 0) {
        mob.shieldHp--;
        budget--;
        continue;
      }
      if (mob.hp > 1) {
        mob.hp--;
        budget--;
        continue;
      }

      // Kill mob
      mob.alive = false;
      this.aliveCount--;
      mob.y = -100;
      this.dummy.position.set(0, -100, 0);
      this.dummy.updateMatrix();
      this.instancedMesh.setMatrixAt(mob.id, this.dummy.matrix);
      killed++;
      budget--;
    }

    if (killed > 0) {
      soundEngine.playSound('mob_death');
      eventBus.emit('mobsKilled', { count: killed, reason, x: this.leaderX, z: this.leaderZ });
    }

    return killed;
  }

  /** Убивает точно count мобов, игнорируя броню/уклонение/гипер-режим — используется стеной множителей. */
  public consumeMobs(count: number): number {
    if (count <= 0) return 0;
    let killed = 0;
    const alive = this.getAliveMobs().sort((a, b) => b.z - a.z);
    for (const mob of alive) {
      if (killed >= count) break;
      mob.alive = false;
      this.aliveCount--;
      mob.y = -100;
      this.dummy.position.set(0, -100, 0);
      this.dummy.updateMatrix();
      this.instancedMesh.setMatrixAt(mob.id, this.dummy.matrix);
      killed++;
    }
    return killed;
  }

  /** Убивает конкретного моба по id, игнорируя броню/уклонение/гипер-режим. Возвращает true, если убит. */
  public killMobById(id: number): boolean {
    const mob = this.mobs[id];
    if (!mob || !mob.alive || mob.dying) return false;
    // Сразу убираем из живых (коллизии/aliveCount больше его не видят), но включаем
    // death-анимацию: моб заваливается и схлопывается за ~0.5с (updateDeathMobs),
    // затем слот окончательно освобождается.
    mob.alive = false;
    this.aliveCount--;
    mob.dying = true;
    mob.deathT = 0;
    mob.deathRotX = (Math.random() - 0.5) * 2.2;
    mob.deathRotZ = (Math.random() - 0.5) * 2.2;
    mob.deathScale = 1.0;
    // Сбрасываем падение с края, если моб успел улететь
    mob.falling = false;
    mob.fallVy = 0;
    return true;
  }

  /** Возвращает фактический прирост (может быть 0, если толпа уже на потолке). */
  public multiplyMobs(factor: number): number {
    const current = this.getAliveCount();
    const target = Math.min(this.maxCapacity, Math.floor(current * factor));
    const diff = target - current;
    return diff > 0 ? this.addMobs(diff) : 0;
  }

  public divideMobs(divisor: number): void {
    if (divisor <= 1) return;
    const current = this.getAliveCount();
    const target = Math.max(1, Math.floor(current / divisor));
    const toKill = current - target;
    if (toKill > 0) this.killMobs(toKill, 'gate');
  }

  // ==== Групповые операции (изоляция по створкам ворот) ====
  // Ворота теперь применяют эффект ТОЛЬКО к мобам, прошедшим через конкретную
  // створку (left/right), а не ко всей толпе. Ниже — операции над заданным
  // подмножеством мобов, а не над всей толпой. Работают на переданном массиве
  // ссылок на MobInstance (объекты стабильны в этом.mobs, поэтому ссылки валидны
  // весь кадр, даже после внутренних getAliveMobs()).

  /** Спавнит count новых мобов в позиции створки (x,z) — для изолированного add. */
  public addMobsNear(count: number, x: number, z: number): number {
    const cap = this.maxCapacity - this.getAliveCount();
    const toSpawn = Math.min(count, cap);
    if (toSpawn <= 0) return 0;
    let spawned = 0;
    for (let i = 0; i < toSpawn; i++) {
      const m = this.spawnMob(undefined, x, z);
      if (m) spawned++;
      else break;
    }
    if (spawned > 0) {
      soundEngine.playSound('mob_spawn');
      if (this.instancedMesh.instanceColor) this.instancedMesh.instanceColor.needsUpdate = true;
      stateManager.runRecordMaxCrowd(this.getAliveCount());
    }
    return spawned;
  }

  /** Умножает ТОЛЬКО группу створки: для каждого её моба спавнит (factor-1) копий рядом.
   *  Исправлено: раньше брался Math.floor(factor)-1, что давало 0 новых мобов при factor < 2
   *  (multVal падал до 1.4 на высоких уровнях) — ворота "не срабатывали". Теперь дробная
   *  часть factor накапливается как шанс дополнительного спавна, чтобы результат был близок
   *  к умножению, даже если factor не целый. */
  public multiplyGroup(group: MobInstance[], factor: number, x: number, z: number): number {
    if (factor <= 1) return 0;
    // Целая часть — гарантированные копии на каждого моба, дробная — шанс ещё одной.
    const basePerMob = Math.floor(factor) - 1; // копий сверх оригинала на каждого
    const fracChance = factor - Math.floor(factor); // дробная часть [0,1)
    if (basePerMob < 0 && fracChance === 0) return 0;
    let added = 0;
    const alive = group.filter((m) => m.alive);
    for (const m of alive) {
      let extra = Math.max(0, basePerMob);
      // Дробная часть: с шансом fracChance добавляем ещё одного (например ×1.5 → 50% шанс +1).
      if (Math.random() < fracChance) extra += 1;
      if (extra <= 0) continue;
      const n = this.addMobsNear(extra, m.x, z);
      added += n;
      if (this.getAliveCount() >= this.maxCapacity) break;
    }
    return added;
  }

  /** Убивает до count мобов ИЗ УКАЗАННОЙ группы (броня/уклонение/щит — как killMobs). */
  public killMobsFromGroup(group: MobInstance[], count: number, reason: string = 'gate'): number {
    if (this.isHyperMode) return 0;
    if (count <= 0) return 0;
    const defenseAuraLvl = stateManager.getState().upgrades.defenseAura;
    const damageReduction = defenseAuraLvl * 0.1;
    const finalCount = Math.max(0, Math.round(count * (1 - damageReduction)));
    if (finalCount <= 0) return 0;

    const sorted = group.filter((m) => m.alive).sort((a, b) => b.z - a.z);
    let killed = 0;
    let budget = finalCount;
    for (const mob of sorted) {
      if (budget <= 0) break;
      if (mob.invulnerableTime > 0) continue;
      if (mob.type === 'ninja' && Math.random() < 0.5) { budget--; continue; }
      if (mob.shieldHp > 0) { mob.shieldHp--; budget--; continue; }
      if (mob.hp > 1) { mob.hp--; budget--; continue; }
      mob.alive = false;
      this.aliveCount--;
      mob.y = -100;
      this.dummy.position.set(0, -100, 0);
      this.dummy.updateMatrix();
      this.instancedMesh.setMatrixAt(mob.id, this.dummy.matrix);
      killed++;
      budget--;
    }
    if (killed > 0) {
      soundEngine.playSound('mob_death');
      eventBus.emit('mobsKilled', { count: killed, reason, x: this.leaderX, z: this.leaderZ });
    }
    return killed;
  }

  /** Делит ТОЛЬКО группу створки на divisor (убивает лишних из группы). */
  public divideMobsGroup(group: MobInstance[], divisor: number): number {
    if (divisor <= 1) return 0;
    const alive = group.filter((m) => m.alive);
    const target = Math.max(1, Math.floor(alive.length / divisor));
    const toKill = alive.length - target;
    if (toKill <= 0) return 0;
    return this.killMobsFromGroup(alive, toKill, 'gate');
  }

  public update(dt: number, speed: number, steerInput: number, trackWidth: number): void {
    this.animTime += dt * 15;

    // Hyper mode countdown
    if (this.isHyperMode) {
      this.hyperTimer -= dt;
      if (this.hyperTimer <= 0) {
        this.isHyperMode = false;
        this.hyperTimer = 0;
      }
    }

    // Move leader forward
    const speedMult = this.isHyperMode ? 1.4 : this.formation === 'arrow' ? 1.15 : 1.0;
    this.leaderZ += speed * speedMult * dt;

    // Steer leader left/right
    const steerSpeed = 12.0;
    this.playableHalfWidth = trackWidth / 2 - TRACK_RAIL_MARGIN;
    this.trackHalfWidth = trackWidth / 2;
    this.leaderX = clamp(
      this.leaderX + steerInput * steerSpeed * dt,
      -this.playableHalfWidth,
      this.playableHalfWidth
    );

    // Update individual mob positions & running animation
    this.updateMobPositions(dt);
    // Обновляем анимацию падения упавших с края мобов
    this.updateFallingMobs(dt);
    // Проигрываем death-анимацию погибших от препятствий/ловушек мобов
    this.updateDeathMobs(dt);
  }

  // Анимация падения мобов, вышедших за край дорожки: ускорение вниз + вращение.
  // Когда моб улетает достаточно далеко вниз — окончательно удаляется из сцены.
  private updateFallingMobs(dt: number): void {
    for (let i = 0; i < this.mobs.length; i++) {
      const mob = this.mobs[i];
      if (!mob.falling) continue;

      // Гравитация
      mob.fallVy = (mob.fallVy || 0) - 18 * dt;
      mob.y += (mob.fallVy || 0) * dt;
      // Вращение при падении
      mob.fallRotX = (mob.fallRotX || 0) + dt * 2.5;
      mob.fallRotZ = (mob.fallRotZ || 0) + dt * 1.8;

      // Обновляем матрицу
      this.dummy.position.set(mob.x, mob.y, mob.z);
      this.dummy.rotation.set(mob.fallRotX, 0, mob.fallRotZ);
      const s = mob.scale;
      this.dummy.scale.set(s, s, s);
      this.dummy.updateMatrix();
      this.instancedMesh.setMatrixAt(mob.id, this.dummy.matrix);

      // Улетел достаточно далеко — удаляем окончательно
      if (mob.y < -12) {
        mob.falling = false;
        mob.alive = false;
        this.aliveCount--;
        mob.y = -100;
        this.dummy.position.set(0, -100, 0);
        this.dummy.updateMatrix();
        this.instancedMesh.setMatrixAt(mob.id, this.dummy.matrix);
      }
    }
    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  // Death-анимация мобов, погибших от препятствий/ловушек: заваливание + схлопывание.
  // Моб уже убран из живых (alive=false), но слот удерживается, пока проигрывается
  // анимация (~0.5с), затем матрица отправляется в (0,-100,0) и слот освобождается.
  private updateDeathMobs(dt: number): void {
    for (let i = 0; i < this.mobs.length; i++) {
      const mob = this.mobs[i];
      if (!mob.dying) continue;

      mob.deathT = (mob.deathT || 0) + dt;
      const t = Math.min(1, (mob.deathT || 0) / 0.5);
      // Плавное заваливание + схлопывание к центру
      const rot = t * 2.2;
      const s = Math.max(0.05, 1.0 - t * 0.7);
      mob.deathRotX = mob.deathRotX || 0;
      mob.deathRotZ = mob.deathRotZ || 0;

      this.dummy.position.set(mob.x, mob.y, mob.z);
      this.dummy.rotation.set(mob.deathRotX * t, 0, mob.deathRotZ * t);
      this.dummy.scale.set(s, s, s);
      this.dummy.updateMatrix();
      this.instancedMesh.setMatrixAt(mob.id, this.dummy.matrix);

      if (t >= 1) {
        mob.dying = false;
        mob.y = -100;
        this.dummy.position.set(0, -100, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        this.instancedMesh.setMatrixAt(mob.id, this.dummy.matrix);
      }
    }
    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  private updateMobPositions(dt: number, instant: boolean = false): void {
    const aliveMobs = this.getAliveMobs();
    const totalCount = aliveMobs.length;
    let index = 0;

    for (let mob of aliveMobs) {
      if (mob.invulnerableTime > 0) {
        mob.invulnerableTime = Math.max(0, mob.invulnerableTime - dt);
      }

      const offset = calculateFormationOffset(index, totalCount, this.formation, this.playableHalfWidth);
      // Формация сама сжимается под ширину трассы (calculateFormationOffset). Жёсткий
      // кламп к playableHalfWidth УБРАН: бойцы могут выходить за игровую зону к самому
      // краю дорожки, и если выходят за физический край (trackHalfWidth) — падают.
      mob.targetX = this.leaderX + offset.x;
      mob.targetZ = this.leaderZ - offset.z;

      if (instant) {
        mob.x = mob.targetX;
        mob.z = mob.targetZ;
      } else {
        // Organic flocking spring interpolation
        mob.x = lerp(mob.x, mob.targetX, Math.min(1.0, 14.0 * dt));
        mob.z = lerp(mob.z, mob.targetZ, Math.min(1.0, 14.0 * dt));
      }

      // Если боец вышел за физический край дорожки — начинает падать вниз (анимация
      // падения с вращением), а не мгновенно исчезает. Падение обрабатывается в
      // updateFallingMobs().
      if (Math.abs(mob.x) > this.trackHalfWidth && !mob.falling) {
        mob.falling = true;
        mob.fallVy = 0;
        mob.fallRotX = (Math.random() - 0.5) * 0.6;
        mob.fallRotZ = (Math.random() - 0.5) * 0.6;
        // Спецэффект: вспышка у края + звук падения
        eventBus.emit('mobFell', { x: mob.x, z: mob.z });
        continue;
      }

      // Procedural running hop & tilt — forward lean + natural stride
      const hop = Math.abs(Math.sin(this.animTime + mob.animOffset)) * 0.25;
      mob.y = hop;

      // Setup 3D transform
      this.dummy.position.set(mob.x, mob.y, mob.z);

      const tilt = (mob.targetX - mob.x) * 0.3;
      // Forward lean (pitch) makes the run read as dynamic; slight roll from steering.
      const lean = 0.12 + Math.abs(Math.sin(this.animTime + mob.animOffset)) * 0.08;
      this.dummy.rotation.set(lean, 0, -tilt);

      const s = mob.scale * (this.isHyperMode ? 1.15 : 1.0);
      this.dummy.scale.set(s, s, s);
      this.dummy.updateMatrix();

      this.instancedMesh.setMatrixAt(mob.id, this.dummy.matrix);

      index++;
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  public dispose(): void {
    this.instancedMesh.geometry.dispose();
    if (Array.isArray(this.instancedMesh.material)) {
      this.instancedMesh.material.forEach((m) => m.dispose());
    } else {
      this.instancedMesh.material.dispose();
    }
  }
}
