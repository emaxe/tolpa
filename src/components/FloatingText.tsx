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

    // UI-центрированный спавн: для событий без 3D-координат (магазин, скин, финиш).
    // Использует экранные координаты центра вместо 3D-проекции (0,0) которая
    // инвертируется при камере на большом Z (финиш) или вне игровой сцены (меню).
    const spawnScreen = (text: string, colorClass: string, yOffset: number = 0) => {
      const id = idRef.current++;
      setItems((prev) => [...prev.slice(-24), {
        id, text, colorClass,
        x: window.innerWidth / 2,
        y: window.innerHeight / 2 + yOffset,
      }]);
      window.setTimeout(() => {
        setItems((prev) => prev.filter((it) => it.id !== id));
      }, 850);
    };

    const unsubGate = eventBus.on(
      'gatePassed',
      (data: { op?: string; netChange?: number; comboStreak?: number; x?: number; z?: number; perk?: string | null }) => {
        if (!data || typeof data.netChange !== 'number' || data.netChange === 0) return;
        const { op, netChange, comboStreak = 0, x = 0, z = 0, perk } = data;
        // Мистические ворота (риск/награда) получают отдельный яркий фидбек — игрок
        // должен видеть, что исход был случайным, а не обычным приростом/потерей.
        if (op === 'mystery') {
          const lucky = netChange > 0;
          spawn(
            x,
            z,
            lucky
              ? `${i18n.t('mysteryLucky', 'УДАЧА!')} +${netChange}`
              : `${i18n.t('mysteryUnlucky', 'НЕ ПОВЕЗЛО!')} ${netChange}`,
            lucky
              ? 'text-fuchsia-300 font-black text-xl drop-shadow-[0_0_12px_rgba(217,70,239,0.9)]'
              : 'text-red-500 font-black text-xl drop-shadow-[0_0_12px_rgba(239,68,68,0.9)]'
          );
          return;
        }
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

        if (perk) {
          if (perk === 'arrow_mult') {
            spawn(x, z - 1.0, i18n.t('perkArrowGate', 'СТРЕЛА: ×+0.5'), 'text-cyan-300 font-bold drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]');
          } else if (perk === 'circle_add') {
            spawn(x, z - 1.0, i18n.t('perkCircleGate', 'ФАЛАНГА: +30%'), 'text-emerald-300 font-bold drop-shadow-[0_0_8px_rgba(16,185,129,0.8)]');
          } else if (perk === 'wide_add') {
            spawn(x, z - 1.0, i18n.t('perkWideGate', 'ШЕРЕНГА: +50%'), 'text-teal-300 font-bold drop-shadow-[0_0_8px_rgba(45,212,191,0.8)]');
          } else if (perk === 'wedge_div') {
            spawn(x, z - 1.0, i18n.t('perkWedgeGate', 'КЛИН: -10% ПОТЕРЬ'), 'text-purple-300 font-bold drop-shadow-[0_0_8px_rgba(168,85,247,0.9)]');
          } else if (perk === 'diamond_div') {
            spawn(x, z - 1.0, i18n.t('perkDiamondGate', 'РОМБ: -15% ПОТЕРЬ'), 'text-slate-200 font-bold drop-shadow-[0_0_8px_rgba(226,232,240,0.9)]');
          }
        }
      }
    );

    const unsubMobsKilled = eventBus.on(
      'mobsKilled',
      (data: { count?: number; reason?: string; x?: number; z?: number }) => {
        if (!data || !data.count || data.reason === 'gate') return; // ворота уже подписаны выше
        spawn(data.x || 0, data.z || 0, `-${data.count}`, 'text-red-400');
      }
    );

    const unsubCoin = eventBus.on('coinCollected', (data: { value?: number; x?: number; z?: number; tier?: number }) => {
      if (!data || !data.value) return;
      const tier = data.tier ?? 1;
      spawn(
        data.x || 0,
        data.z || 0,
        `+${data.value}`,
        tier >= 2 ? 'text-cyan-300 drop-shadow-[0_0_6px_rgba(34,211,238,0.8)]' : 'text-amber-400',
      );
    });

    // Серия ворот сбита: всплывающая надпись «СЕРИЯ СБИТА!» с указанием утраченной
    // длины. Показывается только при потере значимой серии (≥5), эмитится GateManager.
    const unsubComboBreak = eventBus.on('comboBreak', (data: { streak?: number; x?: number; z?: number }) => {
      if (!data || !data.streak) return;
      spawnScreen(
        `${i18n.t('comboBreak', 'СЕРИЯ СБИТА!')} x${data.streak}`,
        'text-red-500 font-extrabold text-xl drop-shadow-[0_0_10px_rgba(239,68,68,0.9)]',
        -30
      );
    });

    // Потолок серии ворот достигнут (×1.8, серия ≥ 11): центральный золотой баннер.
    // Эмитится GateManager ровно один раз при первом достижении капа серии.
    const unsubComboMax = eventBus.on('comboMax', () => {
      spawnScreen(
        i18n.t('comboMaxBanner', 'МАКСИМУМ СЕРИИ! ×1.8 🏆'),
        'text-yellow-300 font-black text-2xl scale-125 drop-shadow-[0_0_16px_rgba(250,204,21,1)]',
        -30
      );
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
    const unsubNearMiss = eventBus.on('nearMiss', (data: { x?: number; z?: number; streak?: number; coins?: number }) => {
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
      // Near-miss даёт монеты (8×mult), но раньше их количество не показывалось — добавим
      // золотую цифру с иконкой монеты, чтобы риск был виден игроку.
      if (typeof data.coins === 'number' && data.coins > 0) {
        text += ` +${data.coins}🪙`;
      }
      spawn(data.x || 0, data.z || 0, text, colorClass);
    });

    // Срыв серии уворотов (урон толпы / безопасный объезд / мина / собака): когда серия
    // была >=2, показываем красную плашку о потере мультипликатора. Раньше сброс серии
    // происходил молча — без текстового фидбека.
    const unsubNearMissBreak = eventBus.on(
      'nearMissBreak',
      (data: { streak?: number; x?: number; z?: number }) => {
        if (!data) return;
        const streak = data.streak ?? 0;
        spawn(
          data.x || 0,
          data.z || 0,
          i18n.t('nearMissBreak', 'УВОРОТ СБИТ!') + ` x${streak}`,
          'text-red-400 font-bold drop-shadow-[0_0_8px_rgba(248,113,113,0.9)]'
        );
      }
    );

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

    // Адреналин заряжен до 100% — гипер-режим доступен. Раньше переход был «немым»,
    // игрок упускал момент, когда можно безопасно протаранить препятствия.
    // Событие adrenalineReady эмитится GameEngine при пересечении порога зарядки.
    const unsubAdrenalineReady = eventBus.on('adrenalineReady', (data: { x?: number; z?: number }) => {
      spawn(
        data.x ?? 0,
        data.z ?? 0,
        `⚡ ${i18n.t('hyperModeReady', 'ГИПЕР ГОТОВ!')} ⚡`,
        'text-amber-300 font-black text-xl tracking-wider drop-shadow-[0_0_12px_rgba(250,204,21,0.9)]'
      );
    });

    // Финишная прямая: центральный всплывающий баннер при пересечении линии.
    // Событие finishLineCrossed эмитится FinishLineManager, но раньше никем не потреблялось.
    const unsubFinishLine = eventBus.on('finishLineCrossed', () => {
      spawnScreen(i18n.t('finishLineCrossed', 'ФИНИШ!'), 'text-cyan-300 font-extrabold text-2xl drop-shadow-[0_0_14px_rgba(56,189,248,0.9)]', -60);
    });

    // Толпа достигла порога 50/100/150/200 — центральный всплывающий баннер.
    // Ключевой момент в crowd evolution — игроку нужен фидбек, что его легион растёт.
    const unsubCrowdMilestone = eventBus.on('crowdMilestone', (data: { count?: number; x?: number; z?: number }) => {
      const count = data?.count ?? 50;
      const tier = count >= 200 ? 4 : count >= 150 ? 3 : count >= 100 ? 2 : 1;
      const text = `${i18n.t('crowdMilestone', 'ЛЕГИОН РАСТЁТ! 🛡️')} ×${count}`;
      const cls = tier >= 3
        ? 'text-amber-300 font-extrabold text-2xl drop-shadow-[0_0_14px_rgba(251,191,36,0.9)]'
        : tier >= 2
        ? 'text-emerald-300 font-extrabold text-xl drop-shadow-[0_0_12px_rgba(16,185,129,0.9)]'
        : 'text-emerald-400 font-extrabold text-lg drop-shadow-[0_0_10px_rgba(16,185,129,0.8)]';
      spawnScreen(text, cls, -40);
    });

    // Покупка апгрейда: всплывающая плашка в центре экрана.
    // Событие upgradePurchased эмитится StateManager, но раньше никем не потреблялось.
    const unsubUpgrade = eventBus.on('upgradePurchased', (data: { upgradeKey?: string; level?: number }) => {
      spawnScreen(i18n.t('upgradePurchased', 'УЛУЧШЕНО!') + ' Lv.' + (data?.level ?? 1), 'text-emerald-300 font-bold drop-shadow-[0_0_8px_rgba(110,231,183,0.8)]');
    });

    // Разблокировка скина: всплывающая плашка.
    // Событие skinUnlocked эмитится StateManager, но раньше никем не потреблялось.
    const unsubSkin = eventBus.on('skinUnlocked', () => {
      spawnScreen(i18n.t('skinUnlocked', 'НОВЫЙ СКИН!'), 'text-fuchsia-300 font-extrabold text-xl drop-shadow-[0_0_10px_rgba(232,121,249,0.9)]');
    });

    // Урон по боссу: всплывающие числа урона над боссом.
    // Событие bossDamaged эмитится BossManager ~6 Гц, но потреблялось только HUD (полоса HP) —
    // игрок не видел чисел урона, только полоску. Добавляем floating damage numbers.
    const unsubBossDamaged = eventBus.on('bossDamaged', (data: { damage?: number; x?: number; z?: number }) => {
      if (!data || !data.damage) return;
      const dmg = Math.round(data.damage);
      // Проекция с y=4.5 — над головой босса (~5м высотой), чтобы текст не перекрывался телом.
      const eng = engine.current;
      if (!eng) return;
      const pos = eng.projectToScreen(data.x ?? 0, 4.5, data.z ?? 0);
      const id = idRef.current++;
      setItems((prev) => [...prev.slice(-24), { id, text: `-${dmg}`, colorClass: 'text-red-400 font-extrabold text-xl drop-shadow-[0_0_8px_rgba(239,68,68,0.9)]', x: pos.x, y: pos.y }]);
      window.setTimeout(() => {
        setItems((prev) => prev.filter((it) => it.id !== id));
      }, 850);
    });

    // Энергокупол босса: отражённый удар — циановый бейдж «ЩИТ БОССА» на куполе,
    // пробитие Фалангой — янтарный «ПРОБИТИЕ!». Без текстового фидбека игрок не
    // понимал, почему HP не падает (звук/искры «попадания» были ложными).
    const unsubBossShieldBlocked = eventBus.on(
      'bossShieldBlocked',
      (data: { x?: number; z?: number }) => {
        spawn(data?.x ?? 0, data?.z ?? 0, i18n.t('bossShieldBlocked'), 'text-cyan-300 font-extrabold text-xl drop-shadow-[0_0_8px_rgba(0,240,255,0.9)]');
      }
    );
    const unsubBossShieldPierced = eventBus.on(
      'bossShieldPierced',
      (data: { x?: number; z?: number }) => {
        spawn(data?.x ?? 0, data?.z ?? 0, i18n.t('bossShieldPierced'), 'text-amber-400 font-extrabold text-xl drop-shadow-[0_0_8px_rgba(245,158,11,0.9)]');
      }
    );

    // 3D-бейдж при смене боевого построения: название строя всплывает над толпой.
    // Событие formationChanged эмитится CrowdManager.setFormation, но FloatingText
    // раньше не потреблял его — игрок видел только звук + частицы, без текстовой
    // подсказки какой строй активирован.
    const FORMATION_LABELS: Record<string, string> = {
      wedge: 'КЛИН',
      wide: 'ШЕРЕНГА',
      circle: 'ФАЛАНГА',
      arrow: 'СТРЕЛА',
      oval: 'ОВАЛ',
      diamond: 'РОМБ',
    };
    const FORMATION_TEXT_COLORS: Record<string, string> = {
      wedge: 'text-purple-400 font-extrabold text-xl drop-shadow-[0_0_8px_rgba(168,85,247,0.9)]',
      wide: 'text-sky-400 font-extrabold text-xl drop-shadow-[0_0_8px_rgba(56,189,248,0.9)]',
      circle: 'text-amber-400 font-extrabold text-xl drop-shadow-[0_0_8px_rgba(245,158,11,0.9)]',
      arrow: 'text-cyan-300 font-extrabold text-xl drop-shadow-[0_0_8px_rgba(0,240,255,0.9)]',
      oval: 'text-emerald-400 font-extrabold text-xl drop-shadow-[0_0_8px_rgba(16,185,129,0.9)]',
      diamond: 'text-slate-300 font-extrabold text-xl drop-shadow-[0_0_8px_rgba(226,232,240,0.9)]',
    };
    const unsubFormation = eventBus.on(
      'formationChanged',
      (data: { formation?: string; x?: number; z?: number }) => {
        if (!data?.formation) return;
        const label = FORMATION_LABELS[data.formation] ?? data.formation.toUpperCase();
        const colorClass = FORMATION_TEXT_COLORS[data.formation] ?? 'text-white font-extrabold text-xl';
        spawn(data.x ?? 0, data.z ?? 0, label, colorClass);
      }
    );

    // Финишная дорожка множителей: всплывающий яркий 3D-множитель при пробитии стены
    const unsubFinishStep = eventBus.on(
      'finishStepSmashed',
      (data: { multiplier?: number; x?: number; z?: number }) => {
        if (!data || typeof data.multiplier !== 'number') return;
        const mult = data.multiplier;
        const isMax = mult >= 10;
        const text = isMax ? `×${mult.toFixed(1)} ${i18n.t('comboMax', 'МАКС')}!` : `×${mult.toFixed(1)}!`;
        const colorClass = isMax
          ? 'text-yellow-300 font-black text-2xl scale-125 drop-shadow-[0_0_16px_rgba(250,204,21,1)]'
          : mult >= 4.0
          ? 'text-amber-300 font-extrabold text-xl scale-110 drop-shadow-[0_0_12px_rgba(245,158,11,0.9)]'
          : 'text-cyan-300 font-extrabold text-lg drop-shadow-[0_0_10px_rgba(6,182,212,0.9)]';
        spawn(data.x ?? 0, data.z ?? 0, text, colorClass);
      }
    );

    // Классовые способности (Уворот Ниндзя, Щит Танка, Трансмутация Мага)
    const unsubClassAbility = eventBus.on(
      'classAbility',
      (data: { type?: string; ability?: string; x?: number; z?: number; value?: number }) => {
        if (!data) return;
        const x = data.x ?? 0;
        const z = data.z ?? 0;
        if (data.type === 'ninja') {
          spawn(x, z, i18n.t('ninjaDodge', 'УВОРОТ!'), 'text-purple-300 font-extrabold drop-shadow-[0_0_8px_rgba(168,85,247,0.9)]');
        } else if (data.type === 'tank') {
          spawn(x, z, i18n.t('tankShield', 'ЩИТ!'), 'text-amber-300 font-extrabold drop-shadow-[0_0_8px_rgba(245,158,11,0.9)]');
        } else if (data.type === 'mage') {
          if (data.ability === 'shield') {
            spawn(x, z, i18n.t('mageShield', 'ЭНЕРГОЩИТ!'), 'text-emerald-300 font-extrabold drop-shadow-[0_0_8px_rgba(16,185,129,0.9)]');
          } else {
            const valPrefix = data.value ? `+${data.value} ` : '';
            const text = `${valPrefix}${i18n.t('mageTransmute', 'МАГИЯ!')}`;
            spawn(x, z, text, 'text-emerald-300 font-extrabold drop-shadow-[0_0_8px_rgba(16,185,129,0.9)]');
          }
        }
      }
    );

    // Броня формаций (Щит Клина wedge / Броня Ромба diamond)
    const unsubFormationDefend = eventBus.on(
      'formationDefend',
      (data: { formation?: 'wedge' | 'diamond'; saved?: number; x?: number; z?: number }) => {
        if (!data) return;
        const x = data.x ?? 0;
        const z = data.z ?? 0;
        if (data.formation === 'wedge') {
          spawn(x, z, i18n.t('wedgeBlock', 'ЩИТ КЛИНА! -40%'), 'text-purple-300 font-extrabold drop-shadow-[0_0_8px_rgba(168,85,247,0.9)]');
        } else if (data.formation === 'diamond') {
          spawn(x, z, i18n.t('diamondArmor', 'БРОНЯ РОМБА! -25%'), 'text-slate-200 font-extrabold drop-shadow-[0_0_8px_rgba(148,163,184,0.9)]');
        }
      }
    );

    // Новый класс бойца впервые появился в толпе — всплывающий 3D-ярлык над точкой спавна.
    const unsubNewClass = eventBus.on(
      'newClassAppeared',
      (data: { type?: string; x?: number; z?: number }) => {
        if (!data?.type) return;
        const x = data.x ?? 0;
        const z = data.z ?? 0;
        if (data.type === 'tank') {
          spawn(x, z, i18n.t('tankName', 'ДЖАГГЕРНАУТ!'), 'text-amber-300 font-black text-xl drop-shadow-[0_0_12px_rgba(245,158,11,0.9)]');
        } else if (data.type === 'ninja') {
          spawn(x, z, i18n.t('ninjaName', 'НИНДЗЯ!'), 'text-purple-300 font-black text-xl drop-shadow-[0_0_12px_rgba(168,85,247,0.9)]');
        } else if (data.type === 'mage') {
          spawn(x, z, i18n.t('mageName', 'ХРОНО-МАГ!'), 'text-emerald-300 font-black text-xl drop-shadow-[0_0_12px_rgba(16,185,129,0.9)]');
        }
      }
    );

    return () => {
      unsubGate();
      unsubMobsKilled();
      unsubCoin();
      unsubComboBreak();
      unsubComboMax();
      unsubObstacle();
      unsubNearMiss();
      unsubNearMissBreak();
      unsubBonus();
      unsubAdrenalineTriggered();
      unsubAdrenalineReady();
      unsubFinishLine();
      unsubCrowdMilestone();
      unsubUpgrade();
      unsubSkin();
      unsubBossDamaged();
      unsubBossShieldBlocked();
      unsubBossShieldPierced();
      unsubFormation();
      unsubFinishStep();
      unsubClassAbility();
      unsubFormationDefend();
      unsubNewClass();
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
