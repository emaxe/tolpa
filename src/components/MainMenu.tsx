import React, { useState } from 'react';
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
    <div className="absolute inset-0 z-20 flex flex-col justify-between p-4 md:p-8 bg-gradient-to-b from-slate-950/90 via-slate-950/75 to-slate-950/95 select-none overflow-y-auto">
      {/* Top Bar: Currencies & Quick settings */}
      <div className="flex justify-between items-center max-w-5xl mx-auto w-full">
        {/* Currencies */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-900/90 border border-amber-500/40 px-3.5 py-1.5 rounded-full shadow-lg text-amber-400 font-orbitron font-bold text-xs md:text-sm">
            <Coins className="w-4 h-4 text-amber-400" />
            <span>{state.coins.toLocaleString()}</span>
          </div>

          <div className="flex items-center gap-2 bg-slate-900/90 border border-purple-500/40 px-3.5 py-1.5 rounded-full shadow-lg text-purple-400 font-orbitron font-bold text-xs md:text-sm">
            <Gem className="w-4 h-4 text-purple-400" />
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
            className="p-2.5 bg-slate-900/80 hover:bg-slate-800 border border-slate-700 rounded-xl text-slate-300 hover:text-white transition-all shadow cursor-pointer"
            title={i18n.t('loreGuide')}
          >
            <BookOpen className="w-4 h-4" />
          </button>

          <button
            onClick={() => {
              soundEngine.playSound('button_click');
              onOpenTests();
            }}
            className="p-2.5 bg-slate-900/80 hover:bg-slate-800 border border-emerald-500/40 text-emerald-400 hover:text-emerald-300 rounded-xl transition-all shadow cursor-pointer"
            title={i18n.t('testSuite')}
          >
            <FileCode className="w-4 h-4" />
          </button>

          <button
            onClick={() => {
              soundEngine.playSound('button_click');
              onOpenSettings();
            }}
            className="p-2.5 bg-slate-900/80 hover:bg-slate-800 border border-slate-700 rounded-xl text-slate-300 hover:text-white transition-all shadow cursor-pointer"
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
            <div className="inline-block px-3 py-1 bg-cyan-950/80 border border-cyan-500/50 rounded-full text-[11px] font-orbitron font-bold text-cyan-300 uppercase tracking-widest mb-3">
              3D Crowd Tactical Runner
            </div>
            <h1 className="font-orbitron font-black text-4xl md:text-5xl text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-sky-200 to-blue-500 drop-shadow-[0_0_25px_rgba(6,182,212,0.6)] tracking-wider">
              {i18n.t('gameTitle')}
            </h1>
            <p className="text-slate-400 text-xs md:text-sm font-sans tracking-wide mt-2">
              {i18n.t('gameSubtitle')}
            </p>
          </div>

          {/* Large PLAY Button */}
          <button
            onClick={handleStartCurrent}
            className="w-full py-4 md:py-5 bg-gradient-to-r from-cyan-500 via-cyan-400 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-orbitron font-black text-lg md:text-xl uppercase tracking-widest rounded-2xl shadow-2xl shadow-cyan-500/40 transition-all transform hover:scale-105 active:scale-95 flex items-center justify-center gap-3 mb-4 cursor-pointer"
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
              className="py-3 bg-slate-900/90 hover:bg-slate-800 border border-slate-700 rounded-xl font-orbitron font-bold text-xs uppercase tracking-wider text-slate-200 flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <Grid className="w-4 h-4 text-cyan-400" />
              <span>{i18n.t('levelSelect')} (50)</span>
            </button>

            <button
              onClick={() => {
                soundEngine.playSound('button_click');
                onPlayEndless();
              }}
              className="py-3 bg-slate-900/90 hover:bg-slate-800 border border-purple-500/40 rounded-xl font-orbitron font-bold text-xs uppercase tracking-wider text-purple-300 flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <InfinityIcon className="w-4 h-4 text-purple-400" />
              <span>{i18n.t('endlessMode')}</span>
              {state.endlessHighScore > 0 && (
                <span className="text-[9px] text-purple-400/70">
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
              className="py-3 bg-slate-900/90 hover:bg-slate-800 border border-slate-700 rounded-xl font-orbitron font-bold text-xs uppercase tracking-wider text-slate-200 flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <ShoppingCart className="w-4 h-4 text-amber-400" />
              <span>{i18n.t('shop')}</span>
            </button>

            <button
              onClick={() => {
                soundEngine.playSound('button_click');
                onOpenAchievements();
              }}
              className="py-3 bg-slate-900/90 hover:bg-slate-800 border border-slate-700 rounded-xl font-orbitron font-bold text-xs uppercase tracking-wider text-slate-200 flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <Award className="w-4 h-4 text-emerald-400" />
              <span>{i18n.t('achievements')}</span>
            </button>
          </div>
        </div>
      ) : (
        /* 50 Levels Selector Grid */
        <div className="max-w-4xl mx-auto w-full bg-slate-900/90 border border-slate-700 rounded-2xl p-4 md:p-6 shadow-2xl my-auto max-h-[75vh] flex flex-col">
          <div className="flex justify-between items-center mb-4">
            <button
              onClick={() => setShowLevelSelect(false)}
              className="flex items-center gap-1.5 text-xs font-orbitron font-bold text-slate-300 hover:text-white bg-slate-800 px-3 py-1.5 rounded-lg cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>{i18n.t('back')}</span>
            </button>

            <h3 className="font-orbitron font-bold text-sm text-cyan-400 uppercase tracking-wider">
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
                      ? 'bg-cyan-500 text-slate-950 border-cyan-300 font-extrabold shadow-lg shadow-cyan-500/50 scale-105'
                      : isUnlocked
                      ? isBoss
                        ? 'bg-red-950/80 border-red-500/60 text-red-300 hover:bg-red-900/80'
                        : 'bg-slate-950/80 border-slate-800 text-slate-200 hover:border-slate-600'
                      : 'bg-slate-950/40 border-slate-900 text-slate-600 cursor-not-allowed opacity-60'
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
      <div className="text-center text-xs text-slate-400 font-sans tracking-wide">
        <span>Управление: Мышь/Свайпы для маневров • Клавиши 1-4 для смены формаций • ПРОБЕЛ для Гипер-режима</span>
      </div>
    </div>
  );
};
