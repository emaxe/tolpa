import React, { useEffect, useRef, useState } from 'react';
import { GameEngine, HudSnapshot } from '../engine/GameEngine';
import { FormationType } from '../types/game';
import { RunStats } from '../core/StateManager';
import { HUD } from './HUD';
import { FloatingText } from './FloatingText';
import { eventBus } from '../core/EventBus';

interface GameCanvasProps {
  levelNumber: number;
  isEndless?: boolean;
  runId: number;
  isPaused: boolean;
  inputEnabled: boolean;
  onLevelWon: (score: number, mult: number, remainingMobs: number, runStats: RunStats) => void;
  onLevelLost: (runStats: RunStats) => void;
  onPauseRequest: () => void;
  onPauseButton: () => void;
}

const EMPTY_SNAPSHOT: HudSnapshot = {
  crowd: 1,
  isHyper: false,
  adrenalineCharge: 0,
  progress: 0,
  metersLeft: -1,
  bossProgress: -1,
  nextHazardDistance: -1,
  fps: 60,
  drawCalls: 0,
};

export const GameCanvas: React.FC<GameCanvasProps> = ({
  levelNumber,
  isEndless = false,
  runId,
  isPaused,
  inputEnabled,
  onLevelWon,
  onLevelLost,
  onPauseRequest,
  onPauseButton,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const [formation, setFormation] = useState<FormationType>('oval');
  const [combo, setCombo] = useState<number>(0);
  const [hud, setHud] = useState<HudSnapshot>(EMPTY_SNAPSHOT);

  // Последние версии коллбэков — движок читает их через ref, поэтому эффект ниже
  // не должен перезапускаться при каждом ре-рендере App (иначе именно это раньше
  // пересоздавало движок и отбрасывало уровень на старт).
  const callbacksRef = useRef({ onLevelWon, onLevelLost, onPauseRequest });
  useEffect(() => {
    callbacksRef.current = { onLevelWon, onLevelLost, onPauseRequest };
  });

  useEffect(() => {
    if (!containerRef.current) return;

    const engine = new GameEngine(containerRef.current, {
      onPauseRequest: () => callbacksRef.current.onPauseRequest(),
    });
    engineRef.current = engine;

    if (isEndless) {
      engine.startEndlessMode((runStats) => callbacksRef.current.onLevelLost(runStats));
    } else {
      engine.loadLevel(
        levelNumber,
        (score, mult, mobs, runStats) => callbacksRef.current.onLevelWon(score, mult, mobs, runStats),
        (runStats) => callbacksRef.current.onLevelLost(runStats)
      );
    }

    engine.start();
    setFormation('oval');
    setCombo(0);
    setHud(engine.getHudSnapshot());

    const unsubFormation = eventBus.on('formationChanged', (f: FormationType) => {
      setFormation(f);
    });

    const unsubGate = eventBus.on('gatePassed', (data: { comboStreak?: number }) => {
      setCombo(data.comboStreak || 0);
    });

    // Единственный опрос снимка состояния для HUD (толпа, гипер, заряд адреналина,
    // прогресс до финиша) — раньше здесь было ДВА независимых таймера (в GameCanvas
    // и в HUD), дававших рассинхронизацию и лишние ре-рендеры.
    const pollInterval = window.setInterval(() => {
      if (engineRef.current) setHud(engineRef.current.getHudSnapshot());
    }, 150);

    return () => {
      window.clearInterval(pollInterval);
      unsubFormation();
      unsubGate();
      engine.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelNumber, isEndless, runId]);

  useEffect(() => {
    engineRef.current?.setInputEnabled(inputEnabled);
  }, [inputEnabled]);

  useEffect(() => {
    engineRef.current?.setPaused(isPaused);
  }, [isPaused]);

  const handleFormationChange = (f: FormationType) => {
    engineRef.current?.setFormation(f);
    setFormation(f);
  };

  const handleActivateAdrenaline = () => {
    engineRef.current?.activateAdrenaline();
  };

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-950">
      {/* Three.js canvas container */}
      <div ref={containerRef} className="w-full h-full select-none touch-none" />

      {/* Флоатинг-текст: +N/×N/−N над воротами и уроном */}
      <FloatingText engine={engineRef} />

      {/* In-game HUD */}
      <HUD
        crowdCount={hud.crowd}
        levelNumber={levelNumber}
        isEndless={isEndless}
        onPause={onPauseButton}
        onFormationChange={handleFormationChange}
        currentFormation={formation}
        onActivateAdrenaline={handleActivateAdrenaline}
        isHyperActive={hud.isHyper}
        comboStreak={combo}
        adrenalineCharge={hud.adrenalineCharge}
        progress={hud.progress}
        metersLeft={hud.metersLeft}
        bossProgress={hud.bossProgress}
        nextHazardDistance={hud.nextHazardDistance}
        fps={hud.fps}
        drawCalls={hud.drawCalls}
      />
    </div>
  );
};
