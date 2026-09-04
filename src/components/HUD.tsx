import React, { useState, useEffect } from 'react';
import { FormationType } from '../types/game';
import { i18n } from '../core/Localization';
import { stateManager } from '../core/StateManager';
import { eventBus } from '../core/EventBus';
import { Zap, Users, Coins, Shield, ArrowUp, MoveHorizontal, CircleDot, Pause, Skull, TriangleAlert, Route, Trophy, Focus, Diamond } from 'lucide-react';

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
  comboFactor: number; // Множитель бонуса толпы за серию позитивных ворот (1.0..1.8)
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
  // Стоимость следующей финишной стены в легионерах (-1 если финиш не активен или все стены пробиты).
  finishNextWallCost?: number;
  // Хватает ли текущей толпы, чтобы пробить следующую стену (crowd > cost).
  finishNextWallAffordable?: boolean;
  // Серия уворотов в упор (Near-Miss Streak) — текущая длина и множитель награды.
  nearMissStreak: number;
  nearMissMultiplier: number;
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
  comboFactor = 1.0,
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
  finishNextWallCost = -1,
  finishNextWallAffordable = false,
  nearMissStreak,
  nearMissMultiplier,
}) => {
  const [bossInfo, setBossInfo] = useState<{ hp: number; maxHp: number; nameKey: string } | null>(null);
  const [isBossShielded, setIsBossShielded] = useState<boolean>(false);
  const [damageFlashKey, setDamageFlashKey] = useState<number>(0);
  // Баннер динамического события уровня (ambush/coin_train/emp_storm/meteor_rain/speed_boost)
  const [eventAlert, setEventAlert] = useState<{ type: string; key: number } | null>(null);

  // Маппинг типа события -> ключ локализации и цвет баннера
  const EVENT_ALERT_MAP: Record<string, { key: string; cls: string }> = {
    ambush: { key: 'eventAmbush', cls: 'border-red-500 text-red-600' },
    coin_train: { key: 'eventCoinTrain', cls: 'border-amber-500 text-amber-600' },
    emp_storm: { key: 'eventEmpStorm', cls: 'border-rose-500 text-rose-600' },
    meteor_rain: { key: 'eventMeteorRain', cls: 'border-orange-500 text-orange-600' },
    speed_boost: { key: 'eventSpeedBoost', cls: 'border-teal-500 text-teal-700' },
    nearMissMilestone: { key: 'nearMissMilestone', cls: 'border-fuchsia-500 text-fuchsia-600' },
    comboMilestone: { key: 'comboMilestone', cls: 'border-amber-500 text-amber-600' },
    comboMax: { key: 'comboMaxBanner', cls: 'border-yellow-400 text-yellow-600' },
    achievementReady: { key: 'achievementReady', cls: 'border-amber-400 text-amber-600' },
    crowdMilestone: { key: 'crowdMilestone', cls: 'border-emerald-500 text-emerald-600' },
    adrenalineReady: { key: 'hyperModeReady', cls: 'border-amber-400 text-amber-600' },
    endlessRecordBeaten: { key: 'endlessRecordBeaten', cls: 'border-yellow-400 text-yellow-600' },
    finishLineCrossed: { key: 'finishLineCrossed', cls: 'border-cyan-400 text-cyan-600' },
    bossDefeated: { key: 'bossDefeated', cls: 'border-yellow-400 text-yellow-600' },
    bossAppear: { key: 'bossAppear', cls: 'border-red-500 text-red-600' },
    bossEnraged: { key: 'bossEnraged', cls: 'border-rose-600 text-rose-700' },
    newClass_tank: { key: 'newClassAppearedTank', cls: 'border-amber-400 text-amber-600' },
    newClass_ninja: { key: 'newClassAppearedNinja', cls: 'border-purple-400 text-purple-600' },
    newClass_mage: { key: 'newClassAppearedMage', cls: 'border-emerald-400 text-emerald-600' },
  };

  useEffect(() => {
    const unsubBoss = eventBus.on('bossDamaged', (data) => {
      setBossInfo(data);
    });

    // Индикатор энергощита босса: отдельное событие, т.к. bossDamaged эмитится
    // только при уроне, а щит может быть активен без урона (игрок не бьёт).
    const unsubBossShield = eventBus.on('bossShieldChanged', (data: { shielded?: boolean }) => {
      setIsBossShielded(!!data?.shielded);
    });

    const unsubBossDefeat = eventBus.on('bossDefeated', () => {
      setBossInfo(null);
      setIsBossShielded(false);
      setEventAlert({ type: 'bossDefeated', key: Date.now() });
    });

    // Босс проснулся (первый вход толпы в арену) — центральный баннер-тост.
    const unsubBossAppear = eventBus.on('bossAppear', () => {
      setEventAlert({ type: 'bossAppear', key: Date.now() });
      window.setTimeout(() => setEventAlert(null), 3200);
    });

    // Босс впал в ярость (HP <= 45%) — красный баннер-тост предупреждения.
    const unsubBossEnraged = eventBus.on('bossEnraged', () => {
      setEventAlert({ type: 'bossEnraged', key: Date.now() });
      window.setTimeout(() => setEventAlert(null), 3200);
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

    // Порог серии уворотов (x2/x5/x10) — центральный баннер-тост.
    const unsubNearMissMilestone = eventBus.on('nearMissMilestone', (data: { multiplier?: number }) => {
      const mult = data?.multiplier ?? 1;
      setEventAlert({ type: 'nearMissMilestone', key: Date.now() });
      window.setTimeout(() => setEventAlert(null), 3200);
    });

    // Порог серии ворот (5/10/15...) — центральный баннер-тост.
    const unsubComboMilestone = eventBus.on('comboMilestone', () => {
      setEventAlert({ type: 'comboMilestone', key: Date.now() });
      window.setTimeout(() => setEventAlert(null), 3200);
    });

    // Потолок серии ворот (×1.8) — праздничный баннер-тост.
    const unsubComboMax = eventBus.on('comboMax', () => {
      setEventAlert({ type: 'comboMax', key: Date.now() });
      window.setTimeout(() => setEventAlert(null), 3200);
    });

    // Достижение готово к получению — центральный баннер-тост.
    const unsubAchReady = eventBus.on('achievementReady', () => {
      setEventAlert({ type: 'achievementReady', key: Date.now() });
      window.setTimeout(() => setEventAlert(null), 3200);
    });

    // Толпа достигла порога 50/100/150/200 — центральный баннер-тост.
    const unsubCrowdMilestone = eventBus.on('crowdMilestone', (data: { count?: number }) => {
      setEventAlert({ type: 'crowdMilestone', key: Date.now() });
      window.setTimeout(() => setEventAlert(null), 3200);
    });

    // Адреналин заряжен до 100% — гипер-режим доступен. Центральный баннер-тост,
    // чтобы игрок не упустил момент, когда можно безопасно протаранить препятствия.
    const unsubAdrenalineReady = eventBus.on('adrenalineReady', () => {
      setEventAlert({ type: 'adrenalineReady', key: Date.now() });
      window.setTimeout(() => setEventAlert(null), 2400);
    });

    // Побитие личного рекорда в бесконечном режиме — центральный баннер-тост.
    const unsubEndlessRecordBeaten = eventBus.on('endlessRecordBeaten', () => {
      setEventAlert({ type: 'endlessRecordBeaten', key: Date.now() });
      window.setTimeout(() => setEventAlert(null), 3200);
    });

    // Финишная прямая пересечена — центральный баннер-тост.
    const unsubFinishLine = eventBus.on('finishLineCrossed', () => {
      setEventAlert({ type: 'finishLineCrossed', key: Date.now() });
      window.setTimeout(() => setEventAlert(null), 3200);
    });

    // Новый класс бойца впервые появился в толпе — баннер-тост с именем класса.
    const unsubNewClass = eventBus.on('newClassAppeared', (data: { type?: string }) => {
      if (!data || !data.type) return;
      setEventAlert({ type: `newClass_${data.type}`, key: Date.now() });
      window.setTimeout(() => setEventAlert(null), 3200);
    });

    return () => {
      unsubBoss();
      unsubBossShield();
      unsubBossDefeat();
      unsubBossAppear();
      unsubBossEnraged();
      unsubMobsKilled();
      unsubEvent();
      unsubNearMissMilestone();
      unsubComboMilestone();
      unsubComboMax();
      unsubAchReady();
      unsubCrowdMilestone();
      unsubAdrenalineReady();
      unsubEndlessRecordBeaten();
      unsubFinishLine();
      unsubNewClass();
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
          <div className="bg-white/80 backdrop-blur-md border border-teal-500/40 rounded-xl px-4 py-2 shadow-lg shadow-slate-300/40">
            <span className="text-xs uppercase text-teal-700 font-orbitron tracking-wider">
              {isEndless ? i18n.t('endlessMode') : `${i18n.t('level')} ${levelNumber}`}
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              <Users className="w-5 h-5 text-teal-700 animate-pulse" />
              <span className="text-2xl font-bold font-orbitron text-slate-900">
                {crowdCount}
              </span>
            </div>
          </div>

          {/* Live Run Coins Badge — собранные за забег монеты (сырое значение, без множителя экономики) */}
          <div className="bg-white/80 backdrop-blur-md border border-amber-500/40 rounded-xl px-4 py-2 shadow-lg shadow-amber-950/50">
            <span className="text-xs uppercase text-amber-400 font-orbitron tracking-wider">
              {i18n.t('coins')}
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              <Coins className="w-5 h-5 text-amber-400" />
              <span className="text-2xl font-bold font-orbitron text-amber-600">
                {coinCount.toLocaleString()}
              </span>
            </div>
          </div>

          {/* Combo Multiplier Badge — счётчик серии + множитель бонуса толпы.
              comboFactor (1.0..1.8) показывает реальный прирост бойцов за серию
              позитивных ворот, который раньше был невидим. */}
          {comboStreak > 1 && (
            <div className="bg-amber-500/90 text-zinc-950 font-orbitron font-extrabold px-3 py-1.5 rounded-lg shadow-lg animate-bounce flex items-center gap-1.5 text-sm">
              <Zap className="w-4 h-4 fill-current" />
              <span>{comboStreak}x {i18n.t('combo')}!</span>
              {comboFactor > 1 && (
                <span className="bg-slate-100/25 px-1.5 py-0.5 rounded-md text-xs font-black tracking-tight">
                  {comboFactor >= 1.8
                    ? `×${comboFactor.toFixed(1)} ${i18n.t('comboMax', 'МАКС')}`
                    : `×${comboFactor.toFixed(2)}`}
                </span>
              )}
            </div>
          )}

          {/* Near-Miss Streak Badge — серия уворотов в упор (x2/x5/x10), декуплирована
              от combo ворот. Показывает текущий множитель награды за рискованные проходы. */}
          {nearMissStreak >= 2 && (
            <div className="bg-cyan-500/90 text-zinc-950 font-orbitron font-extrabold px-3 py-1.5 rounded-lg shadow-lg animate-pulse flex items-center gap-1.5 text-sm">
              <Zap className="w-4 h-4 fill-current" />
              <span>{nearMissStreak} {i18n.t('nearMissStreakLabel', 'УВОРОТОВ')}!</span>
              <span className="bg-slate-100/25 px-1.5 py-0.5 rounded-md text-xs font-black tracking-tight">
                ×{nearMissMultiplier}
              </span>
            </div>
          )}
        </div>

        {/* Top Right Controls & Debug info */}
        <div className="flex items-center gap-2">
          {/* Debug performance stats */}
          <div className="bg-slate-100/70 border border-slate-300 rounded-lg px-2.5 py-1 text-[11px] text-slate-600 font-mono flex gap-2">
            <span>FPS: <strong className="text-emerald-400">{fps}</strong></span>
            <span>DC: <strong className="text-teal-700">{drawCalls}</strong></span>
          </div>

          {/* Pause Button */}
          <button
            onClick={onPause}
            className="pointer-events-auto p-2.5 bg-white/80 hover:bg-slate-200 active:scale-95 border border-slate-300 rounded-xl text-slate-700 hover:text-slate-900 transition-all shadow-md cursor-pointer"
          >
            <Pause className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Event Alert Banner (динамическое событие уровня) */}
      {eventAlert && EVENT_ALERT_MAP[eventAlert.type] && (
        <div
          key={eventAlert.key}
          className={`absolute left-1/2 -translate-x-1/2 top-24 z-20 pointer-events-none px-6 py-2 rounded-xl border-2 bg-slate-100/85 backdrop-blur-md font-orbitron font-extrabold text-sm md:text-base tracking-wider animate-pulse shadow-2xl ${EVENT_ALERT_MAP[eventAlert.type].cls}`}
        >
          {i18n.t(EVENT_ALERT_MAP[eventAlert.type].key)}
        </div>
      )}

      {/* Индикатор финишной фазы — появляется после пересечения финишной черты.
          Показывает текущий множитель бонуса и прогресс по стенам замка. */}
      {isFinishActive && !isEndless && (
        <div className="absolute left-1/2 -translate-x-1/2 top-12 z-20 pointer-events-none flex flex-col items-center gap-1">
          <div className="bg-slate-100/90 border-2 border-amber-400/80 rounded-2xl px-5 py-2 shadow-[0_0_25px_rgba(251,191,36,0.5)] backdrop-blur-md flex items-center gap-3">
            <Trophy className="w-5 h-5 text-amber-400 fill-amber-400 animate-bounce" />
            <div className="flex flex-col items-center">
              <span className="text-[10px] uppercase font-orbitron tracking-widest text-amber-600">
                {i18n.t('wallMultiplier')}
              </span>
              <span className="text-2xl font-extrabold font-orbitron text-amber-400 drop-shadow-[0_0_10px_rgba(251,191,36,0.8)]">
                ×{finishMultiplier.toFixed(1)}
              </span>
            </div>
            <span className="text-xs font-orbitron text-slate-600 ml-1">
              {finishStepsDone}/{finishStepsTotal}
            </span>
          </div>
          {/* Readout стоимости следующей стены: хватает ли толпы её пробить. */}
          {finishNextWallCost >= 0 && (
            <div
              className={`px-3 py-1 rounded-lg border font-orbitron text-xs font-extrabold tracking-wider ${
                finishNextWallAffordable
                  ? 'bg-emerald-950/80 border-emerald-500/70 text-emerald-300'
                  : 'bg-red-950/80 border-red-500/70 text-red-300 animate-pulse'
              }`}
            >
              {i18n.t('nextWall')}: −{finishNextWallCost} · {i18n.t('finishCrowd')}{' '}
              {crowdCount}/{finishNextWallCost}
            </div>
          )}
        </div>
      )}

      {/* Progress bar to finish — тонкая полоска в самом верху экрана, не перекрывает
          центр (раньше висела по центру и мешала обзору/свайпам). pointer-events-none. */}
      {!isEndless && (
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-slate-100/80 pointer-events-none">
          <div
            className="h-full bg-gradient-to-r from-teal-400 via-amber-400 to-orange-500 transition-[width] duration-200"
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
            <span className="text-[10px] font-orbitron text-slate-600">
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
          <span className="text-[11px] font-orbitron text-teal-700 flex items-center gap-1">
            <Route className="w-3 h-3" />
            {distanceTraveled.toLocaleString()} м
          </span>
          {stateManager.getState().endlessHighScore > 0 && (
            <span className="text-[10px] font-orbitron text-slate-600">
              {i18n.t('endlessRecord')}: {stateManager.getState().endlessHighScore.toLocaleString()} м
            </span>
          )}
        </div>
      )}

      {/* Boss Health Bar if Active */}
      {bossInfo && (() => {
        const hpPct = bossInfo.maxHp > 0 ? bossInfo.hp / bossInfo.maxHp : 0;
        const critical = hpPct > 0 && hpPct < 0.25;
        return (
        <div className={`w-full max-w-md mx-auto bg-white/90 border-2 ${critical ? 'border-red-600 animate-[pulse_0.4s_ease-in-out_infinite]' : isBossShielded ? 'border-cyan-400 shadow-cyan-500/50' : 'border-red-500/80 animate-pulse'} rounded-xl p-3 shadow-2xl shadow-red-950/80 pointer-events-auto`}>
          <div className="flex justify-between items-center mb-1 font-orbitron text-xs">
            <span className={`font-bold tracking-wider flex items-center gap-1 ${critical ? 'text-red-600' : isBossShielded ? 'text-cyan-600' : 'text-red-400'}`}>
              <Skull className="w-3.5 h-3.5" />
              {i18n.t(bossInfo.nameKey, 'BOSS')}
              {isBossShielded && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-cyan-500/20 border border-cyan-400 text-cyan-700 text-[10px] font-extrabold uppercase animate-pulse">
                  <Shield className="w-3 h-3 text-cyan-500" />
                  {i18n.t('bossShield', 'ЩИТ')}
                </span>
              )}
            </span>
            <span className="text-slate-700">
              {Math.max(0, Math.round(bossInfo.hp))} / {bossInfo.maxHp} HP
            </span>
          </div>
          <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden border border-red-900">
            <div
              className={`h-full ${critical ? 'bg-gradient-to-r from-red-700 via-red-500 to-red-400' : isBossShielded ? 'bg-gradient-to-r from-cyan-600 via-cyan-400 to-sky-300' : 'bg-gradient-to-r from-red-600 via-orange-500 to-yellow-400'} transition-all duration-150`}
              style={{ width: `${Math.max(0, hpPct * 100)}%` }}
            />
          </div>
        </div>
        );
      })()}

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
                ? 'bg-gradient-to-r from-yellow-500 via-amber-400 to-orange-500 text-zinc-950 border-yellow-300 animate-pulse scale-[1.02]'
                : adrenalineCharge >= 100
                ? 'bg-gradient-to-r from-amber-400 via-orange-400 to-yellow-400 hover:from-amber-300 hover:to-yellow-300 text-zinc-950 border-amber-300 shadow-amber-500/40 cursor-pointer animate-bounce'
                : 'bg-white/80 text-slate-600 border-slate-300 opacity-90 cursor-not-allowed'
            } w-full p-3 max-sm:w-16 max-sm:h-16 max-sm:p-0 max-sm:justify-center max-sm:rounded-full max-sm:border-2`}
          >
            <div className="flex items-center gap-2 relative z-10 text-sm md:text-base max-sm:hidden">
              <Zap className={`w-5 h-5 ${isHyperActive || adrenalineCharge >= 100 ? 'fill-zinc-950' : 'fill-amber-400'}`} />
              <span>
                {isHyperActive
                  ? i18n.t('hyperActive')
                  : adrenalineCharge >= 100
                  ? i18n.t('hyperModeReady')
                  : `${i18n.t('adrenaline')} (${Math.round(adrenalineCharge)}%)`}
              </span>
            </div>
            {/* Мобильная иконка-молния */}
            <Zap className={`w-7 h-7 max-sm:block hidden ${isHyperActive || adrenalineCharge >= 100 ? 'fill-zinc-950' : 'fill-amber-400'}`} />

            {/* Progress Fill Indicator */}
            {!isHyperActive && (
              <div
                className="absolute inset-0 bg-amber-500/25 pointer-events-none transition-all duration-200"
                style={{ width: `${adrenalineCharge}%` }}
              />
            )}
          </button>
        </div>

        {/* Formation Switcher Buttons */}
        <div className="pointer-events-auto flex flex-col items-center gap-1.5">
          {/* Бейдж активного тактического бонуса формации — показывает, что даёт
              текущий строй, чтобы выбор формации читался как тактический инструмент. */}
          <div className="bg-slate-100/80 backdrop-blur-md border border-slate-300 rounded-lg px-2.5 py-1 text-[10px] font-orbitron font-bold text-teal-700 max-sm:hidden">
            {currentFormation === 'wedge' && '🛡️ Урон −40%'}
            {currentFormation === 'wide' && '🧲 Охват +60% · Сложение +50%'}
            {currentFormation === 'circle' && '💥 Таран боссов ×1.35 · Стен ×2'}
            {currentFormation === 'arrow' && '⚡ Скорость +15%'}
            {currentFormation === 'oval' && '⚖️ Баланс · Универсальный строй'}
            {currentFormation === 'diamond' && '💎 Броня −25% · Стены ×2 · Таран'}
          </div>
          <div className="pointer-events-auto grid grid-cols-6 gap-2 bg-slate-100/80 backdrop-blur-md p-1.5 rounded-xl border border-slate-300 max-sm:order-1 max-sm:grid-cols-1 max-sm:gap-1 max-sm:p-1 max-sm:rounded-2xl">
          <button
            onClick={() => onFormationChange('wedge')}
            className={`flex flex-col items-center justify-center p-2 rounded-lg text-xs font-semibold font-orbitron transition-all cursor-pointer max-sm:p-1.5 max-sm:rounded-xl ${
              currentFormation === 'wedge'
                ? 'bg-gradient-to-r from-teal-400 to-emerald-400 text-zinc-950 font-bold shadow-md shadow-teal-500/30'
                : 'bg-white/60 text-slate-600 hover:text-slate-900 hover:bg-slate-200'
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
                ? 'bg-gradient-to-r from-teal-400 to-emerald-400 text-zinc-950 font-bold shadow-md shadow-teal-500/30'
                : 'bg-white/60 text-slate-600 hover:text-slate-900 hover:bg-slate-200'
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
                ? 'bg-gradient-to-r from-teal-400 to-emerald-400 text-zinc-950 font-bold shadow-md shadow-teal-500/30'
                : 'bg-white/60 text-slate-600 hover:text-slate-900 hover:bg-slate-200'
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
                ? 'bg-gradient-to-r from-teal-400 to-emerald-400 text-zinc-950 font-bold shadow-md shadow-teal-500/30'
                : 'bg-white/60 text-slate-600 hover:text-slate-900 hover:bg-slate-200'
            }`}
            title={i18n.t('arrowDesc')}
          >
            <ArrowUp className="w-4 h-4 mb-0.5 max-sm:mb-0 max-sm:w-5 max-sm:h-5" />
            <span className="text-[10px] uppercase max-sm:hidden">4: {i18n.t('formationArrow').split(' ')[0]}</span>
          </button>

          <button
            onClick={() => onFormationChange('oval')}
            className={`flex flex-col items-center justify-center p-2 rounded-lg text-xs font-semibold font-orbitron transition-all cursor-pointer max-sm:p-1.5 max-sm:rounded-xl ${
              currentFormation === 'oval'
                ? 'bg-gradient-to-r from-teal-400 to-emerald-400 text-zinc-950 font-bold shadow-md shadow-teal-500/30'
                : 'bg-white/60 text-slate-600 hover:text-slate-900 hover:bg-slate-200'
            }`}
            title={i18n.t('ovalDesc')}
          >
            <Focus className="w-4 h-4 mb-0.5 max-sm:mb-0 max-sm:w-5 max-sm:h-5" />
            <span className="text-[10px] uppercase max-sm:hidden">5: {i18n.t('formationOval').split(' ')[0]}</span>
          </button>

          <button
            onClick={() => onFormationChange('diamond')}
            className={`flex flex-col items-center justify-center p-2 rounded-lg text-xs font-semibold font-orbitron transition-all cursor-pointer max-sm:p-1.5 max-sm:rounded-xl ${
              currentFormation === 'diamond'
                ? 'bg-gradient-to-r from-teal-400 to-emerald-400 text-zinc-950 font-bold shadow-md shadow-teal-500/30'
                : 'bg-white/60 text-slate-600 hover:text-slate-900 hover:bg-slate-200'
            }`}
            title={i18n.t('diamondDesc', 'Ромб: броня +25%, стены ×2, таран')}
          >
            <Diamond className="w-4 h-4 mb-0.5 max-sm:mb-0 max-sm:w-5 max-sm:h-5" />
            <span className="text-[10px] uppercase max-sm:hidden">6: {i18n.t('formationDiamond', 'Ромб').split(' ')[0]}</span>
          </button>
          </div>
        </div>
      </div>
    </div>
  );
};
