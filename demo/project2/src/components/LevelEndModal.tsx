import React from 'react';
import { i18n } from '../core/Localization';
import { Trophy, Skull, Star, Coins, Gem, ArrowRight, RotateCcw, Home, ShoppingCart } from 'lucide-react';

interface LevelEndModalProps {
  isVictory: boolean;
  levelNumber: number;
  score: number;
  multiplier: number;
  crowdCount: number;
  stars: number;
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
  onNextLevel,
  onRetry,
  onHome,
  onOpenShop,
}) => {
  const coinsEarned = isVictory ? Math.round(score * 0.5) : 25;
  const gemsEarned = isVictory && levelNumber % 10 === 0 ? 10 : isVictory ? 2 : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md select-none animate-fade-in">
      <div
        className={`w-full max-w-md bg-slate-900 rounded-3xl shadow-2xl p-6 border-2 text-center relative overflow-hidden ${
          isVictory
            ? 'border-cyan-500/80 shadow-cyan-950/80'
            : 'border-red-500/80 shadow-red-950/80'
        }`}
      >
        {/* Glow Header */}
        <div className="flex flex-col items-center mb-4">
          <div
            className={`w-20 h-20 rounded-2xl flex items-center justify-center mb-3 shadow-xl ${
              isVictory
                ? 'bg-gradient-to-tr from-cyan-600 to-emerald-400 text-slate-950 animate-bounce'
                : 'bg-gradient-to-tr from-red-600 to-rose-950 text-white'
            }`}
          >
            {isVictory ? <Trophy className="w-10 h-10 fill-current" /> : <Skull className="w-10 h-10" />}
          </div>

          <h2
            className={`font-orbitron font-extrabold text-2xl md:text-3xl tracking-wider ${
              isVictory ? 'text-cyan-400' : 'text-red-400'
            }`}
          >
            {isVictory ? i18n.t('victory') : i18n.t('defeat')}
          </h2>
          <p className="text-xs text-slate-400 font-orbitron mt-1">
            {isVictory ? `${i18n.t('levelCompleted')} (${levelNumber})` : i18n.t('crowdDepleted')}
          </p>
        </div>

        {/* Stars Rating (If Victory) */}
        {isVictory && (
          <div className="flex justify-center gap-2 mb-4">
            {[1, 2, 3].map((starIdx) => (
              <Star
                key={starIdx}
                className={`w-8 h-8 transition-all ${
                  starIdx <= stars
                    ? 'text-amber-400 fill-amber-400 scale-110 drop-shadow-[0_0_8px_rgba(251,191,36,0.6)]'
                    : 'text-slate-700'
                }`}
              />
            ))}
          </div>
        )}

        {/* Score and Multiplier stats */}
        <div className="bg-slate-950/80 rounded-2xl p-4 border border-slate-800 space-y-2.5 mb-5 text-sm">
          {isVictory && (
            <>
              <div className="flex justify-between items-center text-slate-300">
                <span className="font-orbitron text-xs">{i18n.t('wallMultiplier')}</span>
                <span className="font-orbitron font-bold text-amber-400">×{multiplier.toFixed(1)}</span>
              </div>
              <div className="flex justify-between items-center text-slate-300">
                <span className="font-orbitron text-xs">{i18n.t('crowd')}</span>
                <span className="font-orbitron font-bold text-cyan-400">{crowdCount}</span>
              </div>
            </>
          )}

          <div className="flex justify-between items-center pt-2 border-t border-slate-800/80">
            <span className="font-orbitron font-bold text-xs text-slate-400">{i18n.t('totalReward')}</span>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 font-orbitron font-bold text-amber-400 text-sm">
                <Coins className="w-4 h-4" />
                <span>+{coinsEarned.toLocaleString()}</span>
              </div>
              {gemsEarned > 0 && (
                <div className="flex items-center gap-1 font-orbitron font-bold text-purple-400 text-sm">
                  <Gem className="w-4 h-4" />
                  <span>+{gemsEarned}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-2.5">
          {isVictory ? (
            <button
              onClick={onNextLevel}
              className="w-full py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-orbitron font-extrabold text-sm uppercase tracking-wider rounded-xl shadow-lg shadow-cyan-600/40 flex items-center justify-center gap-2 cursor-pointer transition-transform active:scale-95"
            >
              <span>{i18n.t('nextLevel')}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={onRetry}
                className="flex-1 py-3 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-orbitron font-extrabold text-xs uppercase tracking-wider rounded-xl shadow-lg flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
              >
                <RotateCcw className="w-4 h-4" />
                <span>{i18n.t('retry')}</span>
              </button>
              <button
                onClick={onOpenShop}
                className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-cyan-400 font-orbitron font-bold text-xs uppercase rounded-xl border border-cyan-500/40 flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
              >
                <ShoppingCart className="w-4 h-4" />
                <span>{i18n.t('upgrades')}</span>
              </button>
            </div>
          )}

          <div className="flex gap-2">
            {isVictory && (
              <button
                onClick={onRetry}
                className="flex-1 py-2 bg-slate-800/80 hover:bg-slate-700 text-slate-300 rounded-xl font-orbitron text-xs flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{i18n.t('retry')}</span>
              </button>
            )}
            <button
              onClick={onHome}
              className="flex-1 py-2 bg-slate-800/80 hover:bg-slate-700 text-slate-300 rounded-xl font-orbitron text-xs flex items-center justify-center gap-1.5 cursor-pointer"
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
