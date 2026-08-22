import React, { useState, useEffect } from 'react';
import { FormationType } from '../types/game';
import { i18n } from '../core/Localization';
import { eventBus } from '../core/EventBus';
import { perfMonitor } from '../core/Performance';
import { Zap, Users, Shield, ArrowUp, MoveHorizontal, CircleDot, Pause } from 'lucide-react';

interface HUDProps {
  crowdCount: number;
  levelNumber: number;
  isEndless?: boolean;
  onPause: () => void;
  onFormationChange: (f: FormationType) => void;
  currentFormation: FormationType;
  onActivateAdrenaline: () => void;
  isHyperActive: boolean;
  comboStreak: number;
}

export const HUD: React.FC<HUDProps> = ({
  crowdCount,
  levelNumber,
  isEndless = false,
  onPause,
  onFormationChange,
  currentFormation,
  onActivateAdrenaline,
  isHyperActive,
  comboStreak,
}) => {
  const [fps, setFps] = useState<number>(60);
  const [drawCalls, setDrawCalls] = useState<number>(12);
  const [bossInfo, setBossInfo] = useState<{ hp: number; maxHp: number; nameKey: string } | null>(null);
  const [adrenalineCharge, setAdrenalineCharge] = useState<number>(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFps(perfMonitor.getFPS());
      setDrawCalls(perfMonitor.getDrawCalls());
      // Gradually charge adrenaline over time & gate passes
      setAdrenalineCharge((prev) => Math.min(100, prev + 1.5));
    }, 100);

    const unsubBoss = eventBus.on('bossDamaged', (data) => {
      setBossInfo(data);
    });

    const unsubGate = eventBus.on('gatePassed', (data) => {
      if (data.isPositive) {
        setAdrenalineCharge((prev) => Math.min(100, prev + 15));
      }
    });

    const unsubBossDefeat = eventBus.on('bossDefeated', () => {
      setBossInfo(null);
    });

    return () => {
      clearInterval(timer);
      unsubBoss();
      unsubGate();
      unsubBossDefeat();
    };
  }, []);

  const handleAdrenalineClick = () => {
    if (adrenalineCharge >= 100 || isHyperActive) {
      onActivateAdrenaline();
      setAdrenalineCharge(0);
    }
  };

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-4 select-none">
      {/* Top Header Bar */}
      <div className="flex justify-between items-start">
        {/* Level and Crowd Badge */}
        <div className="flex items-center gap-3">
          <div className="bg-slate-900/80 backdrop-blur-md border border-cyan-500/40 rounded-xl px-4 py-2 shadow-lg shadow-cyan-950/50">
            <span className="text-xs uppercase text-cyan-400 font-orbitron tracking-wider">
              {isEndless ? i18n.t('endlessMode') : `${i18n.t('level')} ${levelNumber}`}
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              <Users className="w-5 h-5 text-cyan-400 animate-pulse" />
              <span className="text-2xl font-bold font-orbitron text-white">
                {crowdCount}
              </span>
            </div>
          </div>

          {/* Combo Multiplier Badge */}
          {comboStreak > 1 && (
            <div className="bg-amber-500/90 text-slate-950 font-orbitron font-extrabold px-3 py-1.5 rounded-lg shadow-lg animate-bounce flex items-center gap-1.5 text-sm">
              <Zap className="w-4 h-4 fill-current" />
              <span>{comboStreak}x {i18n.t('combo')}!</span>
            </div>
          )}
        </div>

        {/* Top Right Controls & Debug info */}
        <div className="flex items-center gap-2">
          {/* Debug performance stats */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-lg px-2.5 py-1 text-[11px] text-slate-400 font-mono flex gap-2">
            <span>FPS: <strong className="text-emerald-400">{fps}</strong></span>
            <span>DC: <strong className="text-cyan-400">{drawCalls}</strong></span>
          </div>

          {/* Pause Button */}
          <button
            onClick={onPause}
            className="pointer-events-auto p-2.5 bg-slate-900/80 hover:bg-slate-800 active:scale-95 border border-slate-700 rounded-xl text-slate-300 hover:text-white transition-all shadow-md cursor-pointer"
          >
            <Pause className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Boss Health Bar if Active */}
      {bossInfo && (
        <div className="w-full max-w-md mx-auto bg-slate-900/90 border-2 border-red-500/80 rounded-xl p-3 shadow-2xl shadow-red-950/80 pointer-events-auto animate-pulse">
          <div className="flex justify-between items-center mb-1 font-orbitron text-xs">
            <span className="text-red-400 font-bold tracking-wider">
              {i18n.t(bossInfo.nameKey, 'BOSS')}
            </span>
            <span className="text-slate-300">
              {Math.max(0, Math.round(bossInfo.hp))} / {bossInfo.maxHp} HP
            </span>
          </div>
          <div className="w-full h-3 bg-slate-950 rounded-full overflow-hidden border border-red-900">
            <div
              className="h-full bg-gradient-to-r from-red-600 via-orange-500 to-yellow-400 transition-all duration-150"
              style={{ width: `${Math.max(0, (bossInfo.hp / bossInfo.maxHp) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Bottom Action Controls */}
      <div className="flex flex-col gap-3 max-w-xl mx-auto w-full">
        {/* Adrenaline Bar & Button */}
        <div className="pointer-events-auto">
          <button
            onClick={handleAdrenalineClick}
            disabled={adrenalineCharge < 100 && !isHyperActive}
            className={`w-full relative overflow-hidden rounded-xl border p-3 font-orbitron font-extrabold uppercase tracking-wider transition-all duration-300 flex items-center justify-between shadow-lg ${
              isHyperActive
                ? 'bg-gradient-to-r from-yellow-500 via-amber-400 to-orange-500 text-slate-950 border-yellow-300 animate-pulse scale-[1.02]'
                : adrenalineCharge >= 100
                ? 'bg-gradient-to-r from-cyan-600 via-cyan-500 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white border-cyan-300 shadow-cyan-500/50 cursor-pointer animate-bounce'
                : 'bg-slate-900/80 text-slate-400 border-slate-700 opacity-90 cursor-not-allowed'
            }`}
          >
            <div className="flex items-center gap-2 relative z-10 text-sm md:text-base">
              <Zap className={`w-5 h-5 ${isHyperActive ? 'fill-slate-950' : 'fill-cyan-400'}`} />
              <span>
                {isHyperActive
                  ? i18n.t('hyperActive')
                  : adrenalineCharge >= 100
                  ? i18n.t('hyperModeReady')
                  : `${i18n.t('adrenaline')} (${Math.round(adrenalineCharge)}%)`}
              </span>
            </div>

            {/* Progress Fill Indicator */}
            {!isHyperActive && (
              <div
                className="absolute inset-0 bg-cyan-500/20 pointer-events-none transition-all duration-200"
                style={{ width: `${adrenalineCharge}%` }}
              />
            )}
          </button>
        </div>

        {/* Formation Switcher Buttons */}
        <div className="pointer-events-auto grid grid-cols-4 gap-2 bg-slate-950/80 backdrop-blur-md p-1.5 rounded-xl border border-slate-800">
          <button
            onClick={() => onFormationChange('wedge')}
            className={`flex flex-col items-center justify-center p-2 rounded-lg text-xs font-semibold font-orbitron transition-all cursor-pointer ${
              currentFormation === 'wedge'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/40'
                : 'bg-slate-900/60 text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title={i18n.t('wedgeDesc')}
          >
            <Shield className="w-4 h-4 mb-0.5" />
            <span className="text-[10px] uppercase">1: {i18n.t('formationWedge').split(' ')[0]}</span>
          </button>

          <button
            onClick={() => onFormationChange('wide')}
            className={`flex flex-col items-center justify-center p-2 rounded-lg text-xs font-semibold font-orbitron transition-all cursor-pointer ${
              currentFormation === 'wide'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/40'
                : 'bg-slate-900/60 text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title={i18n.t('wideDesc')}
          >
            <MoveHorizontal className="w-4 h-4 mb-0.5" />
            <span className="text-[10px] uppercase">2: {i18n.t('formationWide').split(' ')[0]}</span>
          </button>

          <button
            onClick={() => onFormationChange('circle')}
            className={`flex flex-col items-center justify-center p-2 rounded-lg text-xs font-semibold font-orbitron transition-all cursor-pointer ${
              currentFormation === 'circle'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/40'
                : 'bg-slate-900/60 text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title={i18n.t('circleDesc')}
          >
            <CircleDot className="w-4 h-4 mb-0.5" />
            <span className="text-[10px] uppercase">3: {i18n.t('formationCircle').split(' ')[0]}</span>
          </button>

          <button
            onClick={() => onFormationChange('arrow')}
            className={`flex flex-col items-center justify-center p-2 rounded-lg text-xs font-semibold font-orbitron transition-all cursor-pointer ${
              currentFormation === 'arrow'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/40'
                : 'bg-slate-900/60 text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title={i18n.t('arrowDesc')}
          >
            <ArrowUp className="w-4 h-4 mb-0.5" />
            <span className="text-[10px] uppercase">4: {i18n.t('formationArrow').split(' ')[0]}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
