import React, { useState, useEffect } from 'react';
import { FormationType } from '../types/game';
import { i18n } from '../core/Localization';
import { stateManager } from '../core/StateManager';
import { eventBus } from '../core/EventBus';
import { Zap, Users, Coins, Shield, ArrowUp, MoveHorizontal, CircleDot, Pause, Skull, TriangleAlert, Route, Trophy } from 'lucide-react';

interface HUDProps {
  crowdCount: number;
  coinCount: number; // Собранные за текущий забег монеты (живой счётчик)
  levelNumber: number;
  isEndless?: boolean;
  onPause: () => void;
  onFormationChange: (f: FormationType) => void;
  currentFormation: FormationType;
  onActivateAdrenaline: () => void;
  isHyperActive: boolean;
  comboStreak: number;
  // Снимок состояния движка — раньше адреналин заряжался собственным таймером HUD
  // независимо от игры (тикал даже на паузе), а прогресса уровня не было видно вообще.
  adrenalineCharge: number; // 0..100
  progress: number; // 0..1, дистанция до финиша
  metersLeft: number; // -1 в endless
  bossProgress: number; // 0..1, -1 если на уровне нет босса
  bossDistance: number; // метров до арены босса, -1 если на уровне нет босса
  nextHazardDistance: number; // метров до ближайшего препятствия, -1 если нет
  distanceTraveled: number; // метров, пройденных с начала забега (Бесконечный режим)
  fps: number;
  drawCalls: number;
  // Индикатор финишной фазы: текущий множитель, прогресс по стенам, активность финиша.
  finishMultiplier: number;
  finishStepsDone: number;
  finishStepsTotal: number;
  isFinishActive: boolean;
}

export const HUD: React.FC<HUDProps> = ({
  crowdCount,
  coinCount,
  levelNumber,
  isEndless = false,
  onPause,
  onFormationChange,
  currentFormation,
  onActivateAdrenaline,
  isHyperActive,
  comboStreak,
  adrenalineCharge,
  progress,
  metersLeft,
  bossProgress,
  bossDistance,
  nextHazardDistance,
  distanceTraveled,
  fps,
  drawCalls,
  finishMultiplier,
  finishStepsDone,
  finishStepsTotal,
  isFinishActive,
}) => {
  const [bossInfo, setBossInfo] = useState<{ hp: number; maxHp: number; nameKey: string } | null>(null);
  const [damageFlashKey, setDamageFlashKey] = useState<number>(0);
  // Баннер динамического события уровня (ambush/coin_train/emp_storm/meteor_rain/speed_boost)
  const [eventAlert, setEventAlert] = useState<{ type: string; key: number } | null>(null);

  // Маппинг типа события -> ключ локализации и цвет баннера
  const EVENT_ALERT_MAP: Record<string, { key: string; cls: string }> = {
    ambush: { key: 'eventAmbush', cls: 'border-red-500 text-red-300' },
    coin_train: { key: 'eventCoinTrain', cls: 'border-amber-500 text-amber-300' },
    emp_storm: { key: 'eventEmpStorm', cls: 'border-purple-500 text-purple-300' },
    meteor_rain: { key: 'eventMeteorRain', cls: 'border-orange-500 text-orange-300' },
    speed_boost: { key: 'eventSpeedBoost', cls: 'border-cyan-500 text-cyan-300' },
  };

  useEffect(() => {
    const unsubBoss = eventBus.on('bossDamaged', (data) => {
      setBossInfo(data);
    });

    const unsubBossDefeat = eventBus.on('bossDefeated', () => {
      setBossInfo(null);
    });

    const unsubMobsKilled = eventBus.on('mobsKilled', () => {
      // Ключ меняется на каждое событие, даже если предыдущая вспышка ещё не отыграла —
      // React пересоздаёт элемент и анимация запускается заново.
      setDamageFlashKey((k) => k + 1);
    });

    const unsubEvent = eventBus.on('levelEvent', (data: { type?: string }) => {
      if (!data || !data.type) return;
      setEventAlert({ type: data.type, key: Date.now() });
      window.setTimeout(() => setEventAlert(null), 3200);
    });

    return () => {
      unsubBoss();
      unsubBossDefeat();
      unsubMobsKilled();
      unsubEvent();
    };
  }, []);

  const handleAdrenalineClick = () => {
    if (adrenalineCharge >= 100 || isHyperActive) {
      onActivateAdrenaline();
    }
  };

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-4 select-none">
      {/* Красная виньетка при потере бойцов */}
      {damageFlashKey > 0 && (
        <div
          key={damageFlashKey}
          className="absolute inset-0 pointer-events-none animate-damage-flash"
          style={{ boxShadow: 'inset 0 0 140px 40px rgba(239,68,68,0.9)' }}
        />
      )}

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

          {/* Live Run Coins Badge — собранные за забег монеты (сырое значение, без множителя экономики) */}
          <div className="bg-slate-900/80 backdrop-blur-md border border-amber-500/40 rounded-xl px-4 py-2 shadow-lg shadow-amber-950/50">
            <span className="text-xs uppercase text-amber-400 font-orbitron tracking-wider">
              {i18n.t('coins')}
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              <Coins className="w-5 h-5 text-amber-400" />
              <span className="text-2xl font-bold font-orbitron text-amber-300">
                {coinCount.toLocaleString()}
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

      {/* Event Alert Banner (динамическое событие уровня) */}
      {eventAlert && EVENT_ALERT_MAP[eventAlert.type] && (
        <div
          key={eventAlert.key}
          className={`absolute left-1/2 -translate-x-1/2 top-24 z-20 pointer-events-none px-6 py-2 rounded-xl border-2 bg-slate-950/85 backdrop-blur-md font-orbitron font-extrabold text-sm md:text-base tracking-wider animate-pulse shadow-2xl ${EVENT_ALERT_MAP[eventAlert.type].cls}`}
        >
          {i18n.t(EVENT_ALERT_MAP[eventAlert.type].key)}
        </div>
      )}

      {/* Индикатор финишной фазы — появляется после пересечения финишной черты.
          Показывает текущий множитель бонуса и прогресс по стенам замка. */}
      {isFinishActive && !isEndless && (
        <div className="absolute left-1/2 -translate-x-1/2 top-12 z-20 pointer-events-none flex flex-col items-center gap-1">
          <div className="bg-slate-950/90 border-2 border-amber-400/80 rounded-2xl px-5 py-2 shadow-[0_0_25px_rgba(251,191,36,0.5)] backdrop-blur-md flex items-center gap-3">
            <Trophy className="w-5 h-5 text-amber-400 fill-amber-400 animate-bounce" />
            <div className="flex flex-col items-center">
              <span className="text-[10px] uppercase font-orbitron tracking-widest text-amber-300">
                {i18n.t('wallMultiplier')}
              </span>
              <span className="text-2xl font-extrabold font-orbitron text-amber-400 drop-shadow-[0_0_10px_rgba(251,191,36,0.8)]">
                ×{finishMultiplier.toFixed(1)}
              </span>
            </div>
            <span className="text-xs font-orbitron text-slate-400 ml-1">
              {finishStepsDone}/{finishStepsTotal}
            </span>
          </div>
        </div>
      )}

      {/* Progress bar to finish — тонкая полоска в самом верху экрана, не перекрывает
          центр (раньше висела по центру и мешала обзору/свайпам). pointer-events-none. */}
      {!isEndless && (
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-slate-950/80 pointer-events-none">
          <div
            className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-[width] duration-200"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
          {bossProgress >= 0 && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-red-500"
              style={{ left: `${Math.round(bossProgress * 100)}%` }}
              title="Boss"
            />
          )}
        </div>
      )}

      {/* Компактная строка дистанции/босса/препятствия — внизу слева, pointer-events-none,
          чтобы не перехватывать свайпы. На мобильном скрыта (инфа не критична в бою). */}
      {!isEndless && (
        <div className="absolute bottom-24 left-4 max-sm:hidden pointer-events-none flex items-center gap-3">
          {metersLeft >= 0 && (
            <span className="text-[10px] font-orbitron text-slate-400">
              {metersLeft} м до финиша
            </span>
          )}
          {nextHazardDistance >= 0 && nextHazardDistance < 25 && (
            <span className="text-[10px] font-orbitron text-amber-400 flex items-center gap-1 animate-pulse">
              <TriangleAlert className="w-3 h-3" />
              {Math.round(nextHazardDistance)} м
            </span>
          )}
          {!bossInfo && bossDistance >= 0 && bossDistance > 35 && bossDistance <= 400 && (
            <span className="text-[10px] font-orbitron text-red-400 flex items-center gap-1 animate-pulse">
              <Skull className="w-3 h-3" />
              {i18n.t('bossApproach', 'БОСС')} {bossDistance} м
            </span>
          )}
        </div>
      )}

      {/* Бесконечный режим: живой счётчик пройденной дистанции + рекорд.
          В endless нет финиша/босса, поэтому metersLeft/boss скрыты — показываем
          основной core-loop (дистанция) и личный рекорд как цель побить. */}
      {isEndless && (
        <div className="absolute bottom-24 left-4 max-sm:hidden pointer-events-none flex items-center gap-3">
          <span className="text-[11px] font-orbitron text-cyan-400 flex items-center gap-1">
            <Route className="w-3 h-3" />
            {distanceTraveled.toLocaleString()} м
          </span>
          {stateManager.getState().endlessHighScore > 0 && (
            <span className="text-[10px] font-orbitron text-slate-400">
              {i18n.t('endlessRecord')}: {stateManager.getState().endlessHighScore.toLocaleString()} м
            </span>
          )}
        </div>
      )}

      {/* Boss Health Bar if Active */}
      {bossInfo && (
        <div className="w-full max-w-md mx-auto bg-slate-900/90 border-2 border-red-500/80 rounded-xl p-3 shadow-2xl shadow-red-950/80 pointer-events-auto animate-pulse">
          <div className="flex justify-between items-center mb-1 font-orbitron text-xs">
            <span className="text-red-400 font-bold tracking-wider flex items-center gap-1">
              <Skull className="w-3.5 h-3.5" />
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

      {/* Bottom Action Controls.
          Десктоп: широкая панель по центру низа (адреналин + 4 формации).
          Мобильный (max-sm): компактные кнопки по УГЛАМ — адреналин справа внизу,
          формации вертикальной колонкой слева внизу. Центр экрана полностью свободен
          (pointer-events-none), чтобы свайпы влево-вправо шли на canvas, а не на кнопки. */}
      <div className="flex flex-col gap-3 max-w-xl mx-auto w-full max-sm:flex-row max-sm:max-w-none max-sm:justify-between max-sm:items-end max-sm:gap-0 max-sm:px-3 max-sm:pb-2">
        {/* Adrenaline Bar & Button */}
        <div className="pointer-events-auto max-sm:order-2">
          <button
            onClick={handleAdrenalineClick}
            disabled={adrenalineCharge < 100 && !isHyperActive}
            className={`relative overflow-hidden rounded-xl border font-orbitron font-extrabold uppercase tracking-wider transition-all duration-300 flex items-center justify-between shadow-lg ${
              isHyperActive
                ? 'bg-gradient-to-r from-yellow-500 via-amber-400 to-orange-500 text-slate-950 border-yellow-300 animate-pulse scale-[1.02]'
                : adrenalineCharge >= 100
                ? 'bg-gradient-to-r from-cyan-600 via-cyan-500 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white border-cyan-300 shadow-cyan-500/50 cursor-pointer animate-bounce'
                : 'bg-slate-900/80 text-slate-400 border-slate-700 opacity-90 cursor-not-allowed'
            } w-full p-3 max-sm:w-16 max-sm:h-16 max-sm:p-0 max-sm:justify-center max-sm:rounded-full max-sm:border-2`}
          >
            <div className="flex items-center gap-2 relative z-10 text-sm md:text-base max-sm:hidden">
              <Zap className={`w-5 h-5 ${isHyperActive ? 'fill-slate-950' : 'fill-cyan-400'}`} />
              <span>
                {isHyperActive
                  ? i18n.t('hyperActive')
                  : adrenalineCharge >= 100
                  ? i18n.t('hyperModeReady')
                  : `${i18n.t('adrenaline')} (${Math.round(adrenalineCharge)}%)`}
              </span>
            </div>
            {/* Мобильная иконка-молния */}
            <Zap className={`w-7 h-7 max-sm:block hidden ${isHyperActive ? 'fill-slate-950' : 'fill-cyan-400'}`} />

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
        <div className="pointer-events-auto grid grid-cols-4 gap-2 bg-slate-950/80 backdrop-blur-md p-1.5 rounded-xl border border-slate-800 max-sm:order-1 max-sm:grid-cols-1 max-sm:gap-1 max-sm:p-1 max-sm:rounded-2xl">
          <button
            onClick={() => onFormationChange('wedge')}
            className={`flex flex-col items-center justify-center p-2 rounded-lg text-xs font-semibold font-orbitron transition-all cursor-pointer max-sm:p-1.5 max-sm:rounded-xl ${
              currentFormation === 'wedge'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/40'
                : 'bg-slate-900/60 text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title={i18n.t('wedgeDesc')}
          >
            <Shield className="w-4 h-4 mb-0.5 max-sm:mb-0 max-sm:w-5 max-sm:h-5" />
            <span className="text-[10px] uppercase max-sm:hidden">1: {i18n.t('formationWedge').split(' ')[0]}</span>
          </button>

          <button
            onClick={() => onFormationChange('wide')}
            className={`flex flex-col items-center justify-center p-2 rounded-lg text-xs font-semibold font-orbitron transition-all cursor-pointer max-sm:p-1.5 max-sm:rounded-xl ${
              currentFormation === 'wide'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/40'
                : 'bg-slate-900/60 text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title={i18n.t('wideDesc')}
          >
            <MoveHorizontal className="w-4 h-4 mb-0.5 max-sm:mb-0 max-sm:w-5 max-sm:h-5" />
            <span className="text-[10px] uppercase max-sm:hidden">2: {i18n.t('formationWide').split(' ')[0]}</span>
          </button>

          <button
            onClick={() => onFormationChange('circle')}
            className={`flex flex-col items-center justify-center p-2 rounded-lg text-xs font-semibold font-orbitron transition-all cursor-pointer max-sm:p-1.5 max-sm:rounded-xl ${
              currentFormation === 'circle'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/40'
                : 'bg-slate-900/60 text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title={i18n.t('circleDesc')}
          >
            <CircleDot className="w-4 h-4 mb-0.5 max-sm:mb-0 max-sm:w-5 max-sm:h-5" />
            <span className="text-[10px] uppercase max-sm:hidden">3: {i18n.t('formationCircle').split(' ')[0]}</span>
          </button>

          <button
            onClick={() => onFormationChange('arrow')}
            className={`flex flex-col items-center justify-center p-2 rounded-lg text-xs font-semibold font-orbitron transition-all cursor-pointer max-sm:p-1.5 max-sm:rounded-xl ${
              currentFormation === 'arrow'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/40'
                : 'bg-slate-900/60 text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title={i18n.t('arrowDesc')}
          >
            <ArrowUp className="w-4 h-4 mb-0.5 max-sm:mb-0 max-sm:w-5 max-sm:h-5" />
            <span className="text-[10px] uppercase max-sm:hidden">4: {i18n.t('formationArrow').split(' ')[0]}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
