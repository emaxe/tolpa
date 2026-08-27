import React, { useEffect, useRef, useState } from 'react';
import { GameEngine } from '../engine/GameEngine';
import { eventBus } from '../core/EventBus';
import { i18n } from '../core/Localization';
import { soundEngine } from '../audio/SoundEngine';

interface FloatingItem {
  id: number;
  text: string;
  colorClass: string;
  x: number;
  y: number;
}

interface FloatingTextProps {
  engine: React.RefObject<GameEngine | null>;
}

/**
 * Лёгкий DOM-оверлей: всплывающие подписи над воротами/уроном/монетами.
 * Раньше единственным фидбеком был звук — игрок не видел, что именно изменилось
 * и почему ("непонятно что происходит" из жалобы пользователя).
 */
export const FloatingText: React.FC<FloatingTextProps> = ({ engine }) => {
  const [items, setItems] = useState<FloatingItem[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    const spawn = (worldX: number, worldZ: number, text: string, colorClass: string) => {
      const eng = engine.current;
      if (!eng) return;
      const pos = eng.projectToScreen(worldX, 2.2, worldZ);
      const id = idRef.current++;
      setItems((prev) => [...prev.slice(-24), { id, text, colorClass, x: pos.x, y: pos.y }]);
      window.setTimeout(() => {
        setItems((prev) => prev.filter((it) => it.id !== id));
      }, 850);
    };

    const unsubGate = eventBus.on(
      'gatePassed',
      (data: { netChange?: number; comboStreak?: number; x?: number; z?: number }) => {
        if (!data || typeof data.netChange !== 'number' || data.netChange === 0) return;
        const { netChange, comboStreak = 0, x = 0, z = 0 } = data;
        // При длинной серии позитивных ворот показываем маркер серии рядом с приростом толпы.
        const text = netChange > 0
          ? (comboStreak >= 3 ? `+${netChange} x${comboStreak}` : `+${netChange}`)
          : `${netChange}`;
        spawn(
          x,
          z,
          text,
          netChange > 0 ? (comboStreak >= 3 ? 'text-emerald-300 font-extrabold' : 'text-emerald-400') : 'text-red-400'
        );
      }
    );

    const unsubMobsKilled = eventBus.on(
      'mobsKilled',
      (data: { count?: number; reason?: string; x?: number; z?: number }) => {
        if (!data || !data.count || data.reason === 'gate') return; // ворота уже подписаны выше
        spawn(data.x || 0, data.z || 0, `-${data.count}`, 'text-red-400');
      }
    );

    const unsubCoin = eventBus.on('coinCollected', (data: { value?: number; x?: number; z?: number }) => {
      if (!data || !data.value) return;
      spawn(data.x || 0, data.z || 0, `+${data.value}`, 'text-amber-400');
    });

    // Разрушение препятствия (Hyper-режим / класс Tank): всплывающая подпись над местом слома.
    // Раньше событие obstacleSmashed эмитилось, но никем не потреблялось — игрок видел только
    // звук + частицы, без текстового фидбека. Цвет совпадает с взрывом частиц (0xf97316).
    const unsubObstacle = eventBus.on(
      'obstacleSmashed',
      (data: { type?: string; x?: number; z?: number }) => {
        if (!data) return;
        spawn(data.x || 0, data.z || 0, i18n.t('obstacleSmashed', 'СЛОМАНО!'), 'text-orange-400');
      }
    );

    // Near-Miss (уворот в упор): всплывающая бирюзовая плашка за рискованный проход
    // вплотную к активной ловушке без касания. Серия уворотов эскалирует текст и цвет.
    const unsubNearMiss = eventBus.on('nearMiss', (data: { x?: number; z?: number; streak?: number }) => {
      if (!data) return;
      const streak = data.streak ?? 1;
      let text = i18n.t('nearMiss', 'В УПОР! +⚡');
      let colorClass = 'text-cyan-300 drop-shadow-[0_0_8px_rgba(56,189,248,0.8)]';
      if (streak >= 10) {
        text = i18n.t('nearMissStreak10', 'БОЖЕСТВЕННО x10! +⚡');
        colorClass = 'text-amber-300 font-extrabold text-xl scale-110 drop-shadow-[0_0_12px_rgba(251,191,36,0.9)]';
      } else if (streak >= 5) {
        text = i18n.t('nearMissStreak5', 'МЕГА-СЕРИЯ x5! +⚡');
        colorClass = 'text-purple-300 font-extrabold text-lg drop-shadow-[0_0_10px_rgba(168,85,247,0.9)]';
      } else if (streak >= 2) {
        text = i18n.t('nearMissStreak2', 'СЕРИЯ x2! +⚡');
        colorClass = 'text-cyan-300 font-bold drop-shadow-[0_0_8px_rgba(56,189,248,0.9)]';
      }
      spawn(data.x || 0, data.z || 0, text, colorClass);
    });

    // Сбор бонусов-сфер (add_mobs / heal / adrenaline): событие bonusCollected эмитится
    // BonusManager, но раньше никем не потреблялось — игрок видел только звук + частицы.
    // Подключаем текстовый фидбек, цвет совпадает с BONUS_COLORS.
    const unsubBonus = eventBus.on(
      'bonusCollected',
      (data: { type?: string; value?: number; x?: number; z?: number }) => {
        if (!data || !data.value) return;
        const v = data.value;
        let text: string;
        let colorClass: string;
        switch (data.type) {
          case 'heal':
            text = `+♥${v} ${i18n.t('bonusHeal', 'ЛЕЧЕНИЕ!')}`;
            colorClass = 'text-emerald-400 font-bold';
            break;
          case 'adrenaline':
            text = `${i18n.t('bonusHyper', 'ГИПЕР!')} +⚡`;
            colorClass = 'text-yellow-300 font-extrabold drop-shadow-[0_0_10px_rgba(250,204,21,0.9)]';
            break;
          case 'add_mobs':
          default:
            text = `+${v}`;
            colorClass = 'text-emerald-300 font-extrabold';
            break;
        }
        spawn(data.x || 0, data.z || 0, text, colorClass);
      }
    );

    // Активация гипер-режима (адреналин): центральный всплывающий баннер «ГИПЕР!».
    // Событие adrenalineTriggered эмитится и при сборе сферы, и при нажатии кнопки —
    // единый текстовый фидбек для обоих путей активации (раньше только звук).
    const unsubAdrenalineTriggered = eventBus.on('adrenalineTriggered', (data: { duration?: number; x?: number; z?: number }) => {
      spawn(
        data.x ?? 0,
        data.z ?? 0,
        i18n.t('bonusHyper', 'ГИПЕР!') + ' +⚡',
        'text-yellow-300 font-extrabold text-xl drop-shadow-[0_0_12px_rgba(250,204,21,0.9)]'
      );
    });

    // Финишная прямая: центральный всплывающий баннер при пересечении линии.
    // Событие finishLineCrossed эмитится FinishLineManager, но раньше никем не потреблялось.
    const unsubFinishLine = eventBus.on('finishLineCrossed', () => {
      spawn(0, 0, i18n.t('finishLineCrossed', 'ФИНИШ!'), 'text-cyan-300 font-extrabold text-2xl drop-shadow-[0_0_14px_rgba(56,189,248,0.9)]');
    });

    // Покупка апгрейда: всплывающая плашка в центре экрана.
    // Событие upgradePurchased эмитится StateManager, но раньше никем не потреблялось.
    const unsubUpgrade = eventBus.on('upgradePurchased', (data: { upgradeKey?: string; level?: number }) => {
      spawn(0, 0, i18n.t('upgradePurchased', 'УЛУЧШЕНО!') + ' Lv.' + (data?.level ?? 1), 'text-emerald-300 font-bold drop-shadow-[0_0_8px_rgba(110,231,183,0.8)]');
    });

    // Разблокировка скина: всплывающая плашка.
    // Событие skinUnlocked эмитится StateManager, но раньше никем не потреблялось.
    const unsubSkin = eventBus.on('skinUnlocked', () => {
      soundEngine.playSound('upgrade_buy');
      spawn(0, 0, i18n.t('skinUnlocked', 'НОВЫЙ СКИН!'), 'text-fuchsia-300 font-extrabold text-xl drop-shadow-[0_0_10px_rgba(232,121,249,0.9)]');
    });

    return () => {
      unsubGate();
      unsubMobsKilled();
      unsubCoin();
      unsubObstacle();
      unsubNearMiss();
      unsubBonus();
      unsubAdrenalineTriggered();
      unsubFinishLine();
      unsubUpgrade();
      unsubSkin();
    };
  }, [engine]);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {items.map((it) => (
        <span
          key={it.id}
          className={`absolute font-orbitron font-extrabold text-lg drop-shadow-[0_0_6px_rgba(0,0,0,0.8)] animate-float-up ${it.colorClass}`}
          style={{ left: it.x, top: it.y }}
        >
          {it.text}
        </span>
      ))}
    </div>
  );
};
