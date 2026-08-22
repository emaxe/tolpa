/**
 * Главное меню: клавиатурная навигация (↑/↓ + Enter), контраст, aria.
 */
import { useEffect, useRef, useState } from "react";
import { store, TOTAL_LEVELS } from "../../game/core/GameState";
import { useL10n } from "../useL10n";

export function MainMenu({
  onPlay,
  onLevels,
  onShop,
  onSettings,
  onHelp,
}: {
  onPlay: () => void;
  onLevels: () => void;
  onShop: () => void;
  onSettings: () => void;
  onHelp: () => void;
}) {
  const { t } = useL10n();
  const data = store.getData();
  const [coins, setCoins] = useState(data.coins);
  useEffect(() => store.events.on("change", () => setCoins(store.getData().coins)), []);

  const items = [
    { label: t("menu.play"), action: onPlay },
    { label: t("menu.levels"), action: onLevels },
    { label: t("menu.shop"), action: onShop },
    { label: t("menu.settings"), action: onSettings },
    { label: t("menu.help"), action: onHelp },
  ];
  const [focus, setFocus] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    refs.current[focus]?.focus();
  }, [focus]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "ArrowDown") {
        e.preventDefault();
        setFocus((f) => (f + 1) % items.length);
      } else if (e.code === "ArrowUp") {
        e.preventDefault();
        setFocus((f) => (f - 1 + items.length) % items.length);
      } else if (e.code === "Enter" && items[focus]) {
        items[focus].action();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const progress = Math.round((data.levelsCompleted.length / TOTAL_LEVELS) * 100);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-4">
      <div className="text-center">
        <h1 className="title-glow text-6xl font-black tracking-tight text-white sm:text-8xl">
          {t("app.title")}
        </h1>
        <p className="mt-2 text-lg font-bold uppercase tracking-[0.35em] text-amber-300">{t("app.subtitle")}</p>
      </div>

      <div className="flex items-center gap-4 text-sm text-white/70">
        <span className="glass rounded-full px-3 py-1 font-bold text-amber-300">🪙 {coins}</span>
        <span className="glass rounded-full px-3 py-1">⭐ {data.levelsCompleted.length}/{TOTAL_LEVELS}</span>
        <span className="glass hidden rounded-full px-3 py-1 sm:inline">🏆 {data.stats.bestScore.toLocaleString("ru-RU")}</span>
      </div>

      {progress > 0 && (
        <div className="w-56">
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <nav aria-label="Main menu" className="flex w-64 flex-col gap-2.5">
        {items.map((it, i) => (
          <button
            key={it.label}
            ref={(el) => {
              refs.current[i] = el;
            }}
            onFocus={() => setFocus(i)}
            onMouseEnter={() => setFocus(i)}
            onClick={it.action}
            className="btn min-h-12 w-full rounded-xl px-5 py-3 text-lg font-black uppercase tracking-wider transition-transform hover:scale-[1.03] active:scale-[0.98]"
          >
            {it.label}
          </button>
        ))}
      </nav>

      <p className="absolute bottom-3 px-4 text-center text-[11px] text-white/35">{t("menu.credits")}</p>
    </div>
  );
}
