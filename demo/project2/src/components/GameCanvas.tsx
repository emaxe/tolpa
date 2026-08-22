import React, { useEffect, useRef, useState } from 'react';
import { GameEngine } from '../engine/GameEngine';
import { FormationType } from '../types/game';
import { HUD } from './HUD';
import { eventBus } from '../core/EventBus';

interface GameCanvasProps {
  levelNumber: number;
  isEndless?: boolean;
  onLevelWon: (score: number, mult: number, remainingMobs: number) => void;
  onLevelLost: () => void;
  onPause: () => void;
}

export const GameCanvas: React.FC<GameCanvasProps> = ({
  levelNumber,
  isEndless = false,
  onLevelWon,
  onLevelLost,
  onPause,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const [crowdCount, setCrowdCount] = useState<number>(1);
  const [formation, setFormation] = useState<FormationType>('wedge');
  const [isHyper, setIsHyper] = useState<boolean>(false);
  const [combo, setCombo] = useState<number>(0);

  useEffect(() => {
    if (!containerRef.current) return;

    const engine = new GameEngine(containerRef.current);
    engineRef.current = engine;

    if (isEndless) {
      engine.startEndlessMode(onLevelLost);
    } else {
      engine.loadLevel(levelNumber, onLevelWon, onLevelLost);
    }

    engine.start();

    // Event bus listeners
    const unsubMobs = eventBus.on('mobsKilled', () => {
      if (engineRef.current) {
        setCrowdCount(engineRef.current.crowd.getAliveCount());
      }
    });

    const unsubGate = eventBus.on('gatePassed', (data) => {
      if (engineRef.current) {
        setCrowdCount(engineRef.current.crowd.getAliveCount());
        setCombo(data.comboStreak || 0);
      }
    });

    const unsubFormation = eventBus.on('formationChanged', (f) => {
      setFormation(f);
    });

    const unsubAdrenaline = eventBus.on('adrenalineTriggered', () => {
      setIsHyper(true);
    });

    // Loop interval for polling crowd count and hyper mode status
    const pollInterval = setInterval(() => {
      if (engineRef.current) {
        setCrowdCount(engineRef.current.crowd.getAliveCount());
        setIsHyper(engineRef.current.crowd.isHyperMode);
      }
    }, 60);

    return () => {
      clearInterval(pollInterval);
      unsubMobs();
      unsubGate();
      unsubFormation();
      unsubAdrenaline();
      engine.dispose();
      engineRef.current = null;
    };
  }, [levelNumber, isEndless, onLevelWon, onLevelLost]);

  const handleFormationChange = (f: FormationType) => {
    if (engineRef.current) {
      engineRef.current.setFormation(f);
      setFormation(f);
    }
  };

  const handleActivateAdrenaline = () => {
    if (engineRef.current) {
      engineRef.current.activateAdrenaline();
    }
  };

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-950">
      {/* Three.js canvas container */}
      <div ref={containerRef} className="w-full h-full select-none touch-none" />

      {/* In-game HUD */}
      <HUD
        crowdCount={crowdCount}
        levelNumber={levelNumber}
        isEndless={isEndless}
        onPause={onPause}
        onFormationChange={handleFormationChange}
        currentFormation={formation}
        onActivateAdrenaline={handleActivateAdrenaline}
        isHyperActive={isHyper}
        comboStreak={combo}
      />
    </div>
  );
};
