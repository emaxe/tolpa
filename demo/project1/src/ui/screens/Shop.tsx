/**
 * Магазин: улучшения (прогрессия цен) и бусты на забег. Все покупки
 * проходят через GameStore (автосохранение).
 */
import { useEffect, useState } from "react";
import { store } from "../../game/core/GameState";
import { BOOST_ORDER, UPGRADE_ORDER, upgradeCost } from "../../game/core/Economy";
import type { UpgradeId } from "../../game/core/Economy";
import { useL10n } from "../useL10n";

export function Shop({ onBack }: { onBack: () => void }) {
  const { t } = useL10n();
  const [, force] = useState(0);
  const [toast, setToast] = useState("");
  useEffect(() => store.events.on("change", () => force((x) => x + 1)), []);
  const data = store.getData();

  const buy = (id: UpgradeId) => {
    if (store.buyUpgrade(id)) {
      setToast(t("shop.bought"));
      setTimeout(() => setToast(""), 1400);
    } else {
      setToast(t("shop.notEnough"));
      setTimeout(() => setToast(""), 1400);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between p-4">
        <button onClick={onBack} className="btn rounded-xl px-4 py-2 text-sm font-black uppercase">← {t("common.back")}</button>
        <h1 className="text-xl font-black uppercase tracking-widest text-white sm:text-2xl">{t("shop.title")}</h1>
        <span className="glass rounded-full px-3 py-1 text-sm font-bold text-amber-300">🪙 {data.coins}</span>
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto px-4 pb-10">
        {/* Улучшения */}
        <h2 className="mb-2 mt-2 text-sm font-black uppercase tracking-widest text-amber-300">{t("shop.upgrades")}</h2>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {UPGRADE_ORDER.map((id) => {
            const def = UPGRADE_ORDER.length ? UPGRADES_DEF[id] : null;
            void def;
            const level = data.upgrades[id] ?? 0;
            const maxed = level >= UPGRADES_MAX[id];
            const cost = maxed ? 0 : upgradeCost(id, level);
            const afford = data.coins >= cost;
            return (
              <div key={id} className="glass flex items-center justify-between gap-3 rounded-xl p-3 text-white">
                <div className="min-w-0">
                  <div className="font-black">{t(`upg.${id}.name`)} <span className="text-white/50">Lv.{level}/{UPGRADES_MAX[id]}</span></div>
                  <div className="mt-0.5 text-xs leading-snug text-white/60">{t(`upg.${id}.desc`)}</div>
                </div>
                <button
                  onClick={() => buy(id)}
                  disabled={maxed || !afford}
                  aria-label={`${t(`upg.${id}.name`)}: ${maxed ? t("common.max") : `${t("common.buy")} ${cost}`}`}
                  className={`shrink-0 rounded-xl px-3 py-2 text-sm font-black transition-all focus-visible:outline-2 focus-visible:outline-amber-300 ${
                    maxed
                      ? "bg-emerald-500/20 text-emerald-300"
                      : afford
                        ? "bg-gradient-to-b from-amber-300 to-orange-400 text-slate-900 hover:brightness-110"
                        : "bg-white/10 text-white/35"
                  }`}
                >
                  {maxed ? t("common.max") : `🪙 ${cost}`}
                </button>
              </div>
            );
          })}
        </div>

        {/* Бусты */}
        <h2 className="mb-2 mt-6 text-sm font-black uppercase tracking-widest text-amber-300">{t("shop.boosts")}</h2>
        <p className="mb-2 text-xs text-white/50">{t("shop.forNextRun")}</p>
        <div className="grid gap-2.5 sm:grid-cols-3">
          {BOOST_ORDER.map((id) => {
            const cost = BOOSTS_DEF[id].cost;
            const selected = !!data.boostsSelected[id];
            const afford = data.coins >= cost;
            return (
              <button
                key={id}
                onClick={() => store.toggleBoost(id)}
                disabled={!afford && !selected}
                aria-pressed={selected}
                className={`glass flex flex-col items-center gap-1 rounded-xl p-3 text-center transition-all focus-visible:outline-2 focus-visible:outline-amber-300 ${
                  selected ? "border-2 border-amber-300 bg-amber-400/15" : "border-2 border-transparent hover:bg-white/10"
                } ${!afford && !selected ? "opacity-40" : ""}`}
              >
                <span className="text-lg font-black text-white">{t(`boost.${id}.name`)}</span>
                <span className="text-[11px] leading-tight text-white/60">{t(`boost.${id}.desc`)}</span>
                <span className="text-sm font-black text-amber-300">🪙 {cost}{selected ? " ✓" : ""}</span>
              </button>
            );
          })}
        </div>

        {toast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-amber-400 px-5 py-2 text-sm font-black text-slate-900 shadow-2xl">
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

import { UPGRADES as UPGRADES_DEF, BOOSTS as BOOSTS_DEF } from "../../game/core/Economy";
const UPGRADES_MAX: Record<UpgradeId, number> = {
  startCrowd: 10, runSpeed: 8, magnetTime: 6, coinLuck: 8, shieldStart: 3, adrenalineGain: 5, formations: 3,
};
