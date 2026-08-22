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
| `src/engine/GateManager.ts` | Procedural math gates, dual-wing per-mob independent collision via `processedMobs`, dynamic flips, and combo counter. |
| `src/engine/ObstacleManager.ts` | 5 hazard types (`saw_blade`, `axe_pendulum`, `crusher`, `laser_grid`, `spike_trap`), height-aware hazard filtering (`isHazardActive`), coin pickup (`2x` for Ninjas). |
| `src/engine/BossManager.ts` | 5 campaign bosses (L10, 20, 30, 40, 50), forward progression arena lock, telegraph rings, batched AOE damage, timed retaliation. |
| `src/engine/FinishLineManager.ts` | Multiplier castle wall steps ($\times 1.2$ to $\times 10.0$), mob sacrifice cost, apex chest, and victory confetti celebration. |
| `src/engine/LevelGenerator.ts` | Deterministic PRNG level generator, track scaling, gate spacing, safe hazard clearance nudging, and endless segment chunk streaming. |
| `src/engine/ParticleSystem.ts` | Zero-GC `InstancedMesh` particle pool (300 particles) for explosions, sparks, and speed trails. |
| `src/core/StateManager.ts` | Centralized state singleton, hot in-memory `RunStats` buffer, debounced `localStorage` saving, base64 import/export, upgrade and achievement calculators. |
| `src/core/EventBus.ts` | Strictly-typed event bus (`screenShake`, `gatePassed`, `mobsKilled`, `obstacleSmashed`, `bossDamaged`, `mobFell`). |
| `src/audio/SoundEngine.ts` | Procedural Web Audio API synthesizer for 20+ SFX and 5 biome background music themes. |
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

### 3.2. Quantum Math Gates (`GateManager.ts`)
- **Independent Per-Mob Processing**: Tracks `processedMobs: Set<number>` to test each mob's individual $X$ coordinate when passing gate $Z$.
- **Dual-Wing Resolution**: Mobs with $x < 0$ trigger the left wing effect; mobs with $x \ge 0$ trigger the right wing effect.
- **Operations**:
  - `add`: Spawns $N$ mobs via `crowd.addMobs(val)`.
  - `multiply`: Scales crowd by factor via `crowd.multiplyMobs(val)`.
  - `subtract`: Kills $N$ mobs via `crowd.killMobs(val, 'gate')` (or transmuted by Mages).
  - `divide`: Divides crowd by $N$ via `crowd.divideMobs(val)` (or transmuted by Mages).
  - `conditional`: Checks if $\text{aliveCount} \ge \text{minMobs}$; applies pass reward or fail penalty.
  - `mystery`: $60\%$ chance of bonus mobs ($+8$ to $+18$), $40\%$ chance of penalty (kills up to $30\%$ of crowd).
  - `adrenaline`: Triggers Hyper Mode for 6.0 seconds.

### 3.3. Obstacles & Height Filtering (`ObstacleManager.ts`)
- **Traps**: `saw_blade`, `axe_pendulum`, `crusher`, `laser_grid`, `spike_trap`.
- **Height-Aware Hazard Gate (`isHazardActive`)**:
  - `crusher` is only lethal when $y \le 1.2$.
  - `axe_pendulum` is only lethal when $|\text{rotZ}| < 0.55$.
- **Instant Kill**: Any mob overlapping an active trap is instantly eliminated via `killMobById(mob.id)`.
- **Destruction**: If Hyper Mode is active or a Tank hits a destructible trap (`crusher`, `axe_pendulum`), the trap is removed and emits `obstacleSmashed`.

### 3.4. Boss Battles (`BossManager.ts`)
- **Levels**: 10, 20, 30, 40, 50.
- **Arena Lock**: While boss is alive, `crowd.leaderZ` is clamped to $\text{bossArenaZ} - 5.5$.
- **Damage Scaling**: Crowd DPS scales sub-linearly ($\min(140, 12 + N \times 1.6) \times dt$) to prevent instant boss melt while rewarding large crowds.
- **Batched AOE**: Boss slam tests all mobs in radius once and performs a single `killMobs()` call.

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

### Pitfall 15: Finish Multiplier Wall Step Sacrifice vs Defense Absorption
- **Problem**: Upgraded players with high `defenseAura` or Tank mobs did not consume enough mobs when conquering multiplier castle steps, allowing players to clear x10 multiplier walls with 1 mob.
- **Fix**: Use `crowd.consumeMobs(cost)` which directly reduces alive count without armor/dodge/shield reduction, keeping finish wall step requirements strictly balanced.

---

## 5. Currently Implemented (Do NOT Re-implement)

Before proposing new features, check what is already built and functioning in TOLPA:
- **Levels & Environments**:
  - 50 Campaign Levels with deterministic PRNG generation (`LevelGenerator.ts`).
  - Endless Runner Mode with dynamic chunk streaming (`GameEngine.updateEndlessStreaming()`).
  - 5 Biomes (`cyber_city`, `magma_citadel`, `crystal_cavern`, `quantum_void`, `celestial_core`) with procedural scenery and music.
- **Crowd & Classes**:
  - 5 Formations (`oval` [default], `wedge`, `wide`, `circle`, `arrow`) with dynamic width scaling.
  - 4 Specialized Mob Classes (`regular`, `tank`, `ninja`, `mage`) with distinct models, colors, scales, HP, shields, and passive abilities.
  - Edge falling physics with gravity, tumbling rotation, and sound/particle effects.
- **Gates & Traps**:
  - 7 Gate Operations (`add`, `multiply`, `subtract`, `divide`, `conditional`, `mystery`, `adrenaline`) with independent per-mob dual-wing processing.
  - 8 Obstacle Types (`saw_blade`, `axe_pendulum`, `crusher`, `spike_trap`, `wrecking_ball`, `laser_grid`, `barrier_gate`, `lava_pit`) with height-aware hitboxes (`isHazardActive`) and tank destructibility.
  - 5 Bosses on milestone levels (L10, 20, 30, 40, 50) with animated models, red ring telegraphs, and batched AOE damage.
  - Multiplier Wall Finish Steps (10 steps: $\times 1.2$ to $\times 10.0$) and apex golden chest with Canvas Confetti.
- **Progression, Economy & Meta**:
  - 7 Player Upgrade branches (starting mobs, income, adrenaline duration, class spawn chances, defense aura).
  - 6 Character Skins with custom color palettes, emissive materials, and particle trails.
  - 8 Achievements with coin and gem rewards.
  - Story Dialogue system with character avatars and sound cues.
- **Audio & Diagnostics**:
  - 100% Procedural Web Audio synthesizer (20+ SFX, 5 BGM tracks, dynamic tempo).
  - Dual Localization (RU/EN) with real-time switching.
  - In-game interactive Vitest Suite Modal (`TestModal.tsx`) and 62 automated Vitest unit tests.
  - Base64 save import/export with corrupted data recovery.

---

## 6. Testing & Quality Assurance

All modifications must verify the following automated checks:

```bash
# 1. Typecheck strict compliance
npx tsc --noEmit

# 2. Run all Vitest automated test suites (62 tests across 5 suites)
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

When operating in an agent pair-programming context:
1. **Planner Agent**:
   - Inspects existing code in `src/` and docs in `docs/` before proposing changes.
   - Verifies compliance with coordinate conventions (Screen-Right = $-X$), 0-GC rules, and mobile budgets.
   - Outlines structured task specifications with concrete filenames and method signatures.
2. **Developer Agent**:
   - Implements minimal, high-efficiency TypeScript changes.
   - Runs `npx tsc --noEmit` and `npm test` after every modification.
   - Builds production distribution with `npm run build` and updates `/var/www/tolpa/` deployment.

