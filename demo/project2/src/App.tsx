import React, { useState, useEffect } from 'react';
import { GamePhase, DialogueLine } from './types/game';
import { stateManager } from './core/StateManager';
import { GameCanvas } from './components/GameCanvas';
import { MainMenu } from './components/MainMenu';
import { DialogueModal } from './components/DialogueModal';
import { ShopModal } from './components/ShopModal';
import { SettingsModal } from './components/SettingsModal';
import { AchievementsModal } from './components/AchievementsModal';
import { GuideModal } from './components/GuideModal';
import { TestModal } from './components/TestModal';
import { LevelEndModal } from './components/LevelEndModal';
import { soundEngine } from './audio/SoundEngine';

export const App: React.FC = () => {
  const [phase, setPhase] = useState<GamePhase>('main_menu');
  const [activeLevel, setActiveLevel] = useState<number>(1);
  const [isEndless, setIsEndless] = useState<boolean>(false);
  const [activeModal, setActiveModal] = useState<'shop' | 'settings' | 'achievements' | 'guide' | 'tests' | null>(null);

  // End level results
  const [endResult, setEndResult] = useState<{
    isVictory: boolean;
    score: number;
    multiplier: number;
    crowdCount: number;
    stars: number;
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

  const handlePlayLevel = (levelNum: number) => {
    setActiveLevel(levelNum);
    setIsEndless(false);
    setEndResult(null);

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
  };

  const handlePlayEndless = () => {
    setIsEndless(true);
    setEndResult(null);
    setPhase('running');
  };

  const handleLevelWon = (score: number, mult: number, remainingMobs: number) => {
    const stars = remainingMobs >= 60 ? 3 : remainingMobs >= 20 ? 2 : 1;
    const coinsEarned = Math.round(score * 0.5);
    const gemsEarned = activeLevel % 10 === 0 ? 10 : 2;

    stateManager.addCoins(coinsEarned);
    if (gemsEarned > 0) stateManager.addGems(gemsEarned);
    stateManager.completeLevel(activeLevel, score, remainingMobs, stars);

    setEndResult({
      isVictory: true,
      score,
      multiplier: mult,
      crowdCount: remainingMobs,
      stars,
    });
    setPhase('level_won');
  };

  const handleLevelLost = () => {
    setEndResult({
      isVictory: false,
      score: 0,
      multiplier: 1.0,
      crowdCount: 0,
      stars: 0,
    });
    setPhase('level_lost');
  };

  const handleNextLevel = () => {
    const nextLvl = Math.min(50, activeLevel + 1);
    handlePlayLevel(nextLvl);
  };

  const handleRetry = () => {
    if (isEndless) {
      handlePlayEndless();
    } else {
      handlePlayLevel(activeLevel);
    }
  };

  const handleToMainMenu = () => {
    soundEngine.stopMusic();
    setPhase('main_menu');
    setEndResult(null);
  };

  return (
    <div className="w-screen h-screen overflow-hidden bg-slate-950 text-white font-sans relative">
      {/* 3D Game Canvas Running Phase */}
      {(phase === 'running' || phase === 'level_won' || phase === 'level_lost') && (
        <GameCanvas
          levelNumber={activeLevel}
          isEndless={isEndless}
          onLevelWon={handleLevelWon}
          onLevelLost={handleLevelLost}
          onPause={handleToMainMenu}
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

      {/* Level End Modal (Victory / Defeat) */}
      {(phase === 'level_won' || phase === 'level_lost') && endResult && (
        <LevelEndModal
          isVictory={endResult.isVictory}
          levelNumber={activeLevel}
          score={endResult.score}
          multiplier={endResult.multiplier}
          crowdCount={endResult.crowdCount}
          stars={endResult.stars}
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
