/**
 * GameScreen: монтирует GameEngine (Three.js) в контейнер, подписывается
 * на события (HUD, complete, fail, pause) и показывает оверлеи.
 * Полное уничтожение движка при размонтировании (без утечек).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { GameEngine } from "../game/systems/GameEngine";
import type { HudData, LevelResult } from "../game/systems/GameEngine";
import { store, TOTAL_LEVELS } from "../game/core/GameState";
import { HUD } from "./HUD";
import { CompleteOverlay, FailOverlay, PauseOverlay } from "./Overlays";
import { StoryDialog } from "./screens/StoryDialog";
import { useL10n } from "./useL10n";

export interface GameScreenProps {
  levelIndex: number;
  onExit: () => void;
  onSelectLevel: (index: number) => void;
  onEnding: () => void;
}

function resolveQuality(q: string): "low" | "med" | "high" {
  if (q !== "auto") return q as "low" | "med" | "high";
  const ua = navigator.userAgent;
  const mobile = /iPhone|Android|iPad/i.test(ua);
  const cores = navigator.hardwareConcurrency ?? 4;
  if (mobile || cores <= 4) return "low";
  if (cores <= 6) return "med";
  return "high";
}

function dialogForLevel(index: number): string | null {
  if (index === 0) return store.isStorySeen("intro") ? null : "intro";
  const world = Math.floor(index / 11);
  const isBoss = index % 11 === 10;
  if (!isBoss && index % 11 === 0 && !store.isStorySeen(`w${world}`)) return `w${world}`;
  if (isBoss && !store.isStorySeen(`boss${world}`)) return `boss${world}`;
  return null;
}

export function GameScreen({ levelIndex, onExit, onSelectLevel, onEnding }: GameScreenProps) {
  const { t } = useL10n();
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [hud, setHud] = useState<HudData | null>(null);
  const [result, setResult] = useState<LevelResult | null>(null);
  const [failed, setFailed] = useState<{ score: number; coins: number } | null>(null);
  const [paused, setPaused] = useState(false);
  const [dialog, setDialog] = useState<string | null>(() => dialogForLevel(levelIndex));

  const isTouch = useMemo(
    () => typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0),
    [],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const quality = resolveQuality(store.getData().settings.quality);
    const engine = new GameEngine(el, store, quality);
    engineRef.current = engine;

    const offHud = engine.events.on("hud", (h) => setHud({ ...h }));
    const offComplete = engine.events.on("complete", (r) => {
      setResult(r);
      if (r.levelIndex === TOTAL_LEVELS - 1) {
        setTimeout(() => onEnding(), 2600);
      }
    });
    const offFail = engine.events.on("fail", (f) => setFailed(f));
    const offPause = engine.events.on("pause", (p) => setPaused(p));

    return () => {
      offHud();
      offComplete();
      offFail();
      offPause();
      engine.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelIndex]);

  // Старт уровня: после диалога или сразу
  useEffect(() => {
    if (!engineRef.current) return;
    if (!dialog) {
      engineRef.current.startLevel(levelIndex);
    }
  }, [dialog, levelIndex]);

  const closeDialog = () => {
    if (dialog) store.markStorySeen(dialog);
    setDialog(null);
  };

  const nextLevel = result && result.levelIndex + 1 < TOTAL_LEVELS ? result.levelIndex + 1 : null;

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-950">
      <div ref={containerRef} className="absolute inset-0" aria-label="3D game canvas" />
      {hud && (
        <HUD
          hud={hud}
          isTouch={isTouch}
          showFps={store.getData().settings.showFps}
          onPause={() => engineRef.current?.setPaused(true)}
          onFormation={() => engineRef.current?.cycleFormation()}
          onAdrenaline={() => engineRef.current?.tryAdrenaline()}
        />
      )}

      {/* Сенсорные зоны движения */}
      {isTouch && !paused && !result && !failed && !dialog && (
        <div className="pointer-events-none absolute inset-x-0 top-0 bottom-24 z-10" aria-hidden />
      )}

      {paused && (
        <PauseOverlay
          onResume={() => engineRef.current?.setPaused(false)}
          onRestart={() => {
            setPaused(false);
            setResult(null);
            setFailed(null);
            engineRef.current?.restart();
          }}
          onExit={onExit}
        />
      )}

      {result && !paused && (
        <CompleteOverlay
          result={result}
          onNext={() => {
            if (nextLevel !== null) onSelectLevel(nextLevel);
            else onExit();
          }}
          onLevels={onExit}
        />
      )}

      {failed && !paused && (
        <FailOverlay
          score={failed.score}
          coins={failed.coins}
          onRetry={() => {
            setFailed(null);
            engineRef.current?.restart();
          }}
          onLevels={onExit}
        />
      )}

      {dialog && <StoryDialog prefix={`dialog.${dialog}`} onClose={closeDialog} />}

      {/* Подсказка загрузки, если HUD ещё не пришёл */}
      {!hud && !dialog && (
        <div className="absolute inset-0 z-30 flex items-center justify-center text-white/50">…</div>
      )}
      <span className="sr-only">{t("common.level")}</span>
    </div>
  );
}
