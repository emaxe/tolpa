import React, { useState, useEffect, useCallback } from 'react';
import { GamePhase, DialogueLine } from './types/game';
import { stateManager, RunStats } from './core/StateManager';
import { GameCanvas } from './components/GameCanvas';
import { MainMenu } from './components/MainMenu';
import { DialogueModal } from './components/DialogueModal';
import { ShopModal } from './components/ShopModal';
import { SettingsModal } from './components/SettingsModal';
import { AchievementsModal } from './components/AchievementsModal';
import { GuideModal } from './components/GuideModal';
import { TestModal } from './components/TestModal';
import { LevelEndModal } from './components/LevelEndModal';
import { PauseModal } from './components/PauseModal';
import { soundEngine } from './audio/SoundEngine';

export const App: React.FC = () => {
  const [phase, setPhase] = useState<GamePhase>('main_menu');
  const [activeLevel, setActiveLevel] = useState<number>(1);
  const [isEndless, setIsEndless] = useState<boolean>(false);
  const [activeModal, setActiveModal] = useState<'shop' | 'settings' | 'achievements' | 'guide' | 'tests' | null>(null);

  // Единственный явный сигнал "запустить/перезапустить забег" — GameCanvas пересоздаёт
  // движок только когда меняется levelNumber/isEndless/runId, а не на каждый ре-рендер.
  const [runId, setRunId] = useState<number>(0);

  // End level results
  const [endResult, setEndResult] = useState<{
    isVictory: boolean;
    score: number;
    multiplier: number;
    crowdCount: number;
    stars: number;
    runStats: RunStats | null;
    endless?: { distance: number; isNewRecord: boolean; coinsEarned: number };
  } | null>(null);

  // Story dialogue lines
  const [dialogueQueue, setDialogueQueue] = useState<DialogueLine[]>([]);

  // State subscription to trigger re-renders
  const [, setTick] = useState<number>(0);
  useEffect(() => {
    return stateManager.subscribe(() => {
      setTick((t) => t + 1);
    });
  }, []);

  const handlePlayLevel = useCallback((levelNum: number) => {
    setActiveLevel(levelNum);
    setIsEndless(false);
    setEndResult(null);
    setRunId((id) => id + 1);

    // Story Dialogues on key milestones
    if (levelNum === 1 && stateManager.getState().storyProgress === 0) {
      setDialogueQueue([
        {
          speaker: 'commander',
          speakerNameKey: 'speakerCommander',
          avatar: 'commander',
          textKey: 'storyPrologue',
          fallbackText: 'Внимание! Сеть Цитадели захвачена дефектным ИИ Малакором. Соберите отряд кибер-легионеров, пройдите сквозь квантовые ворота и сокрушите барьеры врага!',
        },
      ]);
      setPhase('story_dialogue');
    } else if (levelNum === 10) {
      setDialogueQueue([
        {
          speaker: 'professor',
          speakerNameKey: 'speakerProfessor',
          avatar: 'professor',
          textKey: 'storyBoss1Warning',
          fallbackText: 'Профессор Спарк: Впереди пробудился древний Меха-Голем! Направьте легион клином, чтобы пробить его защитную броню!',
        },
      ]);
      setPhase('story_dialogue');
    } else if (levelNum === 20) {
      setDialogueQueue([
        {
          speaker: 'echo',
          speakerNameKey: 'speakerEcho',
          avatar: 'echo',
          textKey: 'storyBoss2Warning',
          fallbackText: 'Эхо: Датчики зашкаливают! Магма-Колосс извергает лаву. Используйте ловкость ниндзя и адреналиновый рывок!',
        },
      ]);
      setPhase('story_dialogue');
    } else if (levelNum === 50) {
      setDialogueQueue([
        {
          speaker: 'boss',
          speakerNameKey: 'speakerBoss',
          avatar: 'boss',
          textKey: 'storyBoss5Final',
          fallbackText: 'Малакор: Жалкие органические формы жизни. Ваш легион растворится в квантовом ядре!',
        },
      ]);
      setPhase('story_dialogue');
    } else {
      setPhase('running');
    }
  }, []);

  const handlePlayEndless = useCallback(() => {
    setIsEndless(true);
    setEndResult(null);
    setRunId((id) => id + 1);
    setPhase('running');
  }, []);

  const handleLevelWon = useCallback(
    (score: number, mult: number, remainingMobs: number, runStats: RunStats) => {
      const stars = remainingMobs >= 60 ? 3 : remainingMobs >= 20 ? 2 : 1;
      const coinsEarned = Math.round(score * 0.5);
      const gemsEarned = activeLevel % 10 === 0 ? 10 : 2;

      stateManager.addCoins(coinsEarned);
      if (gemsEarned > 0) {
        stateManager.addGems(gemsEarned);
        soundEngine.playSound('gem_pickup');
      }
      stateManager.completeLevel(activeLevel, score, remainingMobs, stars);

      setEndResult({
        isVictory: true,
        score,
        multiplier: mult,
        crowdCount: remainingMobs,
        stars,
        runStats,
      });
      setPhase('level_won');
    },
    [activeLevel]
  );

  const handleLevelLost = useCallback(
    (runStats: RunStats) => {
      // Бесконечный режим: забег всегда заканчивается гибелью толпы, но это не «поражение» —
      // честно подводим итог: пройденная дистанция, новый рекорд (если побили), награда.
      // runStats.distance уже зафиксирован до commitRun() (см. endRun в GameEngine).
      if (isEndless) {
        const distance = runStats?.distance ?? 0;
        const isNewRecord = distance > stateManager.getState().endlessHighScore;
        if (isNewRecord) stateManager.setEndlessHighScore(distance);
        // Награда за дистанцию: ~10 монет за 100 м (масштабируется с экономикой).
        const coinsEarned = Math.floor(distance / 10);
        if (coinsEarned > 0) stateManager.addCoins(coinsEarned);
        setEndResult({
          isVictory: true,
          score: distance,
          multiplier: 1.0,
          crowdCount: runStats?.maxCrowd ?? 0,
          stars: 0,
          runStats,
          endless: { distance, isNewRecord, coinsEarned },
        });
        setPhase('level_lost');
        return;
      }
      setEndResult({
        isVictory: false,
        score: 0,
        multiplier: 1.0,
        crowdCount: 0,
        stars: 0,
        runStats,
      });
      setPhase('level_lost');
    },
    [isEndless]
  );

  const handleNextLevel = useCallback(() => {
    const nextLvl = Math.min(50, activeLevel + 1);
    handlePlayLevel(nextLvl);
  }, [activeLevel, handlePlayLevel]);

  const handleRetry = useCallback(() => {
    if (isEndless) {
      handlePlayEndless();
    } else {
      handlePlayLevel(activeLevel);
    }
  }, [isEndless, activeLevel, handlePlayEndless, handlePlayLevel]);

  const handleToMainMenu = useCallback(() => {
    soundEngine.stopMusic();
    setPhase('main_menu');
    setEndResult(null);
  }, []);

  // Вызывается движком (Escape / потеря фокуса окна) — просит поставить игру на паузу.
  // Действует только пока реально идёт забег, чтобы не перебивать диалоги/модалки.
  const handlePauseRequest = useCallback(() => {
    setPhase((p) => (p === 'running' ? 'paused' : p));
  }, []);

  const handleResume = useCallback(() => {
    setPhase((p) => (p === 'paused' ? 'running' : p));
  }, []);

  const handlePauseButton = useCallback(() => {
    setPhase((p) => (p === 'running' ? 'paused' : p === 'paused' ? 'running' : p));
  }, []);

  return (
    <div className="w-screen h-screen overflow-hidden bg-zinc-950 text-white font-sans relative">
      {/* 3D Game Canvas — остаётся смонтированным на паузе и на экране победы/поражения,
          чтобы движок не пересоздавался (и, соответственно, не перезапускал уровень) */}
      {(phase === 'running' || phase === 'paused' || phase === 'level_won' || phase === 'level_lost') && (
        <GameCanvas
          levelNumber={activeLevel}
          isEndless={isEndless}
          runId={runId}
          isPaused={phase === 'paused'}
          inputEnabled={phase === 'running' && activeModal === null}
          onLevelWon={handleLevelWon}
          onLevelLost={handleLevelLost}
          onPauseRequest={handlePauseRequest}
          onPauseButton={handlePauseButton}
        />
      )}

      {/* Main Menu Phase */}
      {phase === 'main_menu' && (
        <MainMenu
          onPlayLevel={handlePlayLevel}
          onPlayEndless={handlePlayEndless}
          onOpenShop={() => setActiveModal('shop')}
          onOpenAchievements={() => setActiveModal('achievements')}
          onOpenSettings={() => setActiveModal('settings')}
          onOpenGuide={() => setActiveModal('guide')}
          onOpenTests={() => setActiveModal('tests')}
        />
      )}

      {/* Story Dialogue Overlay */}
      {phase === 'story_dialogue' && (
        <DialogueModal
          dialogues={dialogueQueue}
          onComplete={() => {
            setDialogueQueue([]);
            setPhase('running');
          }}
        />
      )}

      {/* Pause Overlay */}
      {phase === 'paused' && (
        <PauseModal onResume={handleResume} onRestart={handleRetry} onHome={handleToMainMenu} />
      )}

      {/* Level End Modal (Victory / Defeat) */}
      {(phase === 'level_won' || phase === 'level_lost') && endResult && (
        <LevelEndModal
          isVictory={endResult.isVictory}
          levelNumber={activeLevel}
          score={endResult.score}
          multiplier={endResult.multiplier}
          crowdCount={endResult.crowdCount}
          stars={endResult.stars}
          runStats={endResult.runStats}
          isEndless={isEndless}
          endless={endResult.endless}
          onNextLevel={handleNextLevel}
          onRetry={handleRetry}
          onHome={handleToMainMenu}
          onOpenShop={() => setActiveModal('shop')}
        />
      )}

      {/* Modals */}
      {activeModal === 'shop' && <ShopModal onClose={() => setActiveModal(null)} />}
      {activeModal === 'settings' && (
        <SettingsModal
          onClose={() => setActiveModal(null)}
          onLanguageChanged={() => setTick((t) => t + 1)}
        />
      )}
      {activeModal === 'achievements' && <AchievementsModal onClose={() => setActiveModal(null)} />}
      {activeModal === 'guide' && <GuideModal onClose={() => setActiveModal(null)} />}
      {activeModal === 'tests' && <TestModal onClose={() => setActiveModal(null)} />}
    </div>
  );
};

export default App;
