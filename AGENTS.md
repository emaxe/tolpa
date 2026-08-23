# AGENTS.md — AI Agent Guidelines & Architecture Manual

> **Purpose**: This guide provides AI agents and pair-programming assistants with full architectural context, coordinate systems, mathematical models, design patterns, physics rules, and conventions for modifying or expanding the **TOLPA (Crowd Evolution 3D: Cyber Legion)** codebase.

> **Global rules for AI agents:** `~/.hermes/agents/rules.md` (code style, Russian comments, zero-asset/WebAudio, commits, host limits, model selection, fallback). Here — only this project's specifics. Cascade: global rules → this file → call instruction.

---

## 1. Project Overview & Tech Stack

- **Game Genre**: Tactical 3D Crowd Runner / Crowd Evolution (`Cyber Legion`)
- **Core Engine & Graphics**: Three.js (WebGL, Flat & Standard Materials, ACES Filmic Tone Mapping, 0-GC `InstancedMesh`)
- **UI & Application State**: React 19, TypeScript 5.9, Tailwind CSS v4, Lucide Icons, Canvas Confetti
- **Audio Engine**: 100% Procedural Web Audio API Synthesizer (0 external `.mp3`/`.wav` assets, dynamic BGM sequencer, adaptive SFX)
- **Asset Pipeline**: 100% Procedural 3D Geometries & Canvas2D Textures (0 external GLTF/PNG assets)
- **Build System & Test Runner**: Vite 7.3 with native ES modules, Vitest 4.1 (62 automated tests + browser-based Test Runner)
- **Deployment & Server**: Production static build deployed to `/var/www/tolpa/`, local preview on port `9765` (PM2 process `tolpa`)

---

## 2. Directory & Module Architecture

```text
tolpa/
├── index.html                   # HTML entry point, viewport setup, fonts
├── package.json                 # Dependencies (React 19, Three.js 0.185, Tailwind v4, Vitest 4.1)
├── tsconfig.json                # TypeScript compiler configuration (ESNext, React JSX)
├── vite.config.ts               # Vite bundler configuration (@tailwindcss/vite, SWC React plugin)
├── AGENTS.md                    # AI Agent instructions & architecture manual (this document)
├── README.md                    # Project overview, mechanics, and controls
├── run.sh                       # Interactive CLI manager (dev, build, preview, test)
├── docs/                        # Architecture & balance documentation
│   ├── ARCHITECTURE.md          # High-level architecture and subsystem diagram
│   ├── BALANCE.md               # Progression curves, class perks, and economy formulas
│   ├── RELEASE_CHECKLIST.md     # Production release verification checklist
│   └── TEST_REPORT.md           # Automated test coverage report
└── src/
    ├── main.tsx                 # React DOM mount point & initial setup
    ├── App.tsx                  # State machine & modal overlays (menu, running, dialogue, pause, win/lose)
    ├── index.css                # Global styles and Tailwind v4 imports
    ├── types/                   # Strict TypeScript contracts
    │   ├── game.ts              # MobType, FormationType, GateOp, GateData, ObstacleData, BossData, LevelConfig, SaveData
    │   └── audio.ts             # SoundEffect, MusicTheme union types
    ├── core/                    # Foundation services & state management
    │   ├── StateManager.ts      # Central state singleton, local storage persistence, run batching, upgrades, achievements
    │   ├── EventBus.ts          # Typed pub/sub event bus
    │   ├── ObjectPool.ts        # Zero-allocation generic object pool
    │   ├── Localization.ts      # RU/EN localization dictionary and string formatter
    │   └── Performance.ts       # FPS counter and WebGL draw call monitor
    ├── engine/                  # 3D Three.js runtime & game logic
    │   ├── GameEngine.ts        # Main rAF loop, chase camera, lighting, track decor, input dispatch, state transitions
    │   ├── CrowdManager.ts      # InstancedMesh crowd (cap 200), formations, organic flocking, edge falling, mob classes
    │   ├── GateManager.ts       # Math gates, dual-wing per-mob collision, dynamic flip, combo multiplier
    │   ├── ObstacleManager.ts   # Traps (saws, axes, crushers, lasers, spikes), height-aware hazards, coins collection
    │   ├── BossManager.ts       # 5 bosses (L10, 20, 30, 40, 50), arena locking, telegraph rings, batch damage
    │   ├── FinishLineManager.ts # Multiplier wall steps (x1.2–x10.0), final chest, victory celebration
    │   ├── LevelGenerator.ts    # Deterministic seeded level generator, difficulty scaling, endless chunk streaming
    │   └── ParticleSystem.ts    # InstancedMesh particle pool (300 particles), bursts, gravity physics
    ├── utils/                   # Math & Procedural asset generation
    │   ├── math.ts              # clamp, lerp, calculateFormationOffset, checkCircleRectCollision, TRACK_RAIL_MARGIN
    │   ├── proceduralMeshes.ts  # createHumanoidGeometry, createGateTexture, createBossMesh, trap meshes
    │   └── cn.ts                # Tailwind class concatenation utility
    ├── audio/                   # Audio synthesis
    │   └── SoundEngine.ts       # Web Audio synthesizer (oscillators, envelopes, 5 BGM themes, SFX bank)
    ├── components/              # React UI views & overlays
    │   ├── GameCanvas.tsx       # 3D canvas lifecycle wrapper and HUD bridge
    │   ├── HUD.tsx              # Cyberpunk HUD (counters, adrenaline button, formation selector, hazard warnings)
    │   ├── MainMenu.tsx         # Campaign level selector (1–50), endless mode launcher, modal triggers
    │   ├── ShopModal.tsx        # Upgrades and character skins shop
    │   ├── SettingsModal.tsx    # Audio, graphics, sensitivity, language, save export/import
    │   ├── AchievementsModal.tsx# Achievement tracker and gem rewards
    │   ├── GuideModal.tsx       # Lore, mechanics, and tactical guide
    │   ├── TestModal.tsx        # In-game interactive Vitest suite runner
    │   ├── LevelEndModal.tsx    # Victory/defeat summary with star rating and score calculation
    │   ├── PauseModal.tsx       # Pause menu with resume, restart, and home actions
    │   ├── DialogueModal.tsx    # Story dialogues with character avatars
    │   └── FloatingText.tsx     # 3D-projected floating damage/bonus text indicators
    └── testing/                 # Automated tests
        ├── __tests__/game.test.ts # Vitest test suite (gates, economy, saves, smoke tests, formations)
        └── testSuites.ts        # Browser-executable test definitions
```

---

## 3. Coordinate System & Geometry Conventions (CRITICAL)

Three.js uses a standard **right-handed coordinate system**:
- **Track Axis**: The track extends along **$+Z$** from $Z = 0$ to $Z = \text{trackLength} + 40$.
- **Camera Orientation**: The camera is positioned behind the crowd leader at:
  - $X = \text{leaderX} \times 0.4$ (interpolated via `lerp`)
  - $Y = 6.0$ (`CAMERA_HEIGHT`)
  - $Z = \text{leaderZ} - (16.0 + \text{speedLag})$
  - Camera looks forward towards: $(\text{leaderX} \times 0.2, 2.5, \text{leaderZ} + 6.0)$.
- **Screen Axis Mirroring Trap**:
  - Because the camera looks forward along $+Z$, the camera's local right is world **$-X$**.
  - **Screen LEFT is $+X$**
  - **Screen CENTER is $X = 0$**
  - **Screen RIGHT is $-X$**
  - Steering to the right (swipe right or press `D` / `→`) **DECREASES** `leaderX`.
  - Steering to the left (swipe left or press `A` / `←`) **INCREASES** `leaderX`.
- **Track Dimensions & Rail Margins**:
  - `DEFAULT_TRACK_WIDTH = 16`
  - `TRACK_RAIL_MARGIN = 1.2` (defined in `src/utils/math.ts`)
  - `playableHalfWidth = trackWidth / 2 - TRACK_RAIL_MARGIN = 6.8` (clamping boundary for the crowd leader)
  - `trackHalfWidth = trackWidth / 2 = 8.0` (physical track edge).
- **Edge Falling Physics**:
  - When individual mobs wander beyond $|x| > \text{trackHalfWidth}$, they do not vanish instantly.
  - They transition into `falling: true` state, accelerated downward by gravity ($\text{fallVy} -= 18 \times dt$) with random angular tumbling ($\text{fallRotX} += dt \times 2.5$, $\text{fallRotZ} += dt \times 1.8$) until reaching $Y < -12$, emitting a `mobFell` event with particle burst and sound.

---

## 4. Key Subsystems & Design Patterns

### 4.1. Zero-Allocation Game Loop (0-GC)
- **Rule**: Never instantiate `new THREE.Vector3()`, `new THREE.Object3D()`, `new THREE.Color()`, or array allocations inside `GameEngine.update()`, `CrowdManager.update()`, `GateManager.update()`, or `ObstacleManager.update()`.
- Pre-allocated scratch objects on managers:
  - `dummy: THREE.Object3D` for matrix transformations.
  - `colorDummy: THREE.Color` for instance color updates.
  - `aliveScratch: MobInstance[]` buffer for sorting and querying live mobs without GC allocations.
- **Frustum Culling**: `instancedMesh.frustumCulled = false` MUST be set on both `CrowdManager` and `ParticleSystem`. Inactive slots parked at $(0, -100, 0)$ cause Three.js to compute a static bounding sphere around the origin; as the player advances along $+Z$, the entire mesh would otherwise be culled.

### 4.2. Crowd Management & Formations (`CrowdManager.ts`)
- **Capacity**: Fixed pool of 200 mobs (`maxCapacity: 200`).
- **Formations** (`calculateFormationOffset` in `src/utils/math.ts`):
  - `oval` (Default): Forward-elongated golden-spiral ellipse along $Z$. Natural scale compresses automatically to stay within `playableHalfWidth`.
  - `wedge`: V-shaped armored formation (-40% frontal damage).
  - `wide`: Horizontal sweeping line for maximum gate & coin coverage.
  - `circle`: Dense concentric phalanx for ramming bosses and obstacles.
  - `arrow`: Narrow spearhead column (+15% run speed bonus).
- **Specialized Mob Classes**:
  - `regular` (Cyan `#00f0ff`, $1.0\times$ HP, scale $0.65$)
  - `tank` (Gold/Amber `#f59e0b`, $3.0\times$ HP + 2 Shield, scale $0.88$, destroys destructible traps)
  - `ninja` (Purple `#a855f7`, 50% dodge chance, $2\times$ coin pickup, scale $0.55$)
  - `mage` (Emerald `#10b981`, $2.0\times$ HP + 1 Shield, scale $0.65$, transmutes negative gates into bonuses)
- **Damage Methods**:
  - `killMobs(count, reason)`: Applies defense aura upgrades, armor/shields, and ninja dodge. Frontline mobs take damage first.
  - `consumeMobs(count)`: Strict sacrifice without armor absorption (used by finish wall steps).
  - `killMobById(id)`: Direct instant kill (used by physical trap collisions and edge drops).
  - `addMobs(count)` / `multiplyMobs(factor)`: Adds mobs up to `maxCapacity` (200).

### 4.3. Math Gates & Per-Mob Collision (`GateManager.ts`)
- **Independent Per-Mob Processing**: Rather than testing only the crowd leader's position, `GateManager` tracks `processedMobs: Set<number>`.
- When the crowd crosses a gate ($z \ge \text{gate.z} - 0.5$), each mob is individually assigned to the left wing ($x < 0$) or right wing ($x \ge 0$), allowing split crowds to trigger both gate wings proportionally.
- **Operations**: `add` ($+N$), `multiply` ($\times N$), `subtract` ($-N$), `divide` ($\div N$), `conditional` ($\text{IF } \ge N \text{ ? } \times A : -B$), `mystery` ($60\%$ bonus / $40\%$ penalty), `adrenaline` (Hyper Mode for 5.0–8.0s).
- **Dynamic Textures**: Procedural canvas textures generated via `createGateTexture()` with high-visibility cyberpunk typography and gradient backgrounds.

### 4.4. Obstacles & Height Filtering (`ObstacleManager.ts`)
- **Trap Types**: `saw_blade` (horizontal sweep), `axe_pendulum` (sinusoidal swing), `crusher` (vertical slam), `laser_grid` (perimeter beam), `spike_trap` (ground hazard), `wrecking_ball`, `barrier_gate`, `lava_pit`.
- **Height-Aware Filter (`isHazardActive`)**: `checkCircleRectCollision()` tests 2D bounds ($XZ$). `isHazardActive()` filters 3D danger windows:
  - Crushers are lethal only when $y \le 1.2$.
  - Pendulum axes are lethal only when $|\text{rotation.z}| < 0.55$ (lowest arc point).
- **Contact Rule**: Any mob touching an active hazard is instantly killed via `killMobById()`. If Hyper Mode is active or a Tank hits a destructible trap (`crusher`, `axe_pendulum`), the obstacle is smashed without crowd loss.

### 4.5. Boss Battles (`BossManager.ts`)
- Milestone levels (10, 20, 30, 40, 50) spawn procedural bosses:
  - L10: Mecha Titan Protocol-X (150 HP)
  - L20: Magma Colossus Ignis (350 HP)
  - L30: Crystal Wyrm Leviathan (650 HP)
  - L40: Titan Nullifier (1100 HP)
  - L50: Apex Overlord Malakor (2000 HP)
- **Forward Lock**: The crowd leader's position is locked at `bossArenaZ - 5.5` while the boss is alive.
- **Telegraphing & Attack Cycles**: Visual red ring telegraph before attacks (`slam`, `laser`, `minions`).
- **Batched Damage**: Boss AOE attacks query all mobs in radius once and execute a single batched `killMobs()` call to prevent frame freeze and quadratic iteration.
- **Sub-linear DPS**: Crowd damage scales as $\min(140, 12 + N \times 1.6) \times dt$ to prevent instant boss melt while rewarding crowd size.

### 4.6. State Management & Run Batching (`StateManager.ts`)
- Hot gameplay counters (mobs spawned, gates passed, coins collected, combo streak) accumulate in a lightweight `RunStats` struct in memory.
- State is committed to `SaveData` in a single batch on level win, defeat, or exit via `commitRun()`, preventing frequent React re-renders and debouncing `localStorage` writes (500ms debounce).
- Save data supports full base64 export and import with corrupt payload recovery (`try/catch` wrapping).

### 4.7. Mobile Budget & Environment Lighting
- **Rule**: Never add `PointLight` or dynamic light sources to track decor.
- Track decor uses `MeshBasicMaterial` and standard materials with high `emissive` values and `ACESFilmicToneMapping`.
- Only one `DirectionalLight` (with shadows) and one `HemisphereLight` are active in the scene.

### 4.8. Endless Mode & Chunk Streaming
- In Endless mode, `GameEngine.updateEndlessStreaming()` monitors `crowd.leaderZ`. When approaching the end of current track ($Z > \text{currentEndlessZ} - 150$), `LevelGenerator.generateEndlessSegment()` dynamically streams and appends new gate/obstacle chunks.

---

## 5. How-To Guides for Common Extensions

### Adding a New Biome
1. Add biome identifier to `BiomeType` union in `src/types/game.ts`.
2. Configure biome mapping in `LevelGenerator.getBiomeForLevel()`.
3. Add biome-specific background scenery builder in `GameEngine.makeBiomeScenery()` (buildings, rocks, crystals, pillars).
4. Add biome soundtrack and ambient effects in `src/audio/SoundEngine.ts`.

### Adding a New Obstacle Type
1. Add the type identifier to `ObstacleType` union in `src/types/game.ts`.
2. Create the procedural 3D model builder in `src/utils/proceduralMeshes.ts`.
3. Add a builder case in `ObstacleManager.buildObstacleVisual()`.
4. Define animation behavior in `ObstacleManager.update()` and height-safety rules in `ObstacleManager.isHazardActive()`.
5. Register spawn frequency and parameters in `LevelGenerator.generateLevel()`.

### Adding a New Mob Class
1. Add the class name to `MobType` in `src/types/game.ts`.
2. Configure spawn chance upgrades in `PlayerUpgrades` and `INITIAL_UPGRADES` (`StateManager.ts`).
3. Add scale, HP, shield, and color presets in `CrowdManager.spawnMob()`.
4. Implement unique class abilities (e.g., Tank smash in `ObstacleManager`, Ninja 2x loot in `ObstacleManager`, Mage transmutation in `GateManager`).

### Adding a New Formation
1. Add formation name to `FormationType` in `src/types/game.ts`.
2. Implement offset formula with width scaling in `calculateFormationOffset()` in `src/utils/math.ts`.
3. Add formation button and hotkey in `HUD.tsx` / `GameEngine.ts`.
4. Add unit test in `src/testing/__tests__/game.test.ts`.

### Adding a New Upgrade or Skin
1. **Skin**: Add entry to `INITIAL_SKINS` in `src/core/StateManager.ts` with color hex, emissive hex, model style, and price.
2. **Upgrade**: Add stat key to `PlayerUpgrades` in `src/types/game.ts` and default value in `INITIAL_UPGRADES`. Add cost formula in `StateManager.getUpgradeCost()`.

---

## 6. Build, Test & Deployment Verification

```bash
# 1. Install dependencies
npm install

# 2. Run TypeScript strict typecheck (MANDATORY before commits)
npx tsc --noEmit

# 3. Run automated Vitest test suites (All 62 tests must pass)
npm test

# 4. Run Vite development server
npm run dev

# 5. Build production distribution
npm run build

# 6. Preview production build locally (Port 9765)
npm run preview

# 7. Production deployment to webroot
cp -r dist/* /var/www/tolpa/

# 8. PM2 process verification
pm2 status tolpa
pm2 restart tolpa
```
