/**
 * HUD: очки, монеты, толпа, комбо, адреналин, баннеры, босс-бар.
 * Обновляется событиями движка (~10 Гц) — без участия в игровом цикле.
 */
import { useEffect, useState } from "react";
import type { HudData } from "../game/systems/GameEngine";
import { useL10n } from "./useL10n";

interface HUDProps {
  hud: HudData;
  onPause: () => void;
  onFormation: () => void;
  onAdrenaline: () => void;
  isTouch: boolean;
  showFps: boolean;
}

export function HUD({ hud, onPause, onFormation, onAdrenaline, isTouch, showFps }: HUDProps) {
  const { t } = useL10n();
  const [pulse, setPulse] = useState(0);
  const [adrKey, setAdrKey] = useState(0);

  useEffect(() => {
    if (hud.banner) {
      setPulse((p) => p + 1);
    }
  }, [hud.banner]);

  useEffect(() => {
    if (hud.adrenalineActive) setAdrKey((k) => k + 1);
  }, [hud.adrenalineActive]);

  const adrFull = hud.adrenaline >= 100 && !hud.adrenalineActive;
  const boss = hud.isBoss && hud.wallMax > 0;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 select-none">
      {/* Верхняя панель */}
      <div className="flex items-start justify-between p-3 sm:p-4">
        <div className="glass rounded-xl px-3 py-2 text-white">
          <div className="text-[10px] uppercase tracking-wider text-white/60">{t("common.level")} {hud.level}</div>
          <div className="text-lg font-black leading-none text-amber-300">{Math.floor(hud.score).toLocaleString("ru-RU")}</div>
          {hud.combo > 1 && (
            <div className="mt-0.5 text-xs font-bold text-emerald-300" aria-label={`${t("hud.combo")} ${hud.combo}`}>
              {t("hud.combo")} ×{hud.mult.toFixed(1)} <span className="text-white/70">({hud.combo})</span>
            </div>
          )}
        </div>

        <div className="glass flex items-center gap-2 rounded-xl px-3 py-2 text-white">
          <span aria-hidden>🪙</span>
          <span className="text-lg font-black text-amber-300">{hud.coins}</span>
        </div>

        <button
          onClick={onPause}
          aria-label={t("hud.pause")}
          className="btn pointer-events-auto flex h-11 w-11 items-center justify-center rounded-xl text-lg"
        >
          ⏸
        </button>
      </div>

      {/* Толпа + специалисты */}
      <div className="absolute left-3 top-20 sm:left-4 sm:top-24">
        <div className="glass rounded-xl px-3 py-2 text-white">
          <div className="flex items-center gap-2">
            <span className="text-xl" aria-hidden>👥</span>
            <span className="text-xl font-black tabular-nums">{hud.count}</span>
          </div>
          <div className="mt-1 flex gap-2 text-[11px] font-bold">
            {hud.specialists.speedster > 0 && <span className="text-yellow-300" aria-label={`speedsters ${hud.specialists.speedster}`}>⚡{hud.specialists.speedster}</span>}
            {hud.specialists.tank > 0 && <span className="text-slate-300" aria-label={`tanks ${hud.specialists.tank}`}>🛡{hud.specialists.tank}</span>}
            {hud.specialists.magnet > 0 && <span className="text-sky-300" aria-label={`magnets ${hud.specialists.magnet}`}>🧲{hud.specialists.magnet}</span>}
            {hud.specialists.clover > 0 && <span className="text-green-300" aria-label={`clovers ${hud.specialists.clover}`}>🍀{hud.specialists.clover}</span>}
          </div>
        </div>
        {/* Активные таймеры */}
        <div className="mt-2 flex flex-col gap-1">
          {hud.shield > 0 && <Chip icon="🛡️" text={hud.shield.toFixed(1)} cls="border-sky-300/60 text-sky-200" />}
          {hud.speedT > 0 && <Chip icon="⚡" text={hud.speedT.toFixed(1)} cls="border-yellow-300/60 text-yellow-200" />}
          {hud.magnetT > 0 && <Chip icon="🧲" text={hud.magnetT.toFixed(1)} cls="border-cyan-300/60 text-cyan-200" />}
          {hud.freezeT > 0 && <Chip icon="❄️" text={hud.freezeT.toFixed(1)} cls="border-blue-300/60 text-blue-200" />}
          {hud.doubleCoins && <Chip icon="🪙" text="×2" cls="border-amber-300/60 text-amber-200" />}
          {hud.doubleScore && <Chip icon="✨" text="×2" cls="border-fuchsia-300/60 text-fuchsia-200" />}
        </div>
      </div>

      {/* Адреналин */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
        <button
          onClick={onAdrenaline}
          disabled={!adrFull}
          aria-label={`${t("hud.adrenaline")} ${Math.round(hud.adrenaline)}%`}
          className={`pointer-events-auto flex items-center gap-2 rounded-full border-2 px-4 py-2 backdrop-blur transition-all ${
            hud.adrenalineActive
              ? "border-red-400 bg-red-500/40 shadow-[0_0_24px_rgba(255,60,60,0.9)]"
              : adrFull
                ? "animate-pulse border-amber-300 bg-amber-400/30 shadow-[0_0_18px_rgba(255,210,63,0.8)]"
                : "border-white/25 bg-black/40"
          }`}
          key={adrKey}
        >
          <span className="text-lg" aria-hidden>🔥</span>
          <div className="h-2.5 w-28 overflow-hidden rounded-full bg-black/50 sm:w-36">
            <div
              className={`h-full rounded-full transition-all duration-150 ${hud.adrenalineActive ? "bg-red-400" : "bg-gradient-to-r from-amber-500 to-orange-400"}`}
              style={{ width: `${hud.adrenalineActive ? 100 : hud.adrenaline}%` }}
            />
          </div>
          <span className="text-xs font-black text-white">{adrFull || hud.adrenalineActive ? t("hud.ready") : `${Math.round(hud.adrenaline)}%`}</span>
        </button>
      </div>

      {/* Босс-бар */}
      {boss && (
        <div className="absolute left-1/2 top-16 w-64 -translate-x-1/2 sm:top-20 sm:w-80">
          <div className="mb-1 text-center text-[11px] font-black uppercase tracking-widest text-red-300">
            {t("hud.wall")} · {hud.wallHp}/{hud.wallMax}
          </div>
          <div className="h-3 overflow-hidden rounded-full border border-red-400/50 bg-black/50">
            <div
              className="h-full rounded-full bg-gradient-to-r from-red-600 to-orange-400 transition-all duration-200"
              style={{ width: `${(hud.wallHp / hud.wallMax) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Баннер */}
      {hud.banner && (
        <div key={pulse} className="banner-pop absolute left-1/2 top-1/3 -translate-x-1/2">
          <div className="rounded-2xl border-2 border-white/70 bg-black/60 px-6 py-3 text-center text-xl font-black uppercase tracking-widest text-white shadow-2xl backdrop-blur sm:text-2xl">
            {hud.banner}
          </div>
        </div>
      )}

      {/* Обратный отсчёт */}
      {hud.countdown >= 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div key={hud.countdown} className="count-pop text-8xl font-black text-white drop-shadow-[0_0_30px_rgba(255,210,63,0.9)]">
            {hud.countdown === 0 ? "🏁" : hud.countdown}
          </div>
        </div>
      )}

      {/* Формация + подсказки */}
      <div className="absolute bottom-4 right-3 flex flex-col items-end gap-2 sm:right-4">
        {hud.formationsUnlocked > 0 && (
          <button
            onClick={onFormation}
            aria-label={t("hud.formation")}
            className="btn pointer-events-auto px-3 py-2 text-sm font-bold"
          >
            {t(`formation.${hud.formation}`)} 🔄
          </button>
        )}
        {isTouch && (
          <div className="glass rounded-lg px-3 py-1.5 text-[11px] text-white/80">
            {t("hud.tapHint")} · {t("hud.swipeUp")}
          </div>
        )}
        {showFps && (
          <div className="glass rounded-lg px-2 py-1 text-[11px] font-bold tabular-nums text-emerald-300">
            {t("hud.fps")}: {hud.fps}
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({ icon, text, cls }: { icon: string; text: string; cls: string }) {
  return (
    <div className={`pointer-events-none flex w-fit items-center gap-1.5 rounded-full border bg-black/40 px-2.5 py-0.5 text-xs font-bold backdrop-blur ${cls}`}>
      <span aria-hidden>{icon}</span>
      <span className="tabular-nums">{text}</span>
    </div>
  );
}

/** Хук подписки на HUD-события движка. */
export function useHud(engine: { events: { on: (e: "hud", h: (d: HudData) => void) => () => void } }): HudData | null {
  const [hud, setHud] = useState<HudData | null>(null);
  useEffect(() => {
    return engine.events.on("hud", (d) => setHud({ ...d }));
  }, [engine]);
  return hud;
}
