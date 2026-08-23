---
name: tolpa-game-development
description: Develop and extend TOLPA (Crowd Evolution 3D / Cyber Legion) — a high-performance procedural 3D tactical crowd runner built with React 19, Three.js, TypeScript, Tailwind CSS v4, and Web Audio API. Use when creating levels, tuning mob formations/classes, adding obstacles/bosses, implementing audio synthesis, or fixing physics/state bugs.
tags: [tolpa, threejs, react, typescript, crowd-runner, web-audio, zero-gc]
---

# TOLPA Game Development

## 1. Project Overview & Architecture

**TOLPA (Crowd Evolution 3D / Cyber Legion)** is a 3D tactical crowd runner web game developed with **TypeScript**, **React 19**, **Three.js**, **Tailwind CSS v4**, and the **Web Audio API**. 100% of all assets (3D geometries, textures, sound effects, and music tracks) are generated procedurally at runtime.

### Key Architecture Modules

| Module / File | Responsibility |
|---|---|
| `src/engine/GameEngine.ts` | Main animation loop (`rAF`), chase camera with speed-lag compensation, lighting, track decor, user input dispatch, pause/lifecycle management. |
| `src/engine/CrowdManager.ts` | Single `InstancedMesh` managing up to 200 units, 5 formations, organic spring flocking, edge falling animation, class specializations (`tank`, `ninja`, `mage`). |
| `src/engine/GateManager.ts` | Procedural math gates — INDEPENDENT openings (not wings), per-mob collision via `processedMobs`, motion (horizontal/vertical/rotate), combo counter. |
| `src/engine/BonusManager.ts` | Collectible glowing sphere/star bonuses (`add_mobs`/`heal`/`adrenaline`/`coins`) — pulsing, rotating, gathered by crowd leader. |
| `src/engine/ObstacleManager.ts` | 5 hazard types (`saw_blade`, `axe_pendulum`, `crusher`, `laser_grid`, `spike_trap`), height-aware hazard filtering (`isHazardActive`), coin pickup (`2x` for Ninjas). |
| `src/engine/BossManager.ts` | 5 campaign bosses (L10, 20, 30, 40, 50), forward progression arena lock, telegraph rings, batched AOE damage, timed retaliation. |
| `src/engine/FinishLineManager.ts` | Multiplier castle wall steps ($\times 1.2$ to $\times 10.0$), mob sacrifice cost, apex chest, and victory confetti celebration. |
| `src/engine/LevelGenerator.ts` | Deterministic PRNG level generator, track scaling, gate spacing, safe hazard clearance nudging, and endless segment chunk streaming. |
| `src/engine/ParticleSystem.ts` | Zero-GC `InstancedMesh` particle pool (300 particles) for explosions, sparks, and speed trails. |
| `src/core/StateManager.ts` | Centralized state singleton, hot in-memory `RunStats` buffer, debounced `localStorage` saving, base64 import/export, upgrade and achievement calculators. |
| `src/core/EventBus.ts` | Strictly-typed event bus (`screenShake`, `gatePassed`, `mobsKilled`, `obstacleSmashed`, `bossDamaged`, `mobFell`). |
| `src/audio/SoundEngine.ts` | Procedural Web Audio API synthesizer for 30+ SFX and 12 music themes (see §5). |
| `src/utils/math.ts` | Math helpers (`clamp`, `lerp`, `calculateFormationOffset`, `checkCircleRectCollision`, `TRACK_RAIL_MARGIN`). |
| `src/utils/proceduralMeshes.ts` | Procedural 3D geometries (humanoids, bosses, saw blades, crushers) and Canvas2D gate texture rendering. |

---

## 2. Core Coordinates & Mathematics

### Camera and Spatial Orientation
Three.js uses a right-handed coordinate system:
- **Forward Travel**: Along **$+Z$** (`leaderZ` increases as the player runs).
- **Chase Camera**: Placed behind the crowd at $Z = \text{leaderZ} - (16.0 + \text{speedLag})$, $Y = 6.0$, looking forward toward $(\text{leaderX} \times 0.2, 2.5, \text{leaderZ} + 6.0)$.
- **Camera Axis Mirror Trap**:
  - Because the camera looks along $+Z$, **screen-right is $-X$** and **screen-left is $+X$**.
  - Steering right (pressing `D`, `→`, or swiping right) must **DECREASE** `leaderX`.
  - Steering left (pressing `A`, `←`, or swiping left) must **INCREASE** `leaderX`.
- **Track Dimensions & Rail Margins**:
  - Track Width: `DEFAULT_TRACK_WIDTH = 16`.
  - Rail Margin: `TRACK_RAIL_MARGIN = 1.2` (defined in `src/utils/math.ts`).
  - Playable Half-Width: $\text{playableHalfWidth} = \frac{16}{2} - 1.2 = 6.8$ (strict clamping boundary for crowd leader).
  - Physical Track Half-Width: $\text{trackHalfWidth} = 8.0$ (edge boundary where mobs fall).

---

## 3. Subsystem Breakdown & Mechanics

### 3.1. Crowd Management (`CrowdManager.ts`)
- **Capacity**: Pre-allocated `InstancedMesh` of 200 mobs.
- **Formations** (`calculateFormationOffset` in `src/utils/math.ts`):
  - `oval` (Default): Forward-elongated golden-spiral ellipse along $Z$. Dynamically compresses when crowd size exceeds `playableHalfWidth`.
  - `wedge`: V-shaped formation (-40% frontal trap damage).
  - `wide`: Horizontal sweeping line for maximum width coverage.
  - `circle`: Concentric phalanx for ramming bosses and obstacles.
  - `arrow`: Narrow spearhead (+15% run speed bonus).
- **Class Abilities**:
  - `regular`: Standard unit ($1\times$ HP, scale $0.65$).
  - `tank`: 3 HP + 2 Shield, scale $0.88$, smashes destructible obstacles on contact without crowd loss.
  - `ninja`: 50% dodge chance against damage, $2\times$ coin pickup multiplier, scale $0.55$.
  - `mage`: 2 HP + 1 Shield, transmutes negative gates ($-N$, $\div N$) into positive bonuses ($+N$, $\times N$).
- **Edge Drop Physics**:
  - Mobs beyond $|x| > \text{trackHalfWidth}$ enter `falling = true`.
  - Fall velocity integrates gravity: $\text{fallVy} -= 18 \times dt$.
  - Tumbling rotation: $\text{fallRotX} += dt \times 2.5$, $\text{fallRotZ} += dt \times 1.8$.
  - When $y < -12$, mob is recycled to $(0, -100, 0)$ and `aliveCount` decreases.

### 3.2. Independent Math Gates (`GateManager.ts`) + Countdown Walls — REDESIGNED 2026-08-23
**REDESIGNED (2026-08-23, commit `83ab4e0`)**: gates are no longer pairs of wings. They are now
**independent single openings** — 1–3 per row, staggered (уступами), partial or full track width,
and they may move (horizontal/vertical), rotate, or stay static. `subtract (−N)` was REMOVED from
gates entirely and moved to a separate **countdown Wall** (see `WallManager` below).
`GateData` is now `{id,z,x,width,op,value,motion,motionSpeed,motionRange,passed}` where `op: 'add'|'multiply'|'divide'` (ALL integer values, no floats).
- **Per-Mob Processing**: `processedMobs: Set<number>` tests each mob individually as it crosses gate `Z`. A mob only triggers the gate if its `X` falls inside the opening (`|mob.x - cx| <= width/2 + 0.4`), where `cx` is the gate's current X (motion-aware). Mobs outside the opening are unaffected.
- **`applyMotion(gv, dt)`**: `horizontal` → `group.position.x = baseX + sin(phase)*range`; `vertical` → `group.position.y = baseY + |sin(phase)|*range` (**UP-ONLY from the floor** — see Pitfall 25, gates no longer sink below y=0); `rotate` → `group.rotation.y = sin(phase)*range*0.5` (narrows the effective opening).
- **Operations** (all integer):
  - `add (+N)`: `crowd.addMobsNear(value, gateX, gateZ)`.
  - `multiply (×N)`: `crowd.multiplyGroup(wing, value, ...)` — integer N≥2, works PER-MOB (each mob passing spawns N−1 copies).
  - `divide (÷N)`: `crowd.divideMobsByStep(wing, value, 'gate')` — **AUTHORITATIVE SEMANTICS (user-corrected 2026-08-23): every N-th mob SURVIVES, ALL others DIE.** ÷2 → every 2nd survives, every other dies; ÷3 → every 3rd survives, the rest die. This is the user's exact rule: *«умирают все кто проходит кроме каждого N-ного»* (all who pass die EXCEPT every N-th). Returns removed count; caller uses `netChange = -crowd.divideMobsByStep(...)`. ⚠️ The phrase «пропустить каждого N-го» is AMBIGUOUS and caused an inverted implementation — see Pitfall 21.
- **`multiplyGroup` fractional-factor fix**: integer part = guaranteed copies per mob, fractional part = per-mob spawn chance. Generator now clamps `multVal = Math.max(2.0, round(2.2 - levelNum*0.015))` (integer ≥2).
- **EMP storm** (`applyEmpStorm`/`clearEmpStorm`): since gates are positive-only now, EMP flips `add`/`multiply` gates to `÷2` (not sign-flip); purple tint on `MeshBasicMaterial.color`. Originals in `empOriginals[]`.
- **Generator**: `generateLevel` and `generateEndlessSegment` both pick `op` (add 45% / multiply 30% / divide 25% on gates ≥ index 2; first 2 gates always `add`), a random `motion` from `['none','none','none','horizontal','vertical','rotate']`, and a width/position that stays within track bounds. Row layout: `rowCount = 1 + floor(rng()*3)`.

### 3.2b. Countdown Walls (`WallManager.ts`) — NEW 2026-08-23
`subtract (−N)` became **walls with a counter** instead of gates. `WallData` is `{id,z,x,width,count,killsRemaining,destroyed}`.
- **Mechanic**: each mob passing through the wall reduces `killsRemaining` by 1 (`crowd.killOneFromGroup(through, 'wall')`). When the counter hits 0 the wall **falls** (rotation.x → π/2 over ~1.2s) and is removed with a red burst.
- **Visual**: `createWallTexture(count)` — red gradient, `−N` large glyph, "СТЕНА" label; texture regenerated on every kill to show the shrinking counter (`updateCounterTexture`).
- **Generator**: campaign `min(12, 2 + floor(levelNum/8))` walls (level ≥3), endless 1 per 120m segment. Placed away from gates and boss arena. Wired in `GameEngine` (`walls` field, `initWalls`/`appendWalls`/`update` after `gates.update`).

### 3.8. Collectible Bonuses (`BonusManager.ts`) — VERIFIED 2026-08-23
Bonus effects moved OUT of gates into **collectible glowing spheres/stars** (the `BonusManager`). Each is a pulsing sphere + rotating torus ring + Canvas2D icon (zero-asset). Gathered by the crowd leader (same `|dz|<2.2 && |dx|<3.5` box as coins). 4 types, colored:
- `add_mobs` (emerald `0x10b981`, icon `+`): `crowd.addMobsNear(value, ...)`.
- `heal` (light-green `0x34d399`, icon `♥`): `crowd.healAll(value)` — new `CrowdManager.healAll(amount)` heals all alive mobs up to `maxHp`, returns count healed, plays new `heal` SFX.
- `adrenaline` (yellow `0xfacc15`, icon `⚡`): `crowd.activateHyperMode(value)`.
- `coins` (amber `0xf59e0b`, icon `$`): `stateManager.runAddCoins(value)`.

Wiring: `BonusData[]` on `LevelConfig` + endless segment; `BonusManager` registered in `GameEngine` (field `bonus`, `initBonuses` in `loadLevel`/endless start, `appendBonuses` in `updateEndlessStreaming`, `update` in loop after `gates.update`, `clear` via `initBonuses`). Generator places bonuses in safe corridors, skipping spots within `GATE_CLEARANCE` of a gate or 4m of an obstacle. Campaign count `min(14, 4 + floor(levelNum/4))`; endless 1-2 per 120m segment. Icon texture via Canvas2D (no external assets), textures cached per `type:label` in a `Map`.
NOTE (2026-08-23 redesign): since `subtract`/`divide` gates were replaced (see §3.2/§3.2b), the `mage` class no longer transmutes negative gates — the transmute branches for `subtract`/`divide` in `GateManager` are gone. Mage still exists as a class (2HP + shield).

### 3.3. Obstacles & Height Filtering (`ObstacleManager.ts`)
- **Traps**: `saw_blade`, `axe_pendulum`, `crusher`, `laser_grid`, `spike_trap`, `wrecking_ball`, `lava_pit`, `barrier_gate`.
- **Height-Aware Hazard Gate (`isHazardActive`)**:
  - `crusher` is only lethal when $y \\le 1.2$.
  - `axe_pendulum` is only lethal when $|\\text{rotZ}| < 0.55$.
  - `barrier_gate` (VERIFIED 2026-08-23 — revived from dead-but-supported): the gate plate is `mesh.children[3]`; lethal only when `mesh.position.y + plate.position.y < 2.4` (plate lowered), safe when the plate is raised and the crowd passes under. The group sits at `y = 0.5` (set by `buildObstacleVisual`'s `mesh.position.set(obs.x, obs.y || 0.5, obs.z)`), so read `obsVis.mesh.position.y + gate.position.y`, not the plate's raw local Y.
- **Instant Kill**: Any mob overlapping an active trap is instantly eliminated via `killMobById(mob.id)`.
- **Active "Killing-Part" Hazard Box (VERIFIED 2026-08-23)**: Obstacles only kill when a mob touches the *actual dangerous part*, not the static bounding box. `ObstacleVisual` carries `hazardX/hazardZ/hazardW/hazardD` (plus `setHazard(vis,x,z,w,d)` helper). The `update()` switch recomputes these **every frame under the animation**, and `checkObstacleCollision` runs `checkCircleRectCollision` against `obsVis.hazard*`, NOT `obs.x/obs.z/obs.width/obs.depth`. Per type:
  - `barrier_gate`: hazard = thin bar of the plate (`w=3.4, d=0.45`), plus `isHazardActive` gates on plate world-Y — mobs pass the posts/rail freely when the plate is raised.
  - `axe_pendulum`: hazard follows the axe head X (swept by `sin(rotZ)*3.0`), narrow (`w=1.3,d=0.9`); `isHazardActive` gates on `|rotZ|<0.55`.
  - `wrecking_ball`: hazard = just the ball (`w=d=1.6`) at its swept X, not the whole swing path.
  - `crusher`: plate when near ground (`isHazardActive y<=1.2`).
  - `saw_blade` / `laser_grid` / `lava_pit`: full area (already contiguous danger).
  - Signature is `setHazard(vis, x, z, w, d)` — **5 args incl. z**. Omitting `z` is the classic slip (TS: "Expected 5 arguments, but got 4") — every call must pass both x AND z.
- **Destruction**: If Hyper Mode is active or a Tank hits a destructible trap (`crusher`, `axe_pendulum`), the trap is removed and emits `obstacleSmashed`.
- **`barrier_gate` wiring (VERIFIED 2026-08-23)**: it WAS a dead-but-supported type — in the `ObstacleType` union, with a `playDeathEffect` case and `isHazardActive` default handling, but **never spawned** by `LevelGenerator` AND had **no mesh builder** (fell through to `createSawBladeMesh`). To wire up: (1) `createBarrierGateMesh()` in `proceduralMeshes.ts` (posts + top rail + a glowing plate as `children[3]`); (2) build switch case + per-frame plate slide/pulse animation in `ObstacleManager.update`; (3) `isHazardActive` gate on the plate's world Y; (4) add `'barrier_gate'` to BOTH the campaign spawn pool AND the endless-segment pool in `LevelGenerator.ts` (two separate arrays — easy to miss one). Spawn placement: `obsWidth = 3.3`, `x = (rng()*2-1)*(playableHalf - 1.5)` keeps `|x| + width/2 ≤ 6.95 < 8.1`, passing the `препятствия не выходят за границы` vitest bound.

### 3.4. Boss Battles (`BossManager.ts`)
- **Levels**: 10, 20, 30, 40, 50.
- **Arena Lock**: While boss is alive, `crowd.leaderZ` is clamped to $\text{bossArenaZ} - 5.5$.
- **Damage Scaling**: Crowd DPS scales sub-linearly ($\min(140, 12 + N \times 1.6) \times dt$) to prevent instant boss melt while rewarding large crowds.
- **Batched AOE**: Boss slam tests all mobs in radius once and performs a single `killMobs()` call.

### 3.6. Dynamic Level Events (VERIFIED 2026-08-22 — revived from dead-but-supported)
The `events: LevelDynamicEvent[]` array on `LevelConfig` was historically generated in
`LevelGenerator` but **never executed anywhere** — a textbook "dead-but-supported" system
(types declared, data generated, localization keys present, no consumer). Now wired up:
- **5 event types** (`LevelDynamicEvent.type` in `src/types/game.ts`): `ambush`, `coin_train`,
  `emp_storm`, `meteor_rain`, `speed_boost`. Generator spawns ALL 5 deterministically (cyclic
  `eventPool[(levelNum - 3) % 5]`, plus a second event at 75% length for levels ≥ 15 non-boss),
  sorted by `triggerZ`, clamped to `trackLength - 90` so they never enter the boss arena.
- **Execution in `GameEngine`**: fields `pendingEvents` / `nextEventIndex` /
  `activeEvent: {event, timer}` / `eventSpeedMult` / `meteorAccum` / `eventFxAccum`, driven by
  `resetEventState()` (called in `loadLevel` + `endRun`) and `updateDynamicEvents(dt)` (called in
  the `update()` loop after subsystem updates). Trigger fires when `crowd.leaderZ >= triggerZ`;
  skipped entirely in endless mode (`!isEndless` guard).
- **`eventSpeedMult`** is the shared speed lever: `>1` for `speed_boost`, `0.55` for `ambush`
  (slowdown). It multiplies `this.baseSpeed` in `crowd.update(...)` AND is folded into the camera
  `speedLag` calculation so the camera keeps pace.
- **Mechanics**:
  - `speed_boost`: `eventSpeedMult = min(1.5, 1 + 0.25*intensity)`, cyan trail (add the
    `activeEvent?.event.type === 'speed_boost'` condition to the existing hyper/arrow trail gate).
  - `ambush`: `eventSpeedMult = 0.55`, red bursts + `screenShake`, `boss_roar`.
  - `coin_train`: spawns a 10-coin cluster via `obstacles.appendObstacles([], cluster)` then
    immediately completes (`activeEvent = null`) — coins use the normal collection path.
  - `emp_storm`: flips the op sign of all un-passed gates via `GateManager.applyEmpStorm()` /
    `clearEmpStorm()` (add↔subtract, multiply↔divide; purple tint on the gate `MeshBasicMaterial`
    `.color.setHex(0xa855f7)` + `needsUpdate`). Originals stored in `empOriginals[]` for restore;
    reset in `GateManager.clear()` too.
  - `meteor_rain`: periodic orange `emitBurst` meteors ahead, small chance to `killMobs(...)`.
- **HUD alert**: `eventBus.emit('levelEvent', { type })` → `HUD.tsx` subscribes, shows a timed
  (3200 ms) banner with a `EVENT_ALERT_MAP[type] -> {key, cls}` lookup (i18n `event*` keys, all 5
  already localized except `eventSpeedBoost` which was added). Banner rendered above the progress bar.
- **Zero-GC**: all per-frame work uses scalar accumulators; `coin_train` cluster allocates once at
  trigger, not per frame. No new `PointLight`/assets.

### 3.7. Phased Level Generation (VERIFIED 2026-08-23 — `LevelGenerator.ts`)
The generator was reworked from uniform placement to a **5-phase pacing model** so levels have rhythm:
- **`getPhaseInfo(z, trackLength)`** → `{ phaseIndex, phaseName, phaseMult, densityMult }`. Phases: `warmup` (0–15%, mult 1.0), `ramp` (15–45%, 1.15), `peak` (45–70%, 1.30), `corridor` (70–85%, 1.45 but `densityMult 0.85` = safe gap), `climax` (85–100%, 1.60). Damage scales by `phaseMult`; density by `densityMult`.
- **Tactical obstacle patterns** (chosen by phase):
  - `warmup`: single simple traps (`saw_blade`/`spike_trap`).
  - `ramp`: **slalom** — two `saw_blade` at `x = ±3.0`, `z` offset ~16m apart, forcing lateral weaving.
  - `peak`: **bottleneck** — flank `laser_grid` + `barrier_gate` with a guaranteed safe center pass ≥3.5m; plus **destructible clusters** (`crusher`/`axe_pendulum`/`wrecking_ball` together) to reward `tank`/adrenaline.
  - `corridor`: **safe corridor** — every ~120m (`s % 3 === 2` or corridor phase) a gap with no traps, reserved for coins/events.
- **Guaranteed wing choice**: gates never have `leftOp === rightOp` (always a tactical choice) — enforced by the arithmetic pair table + `if (leftOp === rightOp) rightOp = leftOp === 'multiply' ? 'add' : 'multiply'`.
- **`resolveOverlaps(gates, obstacles, trackWidth, minZ, maxZ)`**: post-pass that guarantees gates are never overlapped by traps — enforces `|gate.z - obs.z| >= 10.5` (test asserts ≥10) and clamps X/range to track bounds. Called after raw generation in BOTH campaign and endless.
- **`findSafeCoinX(desiredX, z, obstacles, trackWidth)`**: coin placement avoids obstacle hitboxes — if a coin's X at a given Z would land inside a trap (|dz|<2.5), shift it to a free lane with `|dx| > width/2 + 0.5`.
- **Deterministic endless**: `generateEndlessSegment` now uses `createRng(segmentIndex * 7919 + 9973)` instead of `Math.random()` — reproducible per segment index.
- **Events by phase**: `coin_train` in corridors, `speed_boost` before peak, `ambush` at bottleneck entry, `emp_storm` in dense phase, `meteor_rain` between phases; never in boss arena ±40 or first 40m.
- **Invariants preserved** (tested): gates sorted by z, `|obs.x| + width/2 <= trackWidth/2 + 0.1`, gates≤30 / obstacles≤90 / coins≤360, no soft-lock (every obstacle `width <= trackWidth - 3.2`, `barrier_gate <= 3.5`).

### 3.5. State Management & Run Batching (`StateManager.ts`)
- Gameplay events update lightweight in-memory `RunStats` during a run.
- On level finish or defeat, `commitRun()` applies multipliers, updates total coins/gems/stats, evaluates achievements, notifies UI subscribers, and triggers a debounced `localStorage` write.

---

## 4. Key Pitfalls & Lessons Learned

### Pitfall 1: Screen-Right = -X Camera Mirror Trap
- **Problem**: When implementing touch swipe or keyboard steering, naive `leaderX += steer` caused the crowd to steer in the opposite direction of the player's input.
- **Root Cause**: The camera is positioned behind the crowd looking along $+Z$. In Three.js right-handed coordinates, when looking down $+Z$, the vector pointing to the screen's right side is $-X$.
- **Rule**: Always decompose steering so that moving right decreases $X$ and moving left increases $X$:
  ```typescript
  // GameEngine.ts
  const baseFactor = (deltaX / window.innerWidth) * 45 * settings.controlsSensitivity;
  this.steerInput = clamp(-baseFactor * invertMult, -1, 1);
  ```

### Pitfall 2: Three.js InstancedMesh Frustum Culling on Inactive Off-Screen Slots
- **Problem**: As the crowd or particles advanced past $Z \approx 60$, all units or particles vanished from the screen simultaneously.
- **Root Cause**: Three.js computes a bounding sphere for `InstancedMesh` once and does not invalidate it on `setMatrixAt()`. Inactive slots parked at $(0, -100, 0)$ created a static sphere around the origin. When the camera moved past $Z \approx 60$, the entire mesh was culled.
- **Fix**: Explicitly disable frustum culling on both `CrowdManager` and `ParticleSystem`:
  ```typescript
  this.instancedMesh.frustumCulled = false;
  ```

### Pitfall 3: Quadratic Boss DPS & Multi-Mob `killMobs` Calling Spikes
- **Problem**: When a boss executed a slam attack on a crowd of 80 mobs, calling `crowd.killMobs(1)` in a per-mob loop triggered 80 `filter().sort()` allocations, freezing the browser for 200ms.
- **Fix**: Count total casualties in the area of effect first, then execute a single batched `killMobs()` call.
  ```typescript
  const hitCount = crowd.getAliveMobs().reduce((n, mob) => {
    const d = Math.sqrt(mob.x * mob.x + (mob.z - (this.bossArenaZ - 4)) ** 2);
    return d <= radius ? n + 1 : n;
  }, 0);
  if (hitCount > 0) {
    crowd.killMobs(Math.max(1, Math.round(hitCount * 0.35)), 'boss_slam');
  }
  ```

### Pitfall 4: StateManager Hot Run Stats vs Synchronous localStorage IO Spikes
- **Problem**: Calling `StateManager.addCoins()` on every coin pickup caused synchronous `JSON.stringify` and `localStorage.setItem` calls during the 60 FPS animation loop, dropping frames on mobile.
- **Fix**: Accumulate run stats in a lightweight `RunStats` object (`runAddCoins()`, `runRecordGatePass()`), and commit once at run end via `commitRun()`. Debounce all disk writes with a 500ms timer.

### Pitfall 5: 2D vs 3D Obstacle Collisions (`isHazardActive`)
- **Problem**: The player was crushed by pendulum axes and crushers while the crusher was at its peak height or the pendulum was at the top of its swing.
- **Root Cause**: `checkCircleRectCollision()` operates purely on $XZ$ coordinates and ignores $Y$.
- **Fix**: Gate collision checks behind `isHazardActive()`, checking vertical height for crushers ($y \le 1.2$) and rotation angle for pendulums ($|\text{rotZ}| < 0.55$).

### Pitfall 6: Independent Per-Mob vs Leader-Only Gate Collision
- **Problem**: When a wide crowd straddled two gate wings, only the gate wing nearest to `leaderX` was triggered, completely ignoring the 30 mobs running through the other wing.
- **Fix**: Use `GateVisual.processedMobs: Set<number>` to test each mob independently when it crosses gate $Z$, and trigger both wings if mobs pass through both.

### Pitfall 7: Formation Width Clamping vs Physics Edge Falling
- **Problem**: Hard-clamping all mob positions to `playableHalfWidth` prevented mobs from ever falling off the track edges, making wide formations unrealistically safe.
- **Fix**: Let formation offsets naturally scale and position mobs up to the physical edge (`trackHalfWidth = 8.0`). When a mob exceeds $|x| > \text{trackHalfWidth}$, initiate falling physics with gravity and rotation.

### Pitfall 8: Mobile Lighting Budget — 0 PointLights on Decor
- **Problem**: Adding local `PointLight` sources to glowing pylons or floating energy orbs caused WebGL shader compile overhead and dropped FPS below 30 on mobile devices.
- **Rule**: Never add `PointLight` or dynamic light sources to track decor. Use `MeshBasicMaterial` and standard materials with high `emissive` values and `ACESFilmicToneMapping`. Only the single `DirectionalLight` and `HemisphereLight` are permitted.

### Pitfall 9: GameEngine Loop Lifecycle & React Canvas Mounting
- **Problem**: Navigating to pause or victory screens caused `GameCanvas` to unmount and re-instantiate `GameEngine`, restarting the level.
- **Fix**: Keep `GameCanvas` mounted across `running`, `paused`, `level_won`, and `level_lost` phases. Control loop execution via `setPaused(true)` and input dispatch via `inputEnabled`.

### Pitfall 10: Gate Clearance & Obstacle Placement Nudge
- **Problem**: Obstacles randomly generated too close to math gates (within 2–5 meters), giving the player zero reaction time after exiting a gate.
- **Fix**: Enforce `GATE_CLEARANCE = 10.5` in `LevelGenerator.ts`. If an obstacle falls within clearance of a gate, nudge its $Z$ position forward or backward past the clearance zone rather than discarding it.

### Pitfall 11: Speed-Lag Camera Follow vs Reactive Jitter
- **Problem**: When activating Hyper Mode or switching to Arrow formation (+15% to +40% speed), reactive camera lerping lagged behind, causing the crowd to run off the top of the viewport.
- **Fix**: Calculate camera distance with predictive speed compensation:
  ```typescript
  const speedMult = this.crowd.isHyperMode ? 1.4 : this.crowd.formation === 'arrow' ? 1.15 : 1.0;
  const speedLag = (speedMult - 1) * this.baseSpeed;
  const targetCamZ = this.crowd.leaderZ - (GameEngine.CAMERA_BASE_DISTANCE + speedLag);
  ```

### Pitfall 12: Corrupted Base64 Save Recovery
- **Problem**: Corrupted save strings pasted into the import modal threw unhandled DOM exceptions (`InvalidCharacterError`) that broke the settings modal.
- **Fix**: Wrap `atob()` and `JSON.parse()` in `try/catch`, return `false` on failure, and retain valid default state.

### Pitfall 13: Web Audio Context Autoplay Policy
- **Problem**: Audio synthesis threw warnings or remained silent because modern browsers suspend `AudioContext` until direct user gesture.
- **Fix**: Call `soundEngine.resume()` on the first `touchstart`, `mousedown`, or `keydown` event in `GameEngine.setupInputs()`.

### Pitfall 14: Defeat Condition Screen Freeze vs Grace Timer
- **Problem**: When the last mob died, the game instantly triggered `endRun(false)` in the exact same frame, cutting off explosion particles and sound before the player could see what happened.
- **Fix**: Implement a 0.9-second `deathGrace` timer in `GameEngine.update()`. Emit death burst particles and sound immediately, but defer state transition until the timer expires.

### Pitfall 16: Obstacle per-mob Kill Cooldown vs Crowd Wipe (VERIFIED 2026-08-22)
- **Problem**: Obstacles only killed 1–2 mobs; the rest of the crowd passed through untouched.
- **Root Cause**: `ObstacleManager.checkObstacleCollision` set `hitCooldown = 0.8s` after the first victim, which blocked collision checks for the WHOLE obstacle for 0.8s — the crowd moved past before checks resumed.
- **Fix**: Remove the cooldown entirely. Iterate all alive mobs each frame and call `crowd.killMobById(id)` on every mob inside the hazard box — same per-mob pattern as gates (`processedMobs`). `killMobById` removes the mob from `alive` immediately so it can't die twice, while other mobs in the same frame are checked independently and die too.

### Pitfall 17: InstancedMesh Death-Animation Slot Retention (VERIFIED 2026-08-22)
- **Problem**: If a mob dies and its `InstancedMesh` slot is instantly reused by a new spawn, the new mob's matrix overwrites the dying mob's animation on the same instance — the death effect gets visually clobbered.
- **Root Cause**: `InstancedMesh.setMatrixAt(i)` maps one matrix per index; slot `i` is shared.
- **Fix**: When adding death animations, keep the mob's slot busy while the animation plays:
  - In `killMobById`: set `alive=false` + decrement `aliveCount` immediately (collision/aliveCount no longer see it), but set `dying=true` + `deathT` and hold the slot.
  - Add `updateDeathMobs(dt)` (in `CrowdManager.update` alongside `updateFallingMobs`) that plays a ~0.5s tumble-and-shrink, then parks the matrix at `(0,-100,0)` and clears `dying`.
  - In `spawnMob`, skip slots where `!mob.alive && !mob.dying` (condition must be `if (!mob.alive && !mob.dying)`), so a dying slot is never reused mid-animation.
- Death effects differ per obstacle type: play a per-type `emitBurst` (color, spread, vertical `upBias`) — add an optional `upBias` param to `ParticleSystem.emitBurst` so lava/laser bursts rise while crusher/saw bursts stay low and spread flat.

### Pitfall 22: Falling mobs get dragged BACK into the crowd — must be skipped in the formation loop (VERIFIED 2026-08-23, commit `e4dd7ef`)
- **Problem**: User reported: «человечки падающие с края дорожки как-то неправильно умирают, их модельки остаются какое-то время в толпе, частично видимые из-под поля, и периодически они возвращаются в строй» — mobs that fell off the track edge kept their models visible in/under the crowd and periodically "returned to formation" (a visual bug/ban).
- **Root Cause**: When a mob passes `|x| > trackHalfWidth`, `updateMobPositions()` sets `mob.falling = true` and `continue`s — but leaves `mob.alive = true`. `getAliveMobs()` filters ONLY on `alive`, so the falling mob stays in the formation iteration. The `continue` only fires on the FIRST frame it goes out of bounds (`&& !mob.falling`); next frame the flocking spring-lerp `mob.x = lerp(mob.x, mob.targetX, ...)` pulls it back toward the formation while `updateFallingMobs` simultaneously applies gravity — the two writers fight, and the mob visibly "returns to formation", partially under the floor.
- **Fix (2 edits, both in `CrowdManager.ts`)**:
  1. **Skip `falling` mobs at the top of the `updateMobPositions` loop** — `if (mob.falling) continue;` BEFORE the `invulnerableTime` decrement / offset computation. A falling mob's position is owned solely by `updateFallingMobs()` from then on; the formation must never re-target it.
  2. **Harden `reset()`** — the reset loop that sets `alive = false` per slot must ALSO clear `falling`/`fallVy`/`dying`, otherwise a slot caught mid-fall/mid-death at restart keeps `falling=true`/`dying=true` and `spawnMob` (which checks `!mob.alive && !mob.dying`) revives it already-falling/dying.
- **Lesson (generalizes beyond edge-fall)**: ANY animated-but-not-yet-removed mob state (`falling`, `dying`, `walking away`) that keeps `alive=true` will be re-targeted by the per-frame formation/order loop. Give each transient state an EARLY-CONTINUE guard at the top of the position loop so the state animation owns the slot exclusively. Check the "is this mob in the alive list" filter vs "should the formation move it" — they are two different questions and must be guarded independently.

### Pitfall 15: Finish Multiplier Wall Step Sacrifice vs Defense Absorption
- **Problem**: Upgraded players with high `defenseAura` or Tank mobs did not consume enough mobs when conquering multiplier castle steps, allowing players to clear x10 multiplier walls with 1 mob.
- **Fix**: Use `crowd.consumeMobs(cost)` which directly reduces alive count without armor/dodge/shield reduction, keeping finish wall step requirements strictly balanced.

### Pitfall 18: Position set inside the obstacle build switch is DEAD CODE (VERIFIED 2026-08-23)
- **Problem**: In `ObstacleManager.buildObstacleVisual`, per-case `mesh.position.y = N` (or any position set inside the switch) is silently overwritten by the unconditional `mesh.position.set(obs.x, obs.y || 0.5, obs.z)` that runs AFTER the switch for every type. The switch value is dead — the obstacle always lands at `y = 0.5`.
- **Fix**: Don't try to position an obstacle mesh via the switch. Set the base height in the shared `mesh.position.set(obs.x, obs.y || 0.5, obs.z)` line (or pass `obs.y`), and drive any per-frame height/animation from `obsVis.mesh.position.y` + child-local Y in `update()`. For a `barrier_gate` style obstacle that moves vertically, the shared 0.5 base is correct and the animated plate is `children[3]`.

### Pitfall 19: Group-kill ops don't mutate array length — compute netChange from return value (VERIFIED 2026-08-23)
- **Problem**: When adding wing-isolated gate ops (`divideMobsGroup`, `killMobsFromGroup`), computing `netChange` as `wing.length - before` is WRONG: the group methods kill mobs in place (set `alive=false`, keep the MobInstance object in `this.mobs`), so the passed `wing[]` array length never changes — `netChange` always reads 0, and the HUD floating-text shows no change.
- **Fix**: Group kill/divide methods RETURN the killed count; the caller must use the return value for `netChange`. `divideMobsByStep` (renamed from `divideMobsGroup` in the 2026-08-23 redesign) returns what `killMobsFromGroup` returns; use `netChange = -crowd.divideMobsByStep(wing, val)` / `-crowd.killMobsFromGroup(wing, count)`. Only `add`/`multiply` (which spawn) meaningfully grow a count you can diff.

### Pitfall 21: ÷N divide semantics — "every N-th survives, rest die" (VERIFIED 2026-08-23, user-corrected)
- **Problem**: The first implementation of `divideMobsByStep` was INVERTED — it kept every N-th mob and removed all the rest (÷2 wiped half the crowd). User: *«не правильно с ÷N, умирают все кто проходит кроме каждого N-ного»* (wrong — all who pass die except every N-th).
- **Root Cause**: The phrase «пропустить каждого N-го» (skip every N-th) is ambiguous — it was read as "let every N-th pass, remove the rest" instead of "kill every N-th, let the rest pass."
- **Correct logic** (in `CrowdManager.divideMobsByStep`): iterate alive mobs with a step counter; when `step === divisor`, reset and push that mob to `toRemove` (it DIES); all other mobs pass untouched. `÷2` removes ~half, `÷3` removes ~a third — a thinning gate, not a culling gate.
- **Lesson**: for crowd-gate semantics, state the survival rule explicitly ("every N-th SURVIVES, all others die") and verify the loop's `if` branch matches it. When a user reports a gate "works wrong," check the semantic direction of the per-mob branch before touching anything else.

### Pitfall 20: `Math.floor(factor)-1` kills multiply gates for fractional factors (VERIFIED 2026-08-23)
- **Problem**: "Sometimes gates don't fire" — the × gates produced no mobs on high levels. `CrowdManager.multiplyGroup` used `Math.floor(factor) - 1` copies per mob. Generator `multVal = 2.2 - levelNum*0.02` fell to ~1.4 by L40, so `Math.floor(1.4)-1 = 0` extra mobs — the gate "worked" but added nothing.
- **Fix**: treat integer part as guaranteed copies and fractional part as a per-mob spawn chance: `basePerMob = Math.floor(factor)-1; if (Math.random() < (factor - Math.floor(factor))) extra += 1`. ALSO clamp the generator multiplier ≥ 2 (`Math.max(2.0, ...)`) so the intent is always met. When a "sometimes works" crowd mechanic appears, check for integer-truncation bugs first.

### Pitfall 23: "Ложный звук пилы" — непрерывный loop-звук трибун висит до endRun (VERIFIED 2026-08-23)
- **Problem**: User reported a loud, growing sound that "sounds like a circular saw" and **doesn't stop after passing the obstacle** — it drowns everything. First misdiagnosis was "obstacle SFX volume" → wrong; the user insisted it was the saw that never fades.
- **Root Cause**: The sound was NOT any obstacle SFX. It was the **continuous crowd-cheer loop** (`playCrowdCheer`, added for the tribunes): a looped noise through a **bandpass 800–2500 Hz with a 5–7 Hz tremolo** — a timbre indistinguishable from a spinning saw blade. It's triggered on combo streaks and (critically) **`stopCrowdCheer()` was only called in `endRun`/`dispose`**, so once the tribunes started cheering the buzz played **for the rest of the run** — growing with each combo, never fading, "like a saw that doesn't go away."
- **Fix (2 parts)**:
  1. **Auto-decay on any continuous/looped sound**: `playCrowdCheer` now sets a `window.setTimeout(CROWD_CHEER_DECAY_MS=2200)` that calls `stopCrowdCheer()`; the timer is reset on every call and cleared in `stopCrowdCheer`. So the roar rises briefly per combo streak then fades on its own instead of hanging the whole run. **Any looped/procedural-ambient sound needs an explicit lifecycle — don't rely on `endRun`/`dispose` to stop it.**
  2. Heavily attenuate the loop layers (0.14/0.1/0.07) so even at peak combo it sits below hero SFX.
- **Diagnostic lesson**: when a user says "some sound grows louder and won't stop, like X (machine/saw/fan)", the FIRST thing to check is **which sound is routed as a continuous loop vs a one-shot**, and **where its stop() is called**. A bandpass-filtered looped noise + LFO tremolo is a great way to make a "machine hum" — which is exactly why it's easy to mistake the crowd cheer for a saw. Grep for `loop = true` / `source.loop` + `setInterval` / `setTimeout` in the audio engine, and verify the stop path before touching per-SFX volume.

### Pitfall 26: Moving/NPC obstacles — don't fake locomotion with a circular path; give them a state machine + articulated mesh (VERIFIED 2026-08-23)
- **Problem**: The `guard_dog` (cyber-dog on a chain) was animated as a rigid single `dogGroup` that drove `position = (cos(patrolAngle), sin(patrolAngle)) * patrolRadius` at a constant angular speed — it visibly **spun like a propeller** around the anchor post, never changing gait, never stopping, never facing its target. User: «она просто как пропеллер сейчас крутится, а должна свободно гулять в доступном радиусе (с анимацией) и нападать». Any NPC/enemy that is supposed to "move around" must NOT be a fixed circular/parametric orbit — that reads as broken.
- **Fix (3 parts)**:
  1. **State machine on the visual**: add `dogState: 'wander'|'idle'|'attack'`, `dogTargetX/Z` (random walk goal in the chain radius), `dogStateTime`, `dogAnimPhase`, `dogFacing`, `dogLungeT` to `ObstacleVisual`. Each frame pick the target state (attack if a live mob is within `obs.range` and cooldown ≤ 0; idle after 4–6s of wandering; wander after 2–3.5s idle), then move toward it. Give the creature a short cooldown (e.g. 1.2s) after an attack so it returns to idle/wander between bites.
  2. **Articulated mesh**: rebuild the dog mesh so each animatable part is a pivot `THREE.Group` (headPivot, 4 legPivots, tailPivot, jaw) with fixed child indices, then animate per-state: wander → legs swing in alternating phase + tail wags + head bob; idle/sit → rear legs bent (`rotation.x ≈ -1.1`), body tilted up, front legs straight; attack → jaw open, body/head pitched forward, tail tucked. Keep the child-index contract in the mesh docstring AND in the animator so a mesh rebuild doesn't silently break the animation.
  3. **Collision/hazard must follow the creature**: `resolveDog` used `obs.x/obs.z` (the static anchor) for its bite radius, and the hazard box was centered on the anchor — so the dog could visually lunge at a mob while the damage zone stayed behind. Compute the bite search and hazard from **the dog's current position** (`obs.x + dogGroup.position.x`, `obs.z + dogGroup.position.z`), not the anchor. Any moving obstacle's hazard box must be re-centered every frame from the moving part's world offset.
- **Lesson**: when an obstacle is meant to behave like a living/NPC object (wander, idle, attack), it needs (a) an explicit state machine with timers, (b) a pivot-articulated mesh for per-state animation, and (c) hazard/collision that tracks its moving body. "It looks like a propeller / it spins / it won't stop" is the symptom of a parametric orbit replacing real locomotion.

### Pitfall 25: Vertical-motion gates sink into the floor; flat ground traps read as dark "sticks" (VERIFIED 2026-08-23)
- **Problem A — gates go into the floor**: `applyMotion` for `motion === 'vertical'` did `gv.group.position.y = gv.baseY + sin(phase)*range`. With `baseY = 0` and a signed sine, the opening drops below `y = 0` and the whole 3.8-high gate plane sinks into the track. User: «ворота не должны уходить в пол».
- **Fix A**: clamp vertical motion to UP-ONLY from the floor — `const off = Math.abs(Math.sin(gv.motionPhase)) * gate.motionRange; gv.group.position.y = gv.baseY + off;`. The gate rises and returns to the floor but never goes below it. Rule of thumb: any animated vertical offset where `baseY` is the floor should take `Math.abs(sin(...))`, not a signed sine.
- **Problem B — flat ground trap is illegible**: `createSawBladeMesh` was a flat horizontal disc (`cylinder` rotated `rotation.x = PI/2`) lying at `y=0`, animated with `rotation.z += dt*15`. From the chase camera (Y≈6, looking forward along +Z) a flat disc on the floor reads as a thin dark "stick/bar" — the user said «крутящиеся палки на полу плохо видно и непонятно что это». 
- **Fix (readability for ground traps)**: (1) raise the blade off the deck (`spin.position.y = 0.55`) so its profile is visible side-on; (2) give it a tall center hub + bright red teeth around the perimeter (BoxGeometry teeth, `emissive 0xef4444`) + a glowing red `TorusGeometry` rim ring so the "dangerous rotating disc" reads instantly; (3) rotate the **correct axis**: a horizontal blade spins around **Y** (`mesh.children[0].rotation.y += dt*6`), NOT `rotation.z`. Because the teeth are now children of the spin group, drive the spin group's rotation, not the parent mesh.
- **General lesson**: after redesigning any procedural obstacle mesh, the `ObstacleManager.update` animation must match the new child hierarchy and axis — a mesh's child that held the old animated part may have moved index or orientation. Verify the animated child index (`children[0]` etc.) matches the rebuilt mesh's layout before assuming the old animation code still applies.

### Pitfall 24: Distance-based obstacle SFX — don't let passed obstacles keep sounding (VERIFIED 2026-08-23)
- **Problem**: User asked that obstacle/environment sounds get quieter with distance and that **obstacles already behind the crowd make no sound**.
- **Fix**: added `proximityVolume(obsZ, leaderZ)` in `ObstacleManager` — `dz = obsZ - leaderZ`; if `dz < -1` (behind/in-line) return 0; if `dz > 26` return 0; linear ramp to 1.0 within `|dz| ≤ 4`. Applied to every obstacle-triggered `playSound` (`obstacle_smash`, `mob_death`, `bomb_explode`, `dog_snap`), gated with `if (vol > 0)`.
- **`playSound` got a 3rd `volume` param** (SoundEngine.ts): `playSound(effect, pitchShift=1.0, volume=1.0)`. Internally builds an `outGain` GainNode only when `volume < 1` (avoids an extra node/alloc at full volume — 0-GC), and every `gain.connect(this.sfxGain!)` inside `playSound` was rewritten to `gain.connect(outGain)`. Use a python/terminal script to do the bulk `connect(this.sfxGain!)` → `connect(outGain)` swap scoped between `playSound(` and `playCrowdCheer(` — do NOT touch `playCrowdCheer`'s connections (they stay on `sfxGain`).
- **Signature change**: `resolveBomb`/`resolveDog` gained a `vol: number` param threaded from `checkObstacleCollision`. When adding a new obstacle type with SFX, remember to route its sound through `proximityVolume(obs.z, crowd.leaderZ)`.
- **Per-obstacle type**: bomb/guard_dog/swinging_hammer/rolling_spike_ball added 2026-08-23 (commit `b2aa7d2`) with SFX `bomb_explode` (sawtooth 400→40 Hz + noise), `dog_snap` (square 600→120), `hammer_impact` (triangle 90→20 + metal ping). `hammer_impact` is defined in SoundEngine but NOT yet wired to a trigger — a known loose end.

### Pitfall 25: Gates with `vertical` motion sink into the floor (VERIFIED 2026-08-23)
- **Problem**: User: «ворота уходят в пол». Gates with `motion='vertical'` computed `off = Math.sin(phase) * motionRange` → when phase is negative the whole 3.8-tall gate drops below `y=0`, sinking into the floor.
- **Fix** (in `GateManager.applyMotion`): clamp vertical motion to UP-ONLY by taking the absolute value: `const off = Math.abs(Math.sin(gv.motionPhase)) * gate.motionRange; gv.group.position.y = gv.baseY + off;`. Base stays `>= y=0`, the gate lifts then returns to floor — never under it. General lesson: any sine-driven vertical offset needs a `Math.abs` (or a `max(0, ...)`) when the object's base must never go negative.

### Pitfall 26: Flat floor hazards are unreadable from the chase camera (VERIFIED 2026-08-23)
- **Problem**: User: «препятствия в виде крутящихся палок на полу визуализируй как-то иначе, их плохо видно и вообще не совсем понятно что это такое» — the `saw_blade` was a flat horizontal disc lying flush on the floor. From the chase camera at Y≈6 looking along +Z, it read as a faint dark smudge/"stick", not a spinning hazard.
- **Fix** (`createSawBladeMesh` in `proceduralMeshes.ts`): rebuild as a visibly-dangerous disc —
  - **Lift the blade off the floor** (`spin.position.y = 0.55`) so it's seen from the side;
  - large bright teeth around the perimeter (12 red `BoxGeometry` teeth, `emissive` red);
  - a glowing red `TorusGeometry` ring at the rim to mark the danger zone;
  - a central hub-cylinder.
  - **Animation axis change in `ObstacleManager.update`**: the old code rotated the whole group around Z (`mesh.rotation.z += dt*15`) — correct for a vertical wheel but wrong for a floor disc. New code rotates the inner `children[0]` spin-group around Y (`obsVis.mesh.children[0].rotation.y += dt*6`). When you change a mesh's orientation, update its per-frame animation axis too.
- Lesson: a horizontal ground hazard must be **lifted + contrast-colored + animated about the correct axis** to survive the shallow chase camera. Before/after screenshots via the game's own runtime are the real check.

### Pitfall 27: Guard dog was a "propeller", then "doesn't attack" — build it as a state machine (VERIFIED 2026-08-23)
Two user reports over two rounds: (1) «собака просто как пропеллер крутится» — it patrolled in a `cos/sin` circle around the anchor like a propeller with no body articulation; (2) after the wander/attack state machine was added, «собака никого не атакует».

**Mesh (must be broken into articulated pivots for animation)** — `createGuardDogMesh`:
- `children[0]` post, `children[1]` chain, `children[2]` `dogGroup`.
- `dogGroup` children indices (KEEP THESE STABLE — the animator reads them by index):
  - `[0]` body (rotate x for lunge/sit), `[1]` headPivot group (inside: `[0]` head, `[1]` eyes, `[2]` jaw — jaw opens on attack), `[2..5]` four legPivots (each = pivot at hip + leg cylinder down, rotate x for stride/sit), `[6]` tailPivot (wag), `[7]` stripeL, `[8]` stripeR.

**State machine** in `ObstacleManager.updateGuardDog` (`'wander' | 'idle' | 'attack'`):
- `wander`: pick random target within `obs.range*1.5`, walk toward it (speed ~1.6), pick new target on arrival, phase += dt*9 for stride.
- `idle` (sit): after 4–6s of wandering, sit — body.rotation.x≈0.35 (chest up), front legs straight (rot.x≈0.05), rear legs folded (rot.x≈-1.1), tail slow wag.
- `attack`: chase nearest mob in `attackRange` (speed ~5, face it), body lunge + open jaw + tail pinned + legs pumping. Bite is applied in `resolveDog`.

**THE "doesn't attack" bug — attack target must be searched from the DOG's position, not the anchor**:
- Original code searched `nearestMob` in radius `obs.range` around `obs.x/obs.z` (the ANCHOR/post), while the dog itself wandered up to `range*1.5` away. The zones often didn't overlap → dog never found a target. Fix: compute `dogX = obs.x + dogGroup.position.x`, `dogZ = obs.z + dogGroup.position.z` and search around THAT. Same in `resolveDog`: the bite radius (`obs.range + 0.8`) and nearest-mob loop must center on the dog, and hazard (`setHazard`) follows `obs + dogGroup.position`.
- When a moving hazard's behavior "doesn't work", check whether every detection/attack radius is centered on the moving sub-object's live position, not on its static parent/origin.

**Attack speed = dog levels** (user asked: max 2 kills/sec, then leveled 1–3):
- Added `ObstacleData.attackRate` (`1..3` mob/sec); bite cooldown in `resolveDog` = `1 / (obs.attackRate ?? 1)`.
- Campaign: `attackRate = Math.min(3, 1 + Math.floor(levelNum / 17))` → L1–16: 1/s, L17–33: 2/s, L34+: 3/s. Endless: `1 + (segmentIndex % 3)`.
- Remember BOTH generator sites (campaign `generateLevel` and `generateEndlessSegment`) when adding a field to an obstacle — they are two separate object literals.

---

## 5. Currently Implemented (Do NOT Re-implement)

Before proposing new features, check what is already built and functioning in TOLPA:
- **Levels & Environments**:
  - 50 Campaign Levels with deterministic PRNG generation (`LevelGenerator.ts`).
  - Endless Runner Mode with dynamic chunk streaming (`GameEngine.updateEndlessStreaming()`) AND full core-loop surfacing (distance HUD chip + live record, end-of-run "Забег завершён" modal with NEW RECORD badge + coins-by-distance, record on the MainMenu endless button — see §endless-mode-revival).
  - 5 Biomes (`cyber_city`, `magma_citadel`, `crystal_cavern`, `quantum_void`, `celestial_core`) with procedural scenery and music.
- **Crowd & Classes**:
  - 5 Formations (`oval` [default], `wedge`, `wide`, `circle`, `arrow`) with dynamic width scaling.
  - 4 Specialized Mob Classes (`regular`, `tank`, `ninja`, `mage`) with distinct models, colors, scales, HP, shields, and passive abilities.
  - Edge falling physics with gravity, tumbling rotation, and sound/particle effects.
- **Gates & Traps**:
  - 3 Independent Gate Operations (`add`, `multiply`, `divide`) — each gate is a standalone opening (1–3 per row, staggered, partial/full width), motion-capable (horizontal/vertical/rotate), with independent per-mob processing (`processedMobs`). **`subtract`/`conditional`/`mystery`/`adrenaline` gates and dual-wings were REMOVED (2026-08-23)** — `subtract (−N)` became countdown Walls (see §3.2b), bonus effects moved to collectible spheres (see §3.8).
  - 12 Obstacle Types (`saw_blade`, `axe_pendulum`, `crusher`, `spike_trap`, `wrecking_ball`, `laser_grid`, `barrier_gate`, `lava_pit`, `bomb`, `guard_dog`, `swinging_hammer`, `rolling_spike_ball`) with height-aware hitboxes (`isHazardActive`), **active killing-part hazard boxes** (kill only on the dangerous part, not the static box — see §3.3), and tank destructibility. (NOTE: `barrier_gate` was DEAD until 2026-08-23 — see §3.3 wiring; `bomb`/`guard_dog`/`swinging_hammer`/`rolling_spike_ball` added 2026-08-23 commit `b2aa7d2`.) `guard_dog` is an articulated **state machine** (wander/idle/attack) with body-articulated mesh — see Pitfall 27; `saw_blade` was rebuilt as a lifted red-toothed spinning disc (Pitfall 26); gates with `vertical` motion are clamped up-only (Pitfall 25).
  - 5 Bosses on milestone levels (L10, 20, 30, 40, 50) with animated models, red ring telegraphs, and batched AOE damage.
  - Multiplier Wall Finish Steps (10 steps: ×1.2 to ×10.0) and apex golden chest with Canvas Confetti.
- **Level Generation Density (VERIFIED 2026-08-23, latest)**: campaign gates `Math.min(40, 16 + floor(levelNum/2))`, obstacles `Math.min(120, floor(trackLength/26))` (section step 26m); endless segment = 2-3 gates + 1 wall + 4-5 obstacles. **After the 2026-08-23 gate redesign**: gates are independent positive-op openings (`add`/`multiply`/`divide`, all integers) with optional motion; `subtract (−N)` became countdown Walls (`Math.min(12, 2+floor(lvl/8))` in campaign, level≥3); bonuses in safe corridors (campaign `min(14,4+floor(lvl/4))`, endless 1-2 per segment). `multVal` clamped ≥2 integer so × always grows. Caps test asserts `gates<=40, walls<=12, bonuses<=14, obstacles<=120, coins<=360`. Both campaign and endless gate pools and obstacle pools are separate arrays in `LevelGenerator.ts` — when adding a new type or tuning density, remember there are FOUR places: campaign gate loop, campaign obstacle loop, `generateEndlessSegment` gate loop, `generateEndlessSegment` obstacle loop.
- **Dynamic Level Events**:
  - All 5 event types (`ambush`, `coin_train`, `emp_storm`, `meteor_rain`, `speed_boost`) generated deterministically per level and EXECUTED in `GameEngine.updateDynamicEvents()` (triggered by `leaderZ` reaching `triggerZ`). Endless mode skips them.
  - HUD event-alert banners via `eventBus` `levelEvent` + i18n `event*` keys.
  - EMP storm flips gate op signs; speed_boost/ambush modulate `eventSpeedMult`.
- **Progression, Economy & Meta**:
  - 7 Player Upgrade branches (starting mobs, income, adrenaline duration, class spawn chances, defense aura).
  - 6 Character Skins with custom color palettes, emissive materials, and particle trails.
  - 8 Achievements with coin and gem rewards.
  - Story Dialogue system with character avatars and sound cues.
- **Audio & Diagnostics**:
  - 100% Procedural Web Audio synthesizer (20+ SFX, dynamic tempo). **MusicThemes (12, 2026-08-23): `cyber, magma, crystal, void, celestial, tension, pulse, echo, spark, titan, boss_battle, menu`** — bass/arp tables in `SoundEngine.ts`, both `Record<MusicTheme, number[]>` maps MUST list every theme (adding a theme without adding it to both bassLines + arpLines = undefined at runtime). Per-level selection via `GameEngine.getMusicThemeForLevel(levelNum, biome)` — rotates 3 themes per biome so the 10 levels of a biome don't all sound identical. Boss levels override to `boss_battle` in `BossManager`.
  - Volume balance (2026-08-23): environment/obstacle one-shots sit BELOW hero SFX — `obstacle_hit` 0.16, `obstacle_smash` 0.22, `mob_death` 0.14, `mob_fall` 0.07. Continuous crowd-cheer loop (`playCrowdCheer`) heavily attenuated (0.14/0.1/0.07 layers) so its combo-ramp never drowns music/SFX — **and auto-decays ~2.2s after the last combo** (see Pitfall 23). Obstacle-triggered SFX are **distance-scaled** via `proximityVolume(obsZ, leaderZ)` — silence for passed obstacles, ramp to 1.0 within 4m (see Pitfall 24). `playSound(effect, pitchShift, volume)` supports a per-call `volume` for spatial attenuation.
  - Dual Localization (RU/EN) with real-time switching.
  - In-game interactive Vitest Suite Modal (`TestModal.tsx`) and 76 automated Vitest unit tests.
  - Base64 save import/export with corrupted data recovery.

---

## 6. Testing & Quality Assurance

All modifications must verify the following automated checks:

```bash
# 1. Typecheck strict compliance
npx tsc --noEmit

# 2. Run all Vitest automated test suites (77 tests across 6 suites)
npm test

# 3. Build production bundle (Vite + Tailwind CSS v4)
npm run build
```

---

## 7. Commit Convention

Follow semantic commit messaging:
- `feat(gameplay)`: New mechanics, formations, gate types, obstacle interactions.
- `feat(visual)`: Shaders, materials, procedural meshes, particle juice, HUD improvements.
- `feat(balance)`: Track lengths, gate values, obstacle damage curves, economy formulas.
- `fix(physics)`: Collisions, edge falling, coordinate inversions, camera follow.
- `perf(crowd)`: Zero-GC optimizations, instanced mesh updates, scratch buffer pooling.
- `test(...)`: Vitest test cases and test suite expansions.

---

## 8. Dual-Agent Planning & Execution Workflow

### Стратегия реализации (ОБЯЗАТЕЛЬНО, VERIFIED 2026-08-23 — из урока «кибер-собака не атакует»)
Пользователь требует: **реализацию поручай ЛИБО одному агенту последовательно (выбирая
модель под задачу), ЛИБО разделяй работу так, чтобы результаты реализации НЕ перекались.**
И в ЛЮБОМ случае при параллельном выполнении — **всегда проверяй и валидируй результаты
ВСЕХ агентов ПОСЛЕ того, как они все закончат, чтобы весь результат был перед глазами.**

1. **Всегда проверяй работу агентов — валидация каждого обязательна.** Subagent-отчёт —
   не доказательство (агенты дают false-positive «готово»/«работает»/«критические баги»).
   После агентов оркестратор САМ: `git status --short` + `git diff --stat`, `npx tsc --noEmit`,
   `npm test`, и сборка. Считай задачу выполненной только после собственной проверки.
2. **Последовательная реализация (по умолчанию для зависимых правок):** поручай ОДНОМУ
   агенту, следующего запускай после завершения и валидации первого. Модель — под задачу
   (agy/Gemini, effort low/medium/high; opencode hy3-free).
3. **Параллельная реализация — ТОЛЬКО при непересекающихся файлах/зонах:** явная граница
   («меняешь ТОЛЬКО этот файл»), разные функции/файлы, чтобы результаты не перекались.
   Дождись ВСЕХ, собери весь результат перед глазами, проверь **интеграционный шов**
   (grep новые API каждого агента и проверь, что другой их использует; подклей сам).
   «tsc-clean от каждого» — необходимое, но НЕ достаточное условие.
4. **Урок практики:** параллельная реализация собаки (агент A → меш, агент B → логика)
   дала рассинхрон — анимация и укус не сошлись по радиусу, собака «не атакует», оркестратор
   чинил стык сам. Если стык сложный — предпочти последовательную реализацию одним агентом.

When operating in an agent pair-programming context:
1. **Planner Agent**:
   - Inspects existing code in `src/` and docs in `docs/` before proposing changes.
   - Verifies compliance with coordinate conventions (Screen-Right = $-X$), 0-GC rules, and mobile budgets.
   - Outlines structured task specifications with concrete filenames and method signatures.
2. **Developer Agent**:
   - Implements minimal, high-efficiency TypeScript changes.
   - Runs `npx tsc --noEmit` and `npm test` after every modification.
   - Builds production distribution with `npm run build` and updates `/var/www/tolpa/` deployment.

### Deployment model (VERIFIED 2026-08-23 — production-only)
- **Production-only**: tolpa is served by nginx from `/var/www/tolpa/` at `https://ai-rafik.duckdns.org/tolpa/` and `http://188.132.197.214:8077/tolpa/`. **The PM2 `tolpa` preview on :9765 was REMOVED** — user preference is production-only, no preview/dev. Do NOT re-create a preview process.
- **Panel entry** is `type: static` with `deployCmd: cp -r dist/* /var/www/tolpa/` + `deployAfterBuild: true`. Panel reads `projects.json` at process start — after editing it, `pm2 restart panel`.
- **Deploy flow after any improvement**: `npm run build` → `cp -r dist/* /var/www/tolpa/` → verify nginx serves the NEW bundle hash (`curl -s <url>/ | grep -o 'index-[A-Za-z0-9]*\.js'` and compare to `dist/index.html`). The harness cron queue also deploys tolpa to `/var/www/tolpa/` after each session.
- **Cron-mode deploy verification**: raw-IP curl (`http://188.132.197.214:8077/tolpa/`) is blocked by the `tirith:raw_ip_url` gate in unattended cron — verify the DOMAIN endpoint (`https://ai-rafik.duckdns.org/tolpa/`) instead.

### PITFALL — blank page under subpath: vite `base: './'` (VERIFIED 2026-08-23)
- **Problem**: After deploying tolpa to `/var/www/tolpa/` (served by nginx at `/tolpa/`), the page rendered **blank**. JS never loaded.
- **Root Cause**: vite builds with **absolute** asset paths by default (`/assets/index-*.js`). The browser requests `/assets/...` at the domain ROOT → 404 (assets actually live at `/tolpa/assets/...`). The HTML loads but the JS bundle 404s → blank page.
- **Fix**: add `base: './'` to `vite.config.ts` so vite emits **relative** paths (`./assets/...`, `./manifest.json`). Rebuild + redeploy.
- **Verify**: `curl -s <url>/tolpa/ | grep -o 'src="[^"]*"'` must show `./assets/...` (relative), and `curl -s -o /dev/null -w '%{http_code}' <url>/tolpa/assets/<bundle>.js` must be 200. Also check `rel="manifest" href` is `./manifest.json`, not `/manifest.json`.
- **Applies to ALL subpath-deployed games** (3d-bat already has `base: './'`; 3d-runner-h, neonRush, 5gor should be checked). Any game under a nginx `location /<name>/` alias needs relative base.

### Gate + Bonus rework: arithmetic-only gates + collectible spheres (IMPLEMENTED + DEPLOYED 2026-08-23, commit `5c1b079`, bundle `index-C00bWaWn.js`)
Removed `conditional`/`mystery`/`adrenaline` gates and horizontal drift; gates became arithmetic. Bonus effects moved into a new `BonusManager` (glowing spheres/stars: `add_mobs`/`heal`/`adrenaline`/`coins`). Fixed the root "× gates sometimes don't fire" bug: `multiplyGroup` used `Math.floor(factor)-1` which was 0 for fractional `factor < 2`. Full file list, bonus table, test changes: `references/gate-bonus-rework-arithmetic-only.md`.
**Follow-up redesign (2026-08-23, commit `83ab4e0`, bundle `index-WnqJHE2G.js`)**: gates became fully INDEPENDENT openings (1–3/row, staggered, motion-capable) with only positive ops (`add`/`multiply`/`divide`, all integer); `subtract (−N)` split out into countdown **Walls** (`WallManager`). See §3.2 / §3.2b. Details: `references/gate-wall-independent-mechanics.md`.

### Endless-mode revival (IMPLEMENTED + DEPLOYED 2026-08-23, commit `f057ad2`, bundle `index-V2-5F_Jj.js`)
Revived the dead-but-supported endless core-loop: `SaveData.endlessHighScore` + `StateManager.setEndlessHighScore` existed but had **zero call sites**; HUD hid all distance behind `!isEndless`; the loss screen showed "defeat / 0 score" for a survive-mode. Now: `RunStats.distance` + `runRecordDistance` (updated in the `update()` loop), `HudSnapshot.distanceTraveled`, an endless HUD chip (distance + live record), an endless end-of-run modal ("Забег завершён", distance, "НОВЫЙ РЕКОРД!" badge, coins by distance), and the record on the MainMenu endless button. Full 8-file recipe + pitfalls: `references/endless-mode-revival-recipe.md`.

### Track environment upgrade (IMPLEMENTED + DEPLOYED 2026-08-23, commit `c21f74c`, bundle `index-B7y7ffWT.js`)
See `references/track-environment-upgrade.md` for the design. **Now built and live** — tribunes + InstancedMesh spectators (jump/sway/wave arms, stadium reacts when crowd is near), object variety (streetlights/billboards/flags/drones), special effects (light beams, ParticleSystem `emitConfetti`/`emitLightPillar` presets), crowd cheer sound (`playCrowdCheer`/`stopCrowdCheer`). All 0-PointLight / 0-GC / mobile-budget compliant. Deployed to `/var/www/tolpa/`, old bundles cleaned out of `assets/` (only the current `index-*.js` + `index-*.css` kept).

### PITFALL — external-file permission (VERIFIED 2026-08-22)
When running agy/opencode in parallel for planning, agents **auto-reject reading files outside the project dir** (e.g. `/root/projects/3d-runner-h/AGENTS.md`, `/root/projects/5gor/AGENTS.md`) and hang on the permission prompt. **Fix**: embed any reference examples (AGENTS.md/SKILL.md format) DIRECTLY in the prompt, and tell agents to work ONLY inside `/root/projects/tolpa`. Also note: agy may try to write the skill into `.agents/skills/tolpa-game-development/` inside the repo — that's fine (it's the repo-local copy), but the Hermes skill lives at `~/.hermes/skills/game-development/tolpa-game-development/` and must be kept in sync.

### Parallel agy+opencode workflow (VERIFIED 2026-08-23)
User wants agy AND opencode to do **parallel planning and implementation** (not just the orchestrator), respecting API limits. Proven recipe:
- **Check limits first**: agy (Gemini) — `agy-usage`; opencode — zen models are free, ollama-cloud is paid. Only delegate when limits allow.
- **Parallel planning**: run agy + opencode simultaneously, each producing an independent plan (read-only). Then the orchestrator synthesizes ONE ideal plan and shows it to the user for approval BEFORE implementing.
- **Parallel implementation with file isolation**: split work by file so agents never clobber each other. Proven split: agy → `src/engine/LevelGenerator.ts` (all generation logic), opencode → `src/testing/__tests__/game.test.ts` (tests). Each agent told explicitly "change ONLY this file, another agent writes the other."
- **agy headless permission**: agy in headless mode auto-denies tools needing the `command` permission (e.g. `tsc`/`npm run build`) and exits with `CANCELED`/`ERROR: context canceled` + stderr "a tool required the 'command' permission that headless mode cannot prompt for". **Fix**: add `--dangerously-skip-permissions` to the agy invocation when the commands are safe (tsc/vitest/build). Without it, agy may still WRITE the file but never run verification and return ERROR.
- **opencode zen-model quirks (VERIFIED 2026-08-23)**: `big-pickle` returns EMPTY stdout on planning prompts (hangs on read, exits 0 with only a banner in stderr); `deepseek-v4-flash-free` fails with `Unexpected server error` (zen provider down). **Working zen model: `hy3-free`** — returns full stdout reliably. If a zen model returns empty stdout, retry with `hy3-free` before falling back to paid ollama-cloud.
- **Test-skip coordination**: when opencode writes tests BEFORE the implementation agent finishes, it marks not-yet-implemented features `it.skip` with a TODO. After the implementation lands, the orchestrator must UN-SKIP those tests and re-run to confirm they pass against the real implementation (this session: 3 skips → all 72 passed after un-skipping).
- **Cross-file integration gap (VERIFIED 2026-08-23)**: when two agents implement DIFFERENT files in parallel, neither sees the other's new API. This session: agent A added `playCrowdCheer`/`stopCrowdCheer` to `SoundEngine.ts` while agent B built the tribunes/effects in `GameEngine.ts` — B never wired the sound to triggers. The orchestrator MUST, after both agents finish, grep for the new API (`search_files pattern='playCrowdCheer|stopCrowdCheer'`) and wire the cross-file calls (triggers on combo/finish, `stopCrowdCheer` in `endRun` + `dispose`). Treat "both agents report tsc-clean" as necessary but NOT sufficient — verify the integration seam yourself.
- **Orchestrator owns**: final tsc/vitest/build, commit, push, deploy, harness report. Agents never commit/push/deploy.
