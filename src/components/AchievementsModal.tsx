import React from 'react';
import { INITIAL_ACHIEVEMENTS, stateManager } from '../core/StateManager';
import { i18n } from '../core/Localization';
import { soundEngine } from '../audio/SoundEngine';
import { X, Award, Coins, Gem, Check, Footprints, Users, ShieldAlert, Swords, Crown, Zap, Flame, Hammer, DoorOpen, Trophy } from 'lucide-react';

interface AchievementsModalProps {
  onClose: () => void;
}

export const AchievementsModal: React.FC<AchievementsModalProps> = ({ onClose }) => {
  const state = stateManager.getState();

  const getIcon = (iconName: string) => {
    switch (iconName) {
      case 'Footprints':
        return <Footprints className="w-5 h-5" />;
      case 'Users':
        return <Users className="w-5 h-5" />;
      case 'ShieldAlert':
        return <ShieldAlert className="w-5 h-5" />;
      case 'Swords':
        return <Swords className="w-5 h-5" />;
      case 'Crown':
        return <Crown className="w-5 h-5" />;
      case 'Zap':
        return <Zap className="w-5 h-5" />;
      case 'Flame':
        return <Flame className="w-5 h-5" />;
      case 'Hammer':
        return <Hammer className="w-5 h-5" />;
      case 'DoorOpen':
        return <DoorOpen className="w-5 h-5" />;
      case 'Trophy':
        return <Trophy className="w-5 h-5" />;
      case 'Gem':
        return <Gem className="w-5 h-5" />;
      case 'Coins':
      default:
        return <Coins className="w-5 h-5" />;
    }
  };

  const handleClaim = (id: string) => {
    const success = stateManager.claimAchievement(id);
    if (success) {
      soundEngine.playSound('upgrade_buy');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-md select-none animate-fade-in">
      <div className="w-full max-w-xl bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 bg-zinc-950/70 border-b border-zinc-800 flex justify-between items-center">
          <h2 className="font-orbitron font-extrabold text-lg text-white tracking-wider flex items-center gap-2">
            <Award className="w-5 h-5 text-amber-400" />
            <span>{i18n.t('achievTitle')}</span>
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* List */}
        <div className="p-4 overflow-y-auto space-y-3">
          {INITIAL_ACHIEVEMENTS.map((ach) => {
            const userAch = state.achievements[ach.id] || { progress: 0, claimed: false };
            const isCompleted = userAch.progress >= ach.goal;
            const isClaimed = userAch.claimed;
            const progressPercent = Math.min(100, Math.round((userAch.progress / ach.goal) * 100));

            return (
              <div
                key={ach.id}
                className={`p-3.5 rounded-xl border flex items-center justify-between gap-4 transition-all ${
                  isClaimed
                    ? 'bg-zinc-950/40 border-zinc-800/60 opacity-60'
                    : isCompleted
                    ? 'bg-zinc-900/90 border-amber-500/60 shadow-lg shadow-amber-950/40'
                    : 'bg-zinc-950/60 border-zinc-800'
                }`}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div
                    className={`p-2.5 rounded-xl border shrink-0 ${
                      isCompleted
                        ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                        : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                    }`}
                  >
                    {getIcon(ach.icon)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-orbitron font-bold text-sm text-white truncate">
                      {i18n.t(ach.titleKey)}
                    </h4>
                    <p className="text-xs text-zinc-400 truncate mt-0.5">
                      {i18n.t(ach.descKey)}
                    </p>

                    {/* Progress Bar */}
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-teal-400 to-amber-400 transition-all duration-300"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-zinc-400 shrink-0">
                        {userAch.progress}/{ach.goal}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Reward / Claim */}
                <div className="shrink-0">
                  {isClaimed ? (
                    <div className="flex items-center gap-1 text-xs font-orbitron text-emerald-400 font-bold px-3 py-1.5 bg-emerald-950/40 rounded-xl border border-emerald-800/40">
                      <Check className="w-4 h-4" />
                      <span>{i18n.t('claimed')}</span>
                    </div>
                  ) : isCompleted ? (
                    <button
                      onClick={() => handleClaim(ach.id)}
                      className="px-4 py-2 bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-zinc-950 font-orbitron font-extrabold text-xs uppercase tracking-wider rounded-xl shadow-lg shadow-amber-500/40 animate-bounce cursor-pointer active:scale-95"
                    >
                      {i18n.t('claim')}
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 text-xs font-orbitron font-semibold text-zinc-400">
                      <span className="flex items-center gap-1 text-amber-400">
                        <Coins className="w-3.5 h-3.5" />
                        {ach.rewardCoins}
                      </span>
                      {ach.rewardGems > 0 && (
                        <span className="flex items-center gap-1 text-rose-400">
                          <Gem className="w-3.5 h-3.5" />
                          {ach.rewardGems}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
