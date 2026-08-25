import React, { useEffect, useState } from 'react';
import { stateManager } from '../core/StateManager';
import { i18n } from '../core/Localization';
import { soundEngine } from '../audio/SoundEngine';
import {
  Play,
  Grid,
  ShoppingCart,
  Award,
  Settings,
  BookOpen,
  FileCode,
  Infinity as InfinityIcon,
  Star,
  Skull,
  Coins,
  Gem,
  Lock,
  ChevronLeft,
} from 'lucide-react';

interface MainMenuProps {
  onPlayLevel: (levelNum: number) => void;
  onPlayEndless: () => void;
  onOpenShop: () => void;
  onOpenAchievements: () => void;
  onOpenSettings: () => void;
  onOpenGuide: () => void;
  onOpenTests: () => void;
}

export const MainMenu: React.FC<MainMenuProps> = ({
  onPlayLevel,
  onPlayEndless,
  onOpenShop,
  onOpenAchievements,
  onOpenSettings,
  onOpenGuide,
  onOpenTests,
}) => {
  const [showLevelSelect, setShowLevelSelect] = useState<boolean>(false);
  const state = stateManager.getState();

  // При первом пользовательском взаимодействии с меню запускаем чилловую BGM-тему.
  // playMusic() сам переключает currentTheme и не создаёт дубль-интервал (isBgmPlaying guard).
  useEffect(() => {
    const startMenuMusic = () => {
      soundEngine.playMusic('menu');
      window.removeEventListener('pointerdown', startMenuMusic);
      window.removeEventListener('keydown', startMenuMusic);
    };
    window.addEventListener('pointerdown', startMenuMusic);
    window.addEventListener('keydown', startMenuMusic);
    return () => {
      window.removeEventListener('pointerdown', startMenuMusic);
      window.removeEventListener('keydown', startMenuMusic);
    };
  }, []);

  const handleStartCurrent = () => {
    soundEngine.playSound('button_click');
    onPlayLevel(state.currentLevel);
  };

  const handleSelectLevel = (lvl: number) => {
    if (lvl <= state.maxUnlockedLevel) {
      soundEngine.playSound('button_click');
      stateManager.setCurrentLevel(lvl);
      onPlayLevel(lvl);
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-between p-4 md:p-8 bg-gradient-to-b from-slate-100/90 via-slate-100/75 to-slate-100/95 select-none overflow-y-auto">
      {/* Top Bar: Currencies & Quick settings */}
      <div className="flex justify-between items-center max-w-5xl mx-auto w-full">
        {/* Currencies */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white/90 border border-amber-500/40 px-3.5 py-1.5 rounded-full shadow-lg text-amber-400 font-orbitron font-bold text-xs md:text-sm">
            <Coins className="w-4 h-4 text-amber-400" />
            <span>{state.coins.toLocaleString()}</span>
          </div>

          <div className="flex items-center gap-2 bg-white/90 border border-rose-500/40 px-3.5 py-1.5 rounded-full shadow-lg text-rose-400 font-orbitron font-bold text-xs md:text-sm">
            <Gem className="w-4 h-4 text-rose-400" />
            <span>{state.gems.toLocaleString()}</span>
          </div>
        </div>

        {/* Settings & Guide */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              soundEngine.playSound('button_click');
              onOpenGuide();
            }}
            className="p-2.5 bg-white/80 hover:bg-slate-200 border border-slate-300 rounded-xl text-slate-700 hover:text-slate-900 transition-all shadow cursor-pointer"
            title={i18n.t('loreGuide')}
          >
            <BookOpen className="w-4 h-4" />
          </button>

          <button
            onClick={() => {
              soundEngine.playSound('button_click');
              onOpenTests();
            }}
            className="p-2.5 bg-white/80 hover:bg-slate-200 border border-emerald-500/40 text-emerald-600 hover:text-emerald-700 rounded-xl transition-all shadow cursor-pointer"
            title={i18n.t('testSuite')}
          >
            <FileCode className="w-4 h-4" />
          </button>

          <button
            onClick={() => {
              soundEngine.playSound('button_click');
              onOpenSettings();
            }}
            className="p-2.5 bg-white/80 hover:bg-slate-200 border border-slate-300 rounded-xl text-slate-700 hover:text-slate-900 transition-all shadow cursor-pointer"
            title={i18n.t('settings')}
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Center Area */}
      {!showLevelSelect ? (
        <div className="flex flex-col items-center justify-center my-auto py-6 max-w-lg mx-auto w-full text-center">
          {/* Glowing Game Title */}
          <div className="mb-8">
            <div className="inline-block px-3 py-1 bg-amber-950/80 border border-amber-500/50 rounded-full text-[11px] font-orbitron font-bold text-amber-300 uppercase tracking-widest mb-3">
              3D Crowd Tactical Runner
            </div>
            <h1 className="font-orbitron font-black text-4xl md:text-5xl text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-yellow-100 to-orange-400 drop-shadow-[0_0_25px_rgba(245,158,11,0.5)] tracking-wider">
              {i18n.t('gameTitle')}
            </h1>
            <p className="text-slate-600 text-xs md:text-sm font-sans tracking-wide mt-2">
              {i18n.t('gameSubtitle')}
            </p>
          </div>

          {/* Large PLAY Button */}
          <button
            onClick={handleStartCurrent}
            className="w-full py-4 md:py-5 bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500 hover:from-amber-300 hover:to-orange-400 text-zinc-950 font-orbitron font-black text-lg md:text-xl uppercase tracking-widest rounded-2xl shadow-2xl shadow-amber-500/35 transition-all transform hover:scale-105 active:scale-95 flex items-center justify-center gap-3 mb-4 cursor-pointer"
          >
            <Play className="w-6 h-6 fill-current" />
            <span>{i18n.t('play')} (УР. {state.currentLevel})</span>
          </button>

          {/* Secondary Action Grid */}
          <div className="grid grid-cols-2 gap-3 w-full mb-3">
            <button
              onClick={() => {
                soundEngine.playSound('button_click');
                setShowLevelSelect(true);
              }}
              className="py-3 bg-white/90 hover:bg-slate-200 border border-slate-300 rounded-xl font-orbitron font-bold text-xs uppercase tracking-wider text-slate-800 flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <Grid className="w-4 h-4 text-teal-700" />
              <span>{i18n.t('levelSelect')} (50)</span>
            </button>

            <button
              onClick={() => {
                soundEngine.playSound('button_click');
                onPlayEndless();
              }}
              className="py-3 bg-white/90 hover:bg-slate-200 border border-rose-500/40 rounded-xl font-orbitron font-bold text-xs uppercase tracking-wider text-rose-600 flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <InfinityIcon className="w-4 h-4 text-rose-400" />
              <span>{i18n.t('endlessMode')}</span>
              {state.endlessHighScore > 0 && (
                <span className="text-[9px] text-rose-600/80">
                  {i18n.t('endlessRecord')}: {state.endlessHighScore.toLocaleString()} м
                </span>
              )}
            </button>
          </div>

          {/* Shop & Achievements Row */}
          <div className="grid grid-cols-2 gap-3 w-full">
            <button
              onClick={() => {
                soundEngine.playSound('button_click');
                onOpenShop();
              }}
              className="py-3 bg-white/90 hover:bg-slate-200 border border-slate-300 rounded-xl font-orbitron font-bold text-xs uppercase tracking-wider text-slate-800 flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <ShoppingCart className="w-4 h-4 text-amber-400" />
              <span>{i18n.t('shop')}</span>
            </button>

            <button
              onClick={() => {
                soundEngine.playSound('button_click');
                onOpenAchievements();
              }}
              className="py-3 bg-white/90 hover:bg-slate-200 border border-slate-300 rounded-xl font-orbitron font-bold text-xs uppercase tracking-wider text-slate-800 flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <Award className="w-4 h-4 text-emerald-400" />
              <span>{i18n.t('achievements')}</span>
            </button>
          </div>
        </div>
      ) : (
        /* 50 Levels Selector Grid */
        <div className="max-w-4xl mx-auto w-full bg-white/90 border border-slate-300 rounded-2xl p-4 md:p-6 shadow-2xl my-auto max-h-[75vh] flex flex-col">
          <div className="flex justify-between items-center mb-4">
            <button
              onClick={() => setShowLevelSelect(false)}
              className="flex items-center gap-1.5 text-xs font-orbitron font-bold text-slate-700 hover:text-slate-900 bg-slate-200 px-3 py-1.5 rounded-lg cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>{i18n.t('back')}</span>
            </button>

            <h3 className="font-orbitron font-bold text-sm text-teal-700 uppercase tracking-wider">
              {i18n.t('levelSelect')} (50 Уровней • 5 Боссов)
            </h3>
          </div>

          <div className="grid grid-cols-5 sm:grid-cols-10 gap-2 overflow-y-auto p-1 flex-1">
            {Array.from({ length: 50 }, (_, i) => i + 1).map((lvl) => {
              const isUnlocked = lvl <= state.maxUnlockedLevel;
              const isCurrent = lvl === state.currentLevel;
              const isBoss = lvl % 10 === 0;
              const stars = state.levelStars[lvl] || 0;

              return (
                <button
                  key={lvl}
                  disabled={!isUnlocked}
                  onClick={() => handleSelectLevel(lvl)}
                  className={`relative p-2 rounded-xl border flex flex-col items-center justify-center transition-all aspect-square cursor-pointer ${
                    isCurrent
                      ? 'bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500 text-zinc-950 border-amber-300 font-extrabold shadow-lg shadow-amber-500/40 scale-105'
                      : isUnlocked
                      ? isBoss
                        ? 'bg-red-950/80 border-red-500/60 text-red-300 hover:bg-red-900/80'
                        : 'bg-slate-100/80 border-slate-300 text-slate-800 hover:border-slate-400'
                      : 'bg-slate-100/40 border-slate-300 text-slate-600 cursor-not-allowed opacity-60'
                  }`}
                >
                  {isBoss && isUnlocked && (
                    <Skull className="w-3.5 h-3.5 text-red-400 absolute top-1 right-1" />
                  )}

                  {!isUnlocked ? (
                    <Lock className="w-3.5 h-3.5" />
                  ) : (
                    <>
                      <span className="font-orbitron font-bold text-xs">{lvl}</span>
                      {stars > 0 && (
                        <div className="flex gap-0.5 mt-1">
                          {Array.from({ length: stars }).map((_, s) => (
                            <Star key={s} className="w-2 h-2 text-amber-400 fill-amber-400" />
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer controls hint */}
      <div className="text-center text-xs text-slate-600 font-sans tracking-wide">
        <span>Управление: Мышь/Свайпы для маневров • Клавиши 1-4 для смены формаций • ПРОБЕЛ для Гипер-режима</span>
      </div>
    </div>

  );
};
