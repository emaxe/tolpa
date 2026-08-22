/**
 * Карта мира: 5 миров × (10 уровней + босс). Клавиатурная навигация стрелками.
 */
import { useEffect, useRef, useState } from "react";
import { store, TOTAL_LEVELS } from "../../game/core/GameState";
import { useL10n } from "../useL10n";

const WORLDS = [0, 1, 2, 3, 4];

export function LevelSelect({ onBack, onPlay }: { onBack: () => void; onPlay: (index: number) => void }) {
  const { t } = useL10n();
  const data = store.getData();
  const [, force] = useState(0);
  useEffect(() => store.events.on("change", () => force((x) => x + 1)), []);

  const firstUnlocked = Math.min(TOTAL_LEVELS - 1, data.levelsCompleted.length);
  const [focus, setFocus] = useState(firstUnlocked);
  const refs = useRef<Record<number, HTMLButtonElement | null>>({});

  useEffect(() => {
    refs.current[focus]?.focus();
  }, [focus]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      let next = focus;
      if (e.code === "ArrowRight") next = Math.min(TOTAL_LEVELS - 1, focus + 1);
      else if (e.code === "ArrowLeft") next = Math.max(0, focus - 1);
      else if (e.code === "ArrowDown") next = Math.min(TOTAL_LEVELS - 1, focus + 11);
      else if (e.code === "ArrowUp") next = Math.max(0, focus - 11);
      else return;
      e.preventDefault();
      setFocus(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between p-4">
        <button onClick={onBack} className="btn rounded-xl px-4 py-2 text-sm font-black uppercase">← {t("common.back")}</button>
        <h1 className="text-xl font-black uppercase tracking-widest text-white sm:text-2xl">{t("levels.title")}</h1>
        <span className="glass rounded-full px-3 py-1 text-sm font-bold text-amber-300">🪙 {data.coins}</span>
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto px-4 pb-8">
        {WORLDS.map((w) => {
          const base = w * 11;
          const completedInWorld = data.levelsCompleted.filter((i) => i >= base && i < base + 11).length;
          return (
            <section key={w} aria-label={t(`world.${w}`)} className="mb-6">
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-base font-black uppercase tracking-widest text-amber-300">
                  {t("common.world")} {w + 1} · {t(`world.${w}`)}
                </h2>
                <span className="text-xs font-bold text-white/50">{completedInWorld}/11</span>
              </div>
              <div className="grid grid-cols-6 gap-2 sm:grid-cols-11">
                {Array.from({ length: 11 }, (_, i) => {
                  const idx = base + i;
                  const isBoss = i === 10;
                  const unlocked = store.isUnlocked(idx);
                  const stars = data.levelsStars[idx] ?? 0;
                  const done = data.levelsCompleted.includes(idx);
                  return (
                    <button
                      key={idx}
                      ref={(el) => {
                        refs.current[idx] = el;
                      }}
                      disabled={!unlocked}
                      onClick={() => unlocked && onPlay(idx)}
                      aria-label={`${t("common.level")} ${idx + 1}${isBoss ? ` ${t("levels.boss")}` : ""}${done ? `, ${t("levels.done")}, ${stars}/3` : ""}`}
                      className={`relative flex aspect-square flex-col items-center justify-center rounded-xl border-2 text-sm font-black transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 ${
                        isBoss
                          ? done
                            ? "border-red-400 bg-gradient-to-b from-red-500/40 to-red-800/40 text-red-100"
                            : unlocked
                              ? "border-red-400/70 bg-red-900/40 text-red-200"
                              : "border-white/10 bg-white/5 text-white/25"
                          : done
                            ? "border-emerald-400/70 bg-emerald-500/20 text-white"
                            : unlocked
                              ? "border-amber-300/60 bg-amber-400/10 text-white hover:bg-amber-400/25"
                              : "border-white/10 bg-white/5 text-white/25"
                      }`}
                    >
                      <span className="text-[10px] opacity-70">{isBoss ? t("levels.boss") : idx + 1}</span>
                      <span className="text-xs tracking-tighter">
                        {done ? "★".repeat(stars) + "☆".repeat(3 - stars) : unlocked ? "▶" : "🔒"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
        <p className="pb-4 text-center text-xs text-white/40">{t("settings.controls")}</p>
      </div>
    </div>
  );
}
