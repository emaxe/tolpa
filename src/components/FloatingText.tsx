import React, { useEffect, useRef, useState } from 'react';
import { GameEngine } from '../engine/GameEngine';
import { eventBus } from '../core/EventBus';
import { i18n } from '../core/Localization';

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
    // вплотную к активной ловушке без касания.
    const unsubNearMiss = eventBus.on('nearMiss', (data: { x?: number; z?: number }) => {
      if (!data) return;
      spawn(data.x || 0, data.z || 0, i18n.t('nearMiss', 'В УПОР! +⚡'), 'text-cyan-300 drop-shadow-[0_0_8px_rgba(56,189,248,0.8)]');
    });

    return () => {
      unsubGate();
      unsubMobsKilled();
      unsubCoin();
      unsubObstacle();
      unsubNearMiss();
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
