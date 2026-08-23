import React from 'react';
import { i18n } from '../core/Localization';
import { RunStats } from '../core/StateManager';
import { Trophy, Skull, Star, Coins, Gem, ArrowRight, RotateCcw, Home, ShoppingCart, Zap, Users, Shield, Swords, DoorOpen, Route, Trophy as RecordIcon } from 'lucide-react';

interface LevelEndModalProps {
  isVictory: boolean;
  levelNumber: number;
  score: number;
  multiplier: number;
  crowdCount: number;
  stars: number;
  runStats: RunStats | null;
  isEndless?: boolean;
  endless?: { distance: number; isNewRecord: boolean; coinsEarned: number };
  onNextLevel: () => void;
  onRetry: () => void;
  onHome: () => void;
  onOpenShop: () => void;
}

export const LevelEndModal: React.FC<LevelEndModalProps> = ({
  isVictory,
  levelNumber,
  score,
  multiplier,
  crowdCount,
  stars,
  runStats,
  isEndless = false,
  endless,
  onNextLevel,
  onRetry,
  onHome,
  onOpenShop,
}) => {
  const coinsEarned = isVictory ? Math.round(score * 0.5) : 25;
  const gemsEarned = isVictory && levelNumber % 10 === 0 ? 10 : isVictory ? 2 : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/85 backdrop-blur-md select-none animate-fade-in">
      <div
        className={`w-full max-w-md bg-zinc-900 rounded-3xl shadow-2xl p-6 border-2 text-center relative overflow-hidden ${
          isVictory
            ? 'border-amber-400/80 shadow-amber-950/60'
            : 'border-red-500/80 shadow-red-950/80'
        }`}
      >
        {/* Glow Header */}
        <div className="flex flex-col items-center mb-4">
          <div
            className={`w-20 h-20 rounded-2xl flex items-center justify-center mb-3 shadow-xl ${
              isVictory
                ? 'bg-gradient-to-tr from-amber-400 via-orange-400 to-yellow-300 text-zinc-950 animate-bounce'
                : 'bg-gradient-to-tr from-red-600 to-rose-950 text-white'
            }`}
          >
            {isVictory ? <Trophy className="w-10 h-10 fill-current" /> : <Skull className="w-10 h-10" />}
          </div>

          <h2
            className={`font-orbitron font-extrabold text-2xl md:text-3xl tracking-wider ${
              isEndless ? 'text-teal-300' : isVictory ? 'text-amber-400' : 'text-red-400'
            }`}
          >
            {isEndless ? i18n.t('endlessRunOver') : isVictory ? i18n.t('victory') : i18n.t('defeat')}
          </h2>
          <p className="text-xs text-zinc-400 font-orbitron mt-1">
            {isEndless
              ? `${endless?.distance?.toLocaleString() ?? 0} м`
              : isVictory
              ? `${i18n.t('levelCompleted')} (${levelNumber})`
              : i18n.t('crowdDepleted')}
          </p>
        </div>

        {/* Endless: бейдж нового рекорда */}
        {isEndless && endless?.isNewRecord && (
          <div className="flex items-center justify-center gap-2 mb-4 text-amber-400 font-orbitron font-extrabold text-sm tracking-wider animate-pulse">
            <RecordIcon className="w-5 h-5 fill-current" />
            {i18n.t('newRecord')}
          </div>
        )}

        {/* Stars Rating (If Victory, not endless) */}
        {isVictory && !isEndless && (
          <div className="flex justify-center gap-2 mb-4">
            {[1, 2, 3].map((starIdx) => (
              <Star
                key={starIdx}
                className={`w-8 h-8 transition-all ${
                  starIdx <= stars
                    ? 'text-amber-400 fill-amber-400 scale-110 drop-shadow-[0_0_8px_rgba(251,191,36,0.6)]'
                    : 'text-zinc-700'
                }`}
              />
            ))}
          </div>
        )}

        {/* Score and Multiplier stats */}
        <div className="bg-zinc-950/80 rounded-2xl p-4 border border-zinc-800 space-y-2.5 mb-5 text-sm">
          {isVictory && !isEndless && (
            <>
              <div className="flex justify-between items-center text-zinc-300">
                <span className="font-orbitron text-xs">{i18n.t('wallMultiplier')}</span>
                <span className="font-orbitron font-bold text-amber-400">×{multiplier.toFixed(1)}</span>
              </div>
              <div className="flex justify-between items-center text-zinc-300">
                <span className="font-orbitron text-xs">{i18n.t('crowd')}</span>
                <span className="font-orbitron font-bold text-teal-300">{crowdCount}</span>
              </div>
            </>
          )}

          {/* Endless: дистанция забега как главная метрика */}
          {isEndless && (
            <div className="flex justify-between items-center text-zinc-300">
              <span className="flex items-center gap-1.5 font-orbitron text-xs text-zinc-400">
                <Route className="w-4 h-4 text-teal-300" /> {i18n.t('endlessDistance')}
              </span>
              <span className="font-orbitron font-bold text-teal-300">
                {endless?.distance?.toLocaleString() ?? 0} м
              </span>
            </div>
          )}

          {/* Run-detail stats (макс. комбо, макс. толпа, сломанные препятствия, ворота, боссы) */}
          {runStats && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-2 border-t border-zinc-800/80">
              <div className="flex items-center justify-between text-zinc-300">
                <span className="flex items-center gap-1.5 font-orbitron text-[11px] text-zinc-400">
                  <Zap className="w-3.5 h-3.5 text-amber-400" /> {i18n.t('runMaxCombo')}
                </span>
                <span className="font-orbitron font-bold text-amber-400">×{runStats.maxCombo}</span>
              </div>
              <div className="flex items-center justify-between text-zinc-300">
                <span className="flex items-center gap-1.5 font-orbitron text-[11px] text-zinc-400">
                  <Users className="w-3.5 h-3.5 text-teal-300" /> {i18n.t('runMaxCrowd')}
                </span>
                <span className="font-orbitron font-bold text-teal-300">{runStats.maxCrowd}</span>
              </div>
              <div className="flex items-center justify-between text-zinc-300">
                <span className="flex items-center gap-1.5 font-orbitron text-[11px] text-zinc-400">
                  <Swords className="w-3.5 h-3.5 text-red-400" /> {i18n.t('runObstaclesSmashed')}
                </span>
                <span className="font-orbitron font-bold text-red-400">{runStats.obstaclesSmashed}</span>
              </div>
              <div className="flex items-center justify-between text-zinc-300">
                <span className="flex items-center gap-1.5 font-orbitron text-[11px] text-zinc-400">
                  <DoorOpen className="w-3.5 h-3.5 text-emerald-400" /> {i18n.t('runGatesPassed')}
                </span>
                <span className="font-orbitron font-bold text-emerald-400">{runStats.gatesPassed}</span>
              </div>
              {runStats.bossesDefeated > 0 && (
                <div className="flex items-center justify-between text-zinc-300 col-span-2">
                  <span className="flex items-center gap-1.5 font-orbitron text-[11px] text-zinc-400">
                    <Shield className="w-3.5 h-3.5 text-rose-400" /> {i18n.t('runBossesDefeated')}
                  </span>
                  <span className="font-orbitron font-bold text-rose-400">{runStats.bossesDefeated}</span>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between items-center pt-2 border-t border-zinc-800/80">
            <span className="font-orbitron font-bold text-xs text-zinc-400">{i18n.t('totalReward')}</span>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 font-orbitron font-bold text-amber-400 text-sm">
                <Coins className="w-4 h-4" />
                <span>+{(isEndless ? (endless?.coinsEarned ?? 0) : coinsEarned).toLocaleString()}</span>
              </div>
              {!isEndless && gemsEarned > 0 && (
                <div className="flex items-center gap-1 font-orbitron font-bold text-rose-400 text-sm">
                  <Gem className="w-4 h-4" />
                  <span>+{gemsEarned}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-2.5">
          {isVictory && !isEndless ? (
            <button
              onClick={onNextLevel}
              className="w-full py-3 bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500 hover:from-amber-300 hover:to-orange-400 text-zinc-950 font-orbitron font-extrabold text-sm uppercase tracking-wider rounded-xl shadow-lg shadow-amber-500/30 flex items-center justify-center gap-2 cursor-pointer transition-transform active:scale-95"
            >
              <span>{i18n.t('nextLevel')}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={onRetry}
                className="flex-1 py-3 bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500 hover:from-amber-300 hover:to-orange-400 text-zinc-950 font-orbitron font-extrabold text-xs uppercase tracking-wider rounded-xl shadow-lg shadow-amber-500/30 flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
              >
                <RotateCcw className="w-4 h-4" />
                <span>{i18n.t('retry')}</span>
              </button>
              <button
                onClick={onOpenShop}
                className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 text-amber-400 font-orbitron font-bold text-xs uppercase rounded-xl border border-amber-500/40 flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
              >
                <ShoppingCart className="w-4 h-4" />
                <span>{i18n.t('upgrades')}</span>
              </button>
            </div>
          )}

          <div className="flex gap-2">
            {isVictory && !isEndless && (
              <button
                onClick={onRetry}
                className="flex-1 py-2 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 rounded-xl font-orbitron text-xs flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{i18n.t('retry')}</span>
              </button>
            )}
            <button
              onClick={onHome}
              className="flex-1 py-2 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 rounded-xl font-orbitron text-xs flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Home className="w-3.5 h-3.5" />
              <span>{i18n.t('toMenu')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
