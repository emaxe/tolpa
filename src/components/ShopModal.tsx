import React, { useState } from 'react';
import { PlayerUpgrades } from '../types/game';
import { stateManager, INITIAL_SKINS } from '../core/StateManager';
import { i18n } from '../core/Localization';
import { soundEngine } from '../audio/SoundEngine';
import { X, Sparkles, ShieldCheck, Zap, Coins, Gem, Users, TrendingUp, Check, Lock } from 'lucide-react';

interface ShopModalProps {
  onClose: () => void;
}

export const ShopModal: React.FC<ShopModalProps> = ({ onClose }) => {
  const [tab, setTab] = useState<'upgrades' | 'skins'>('upgrades');
  const state = stateManager.getState();

  const upgradeList: {
    key: keyof PlayerUpgrades;
    titleKey: string;
    descKey: string;
    icon: any;
    maxLvl: number;
  }[] = [
    {
      key: 'startingMobs',
      titleKey: 'upgStartingMobs',
      descKey: 'upgStartingMobsDesc',
      icon: Users,
      maxLvl: 10,
    },
    {
      key: 'incomeMultiplier',
      titleKey: 'upgIncome',
      descKey: 'upgIncomeDesc',
      icon: TrendingUp,
      maxLvl: 10,
    },
    {
      key: 'adrenalineDuration',
      titleKey: 'upgAdrenaline',
      descKey: 'upgAdrenalineDesc',
      icon: Zap,
      maxLvl: 10,
    },
    {
      key: 'tankSpawnChance',
      titleKey: 'upgTankSpawn',
      descKey: 'upgTankSpawnDesc',
      icon: ShieldCheck,
      maxLvl: 5,
    },
    {
      key: 'ninjaSpawnChance',
      titleKey: 'upgNinjaSpawn',
      descKey: 'upgNinjaSpawnDesc',
      icon: Sparkles,
      maxLvl: 5,
    },
    {
      key: 'mageSpawnChance',
      titleKey: 'upgMageSpawn',
      descKey: 'upgMageSpawnDesc',
      icon: Sparkles,
      maxLvl: 5,
    },
    {
      key: 'defenseAura',
      titleKey: 'upgDefenseAura',
      descKey: 'upgDefenseAuraDesc',
      icon: ShieldCheck,
      maxLvl: 5,
    },
  ];

  const handleUpgrade = (key: keyof PlayerUpgrades) => {
    const success = stateManager.upgradeStat(key);
    if (success) {
      soundEngine.playSound('upgrade_buy');
    }
  };

  const handleSkinAction = (skinId: string, cost: number, currency: 'coins' | 'gems') => {
    if (state.unlockedSkins.includes(skinId)) {
      stateManager.equipSkin(skinId);
      soundEngine.playSound('button_click');
    } else {
      const unlocked = stateManager.unlockSkin(skinId, cost, currency);
      if (unlocked) {
        stateManager.equipSkin(skinId);
        soundEngine.playSound('upgrade_buy');
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md select-none animate-fade-in">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-4 bg-slate-950/70 border-b border-slate-800 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <h2 className="font-orbitron font-extrabold text-lg text-white tracking-wider flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-cyan-400" />
              <span>{i18n.t('shop')}</span>
            </h2>

            {/* Currencies */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 bg-slate-900 px-3 py-1 rounded-full border border-amber-500/40 text-xs font-orbitron font-bold text-amber-400">
                <Coins className="w-4 h-4 text-amber-400" />
                <span>{state.coins.toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-1.5 bg-slate-900 px-3 py-1 rounded-full border border-purple-500/40 text-xs font-orbitron font-bold text-purple-400">
                <Gem className="w-4 h-4 text-purple-400" />
                <span>{state.gems.toLocaleString()}</span>
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="grid grid-cols-2 p-2 bg-slate-950/40 gap-2 border-b border-slate-800">
          <button
            onClick={() => setTab('upgrades')}
            className={`py-2.5 rounded-xl font-orbitron font-bold text-xs uppercase tracking-wider transition-all cursor-pointer ${
              tab === 'upgrades'
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/30'
                : 'bg-slate-900 text-slate-400 hover:text-white'
            }`}
          >
            {i18n.t('upgrades')}
          </button>
          <button
            onClick={() => setTab('skins')}
            className={`py-2.5 rounded-xl font-orbitron font-bold text-xs uppercase tracking-wider transition-all cursor-pointer ${
              tab === 'skins'
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/30'
                : 'bg-slate-900 text-slate-400 hover:text-white'
            }`}
          >
            {i18n.t('skins')}
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-4 overflow-y-auto flex-1 space-y-3">
          {tab === 'upgrades' ? (
            upgradeList.map((item) => {
              const currentLvl = state.upgrades[item.key] || 0;
              const isMax = currentLvl >= item.maxLvl;
              const cost = stateManager.getUpgradeCost(item.key);
              const canAfford = state.coins >= cost;
              const Icon = item.icon;

              return (
                <div
                  key={item.key}
                  className="bg-slate-950/60 border border-slate-800 hover:border-slate-700 rounded-xl p-3.5 flex items-center justify-between gap-4 transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-slate-900 rounded-xl border border-cyan-500/30 text-cyan-400 shrink-0">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-orbitron font-bold text-sm text-white">
                          {i18n.t(item.titleKey)}
                        </h4>
                        <span className="text-[11px] font-orbitron text-cyan-400 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800/60">
                          LVL {currentLvl}/{item.maxLvl}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {i18n.t(item.descKey)}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => handleUpgrade(item.key)}
                    disabled={isMax || !canAfford}
                    className={`px-4 py-2 rounded-xl font-orbitron font-bold text-xs uppercase tracking-wider shrink-0 transition-all flex items-center gap-1.5 cursor-pointer ${
                      isMax
                        ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        : canAfford
                        ? 'bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-slate-950 shadow-lg shadow-amber-500/30 active:scale-95'
                        : 'bg-slate-800 text-slate-400 opacity-60 cursor-not-allowed'
                    }`}
                  >
                    {isMax ? (
                      <span>MAX</span>
                    ) : (
                      <>
                        <Coins className="w-4 h-4" />
                        <span>{cost.toLocaleString()}</span>
                      </>
                    )}
                  </button>
                </div>
              );
            })
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {INITIAL_SKINS.map((skin) => {
                const isUnlocked = state.unlockedSkins.includes(skin.id);
                const isEquipped = state.equippedSkin === skin.id;
                const isRewardSkin = !!skin.reward && skin.reward !== 'shop';
                const canAfford =
                  skin.currency === 'coins' ? state.coins >= skin.cost : state.gems >= skin.cost;

                return (
                  <div
                    key={skin.id}
                    className={`bg-slate-950/70 border rounded-xl p-4 flex flex-col justify-between transition-all ${
                      isEquipped
                        ? 'border-cyan-400 shadow-lg shadow-cyan-950/50'
                        : 'border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <div
                        className="w-10 h-10 rounded-xl border-2 shadow-md flex items-center justify-center font-orbitron font-bold text-slate-950"
                        style={{ backgroundColor: skin.colorHex, borderColor: skin.emissiveHex }}
                      >
                        ●
                      </div>
                      <div>
                        <h4 className="font-orbitron font-bold text-sm text-white">
                          {i18n.t(skin.nameKey, skin.id.replace('_', ' ').toUpperCase())}
                        </h4>
                        <span className="text-[11px] text-slate-400 uppercase tracking-wider">
                          {i18n.t(skin.descKey, '')}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleSkinAction(skin.id, skin.cost, skin.currency)}
                      disabled={!isUnlocked && (isRewardSkin || !canAfford)}
                      className={`w-full py-2 rounded-xl font-orbitron font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                        isEquipped
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50'
                          : isUnlocked
                          ? 'bg-slate-800 hover:bg-slate-700 text-white'
                          : isRewardSkin
                          ? 'bg-slate-800/60 text-slate-500 cursor-not-allowed'
                          : canAfford
                          ? 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg'
                          : 'bg-slate-800/60 text-slate-500 cursor-not-allowed'
                      }`}
                    >
                      {isEquipped ? (
                        <>
                          <Check className="w-4 h-4" />
                          <span>{i18n.t('equipped')}</span>
                        </>
                      ) : isUnlocked ? (
                        <span>{i18n.t('equip')}</span>
                      ) : isRewardSkin ? (
                        <>
                          <Lock className="w-3.5 h-3.5" />
                          <span>{i18n.t(skin.reward === 'level' ? 'skinRewardLevel' : 'skinRewardAchievement')}</span>
                        </>
                      ) : (
                        <>
                          <Lock className="w-3.5 h-3.5" />
                          {skin.currency === 'coins' ? (
                            <span className="flex items-center gap-1">
                              <Coins className="w-3.5 h-3.5 text-amber-400" />
                              {skin.cost.toLocaleString()}
                            </span>
                          ) : (
                            <span className="flex items-center gap-1">
                              <Gem className="w-3.5 h-3.5 text-purple-400" />
                              {skin.cost}
                            </span>
                          )}
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
