/**
 * Оверлеи: пауза, результат уровня, провал. Клавиатурная навигация — Tab/Enter,
 * кнопки с aria-метками, крупные контрастные элементы.
 */
import { useEffect, useRef } from "react";
import type { LevelResult } from "../game/systems/GameEngine";
import { useL10n } from "./useL10n";

export function PauseOverlay({
  onResume,
  onRestart,
  onExit,
}: {
  onResume: () => void;
  onRestart: () => void;
  onExit: () => void;
}) {
  const { t } = useL10n();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div ref={ref} role="dialog" aria-modal="true" aria-label={t("ui.pause")} className="glass-pop flex w-72 flex-col gap-3 rounded-2xl border border-white/20 bg-slate-900/90 p-6 shadow-2xl">
        <h2 className="mb-1 text-center text-2xl font-black uppercase tracking-widest text-white">{t("ui.pause")}</h2>
        <OverlayButton onClick={onResume} autoFocus>{t("common.resume")}</OverlayButton>
        <OverlayButton onClick={onRestart}>{t("common.restart")}</OverlayButton>
        <OverlayButton onClick={onExit}>{t("common.exit")}</OverlayButton>
        <p className="mt-1 text-center text-[11px] text-white/50">{t("settings.controls")}</p>
      </div>
    </div>
  );
}

export function CompleteOverlay({
  result,
  onNext,
  onLevels,
}: {
  result: LevelResult;
  onNext: () => void;
  onLevels: () => void;
}) {
  const { t } = useL10n();
  const stars = result.stars;
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" className="glass-pop flex w-80 flex-col items-center gap-3 rounded-2xl border border-amber-300/40 bg-slate-900/90 p-6 text-center shadow-2xl">
        <div className="text-5xl" aria-hidden>{result.isBoss ? "🏆" : "🎉"}</div>
        <h2 className="text-2xl font-black uppercase tracking-wide text-amber-300">
          {result.isBoss ? t("result.title.boss") : t("result.title.win")}
        </h2>
        {result.newBest && <div className="animate-pulse rounded-full bg-amber-400/20 px-3 py-1 text-sm font-black text-amber-300">★ {t("result.newBest")}</div>}
        <div className="flex gap-1 text-3xl" aria-label={`${t("result.stars")}: ${stars}`}>
          {[0, 1, 2].map((i) => (
            <span key={i} className={i < stars ? "text-amber-300" : "text-white/20"} aria-hidden>★</span>
          ))}
        </div>
        <div className="grid w-full grid-cols-2 gap-2 text-sm">
          <Stat label={t("result.score")} value={result.score.toLocaleString("ru-RU")} />
          <Stat label={t("result.coins")} value={`+${result.reward}`} />
        </div>
        <OverlayButton onClick={onNext} autoFocus>
          {result.isBoss ? t("common.levels") : t("result.next")}
        </OverlayButton>
        <OverlayButton onClick={onLevels} variant="ghost">{t("common.levels")}</OverlayButton>
      </div>
    </div>
  );
}

export function FailOverlay({
  score,
  coins,
  onRetry,
  onLevels,
}: {
  score: number;
  coins: number;
  onRetry: () => void;
  onLevels: () => void;
}) {
  const { t } = useL10n();
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" className="glass-pop flex w-80 flex-col items-center gap-3 rounded-2xl border border-red-400/40 bg-slate-900/90 p-6 text-center shadow-2xl">
        <div className="text-5xl" aria-hidden>💨</div>
        <h2 className="text-2xl font-black uppercase tracking-wide text-red-300">{t("result.title.lose")}</h2>
        <p className="text-sm text-white/60">{t("fail.reason.empty")}</p>
        <div className="grid w-full grid-cols-2 gap-2 text-sm">
          <Stat label={t("result.score")} value={score.toLocaleString("ru-RU")} />
          <Stat label={t("result.coins")} value={String(coins)} />
        </div>
        <OverlayButton onClick={onRetry} autoFocus>{t("common.retry")}</OverlayButton>
        <OverlayButton onClick={onLevels} variant="ghost">{t("common.levels")}</OverlayButton>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/5 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-white/50">{label}</div>
      <div className="text-base font-black text-white tabular-nums">{value}</div>
    </div>
  );
}

export function OverlayButton({
  children,
  onClick,
  variant = "primary",
  autoFocus,
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: "primary" | "ghost";
  autoFocus?: boolean;
}) {
  const cls =
    variant === "primary"
      ? "bg-gradient-to-b from-amber-300 to-orange-400 text-slate-900 shadow-lg shadow-orange-500/30 hover:from-amber-200 hover:to-orange-300"
      : "bg-white/10 text-white hover:bg-white/20";
  return (
    <button
      autoFocus={autoFocus}
      onClick={onClick}
      className={`min-h-11 w-full rounded-xl px-4 py-2.5 text-base font-black uppercase tracking-wide transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 active:scale-[0.98] ${cls}`}
    >
      {children}
    </button>
  );
}
