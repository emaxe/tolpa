/**
 * StoryDialog: диалоги сюжета (русская локализация), печатающийся текст,
 * пропуск по клику/Enter, клавиатурная навигация.
 */
import { useEffect, useMemo, useState } from "react";
import { l10n } from "../../game/localization/LocalizationManager";
import { useL10n } from "../useL10n";

export function StoryDialog({
  prefix,
  onClose,
  onSkip,
}: {
  prefix: string;
  onClose: () => void;
  onSkip?: () => void;
}) {
  const { t } = useL10n();
  const dialog = useMemo(() => l10n.dialogLines(prefix), [prefix, l10n.lang]);
  const [line, setLine] = useState(0);
  const [visible, setVisible] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setLine(0);
    setVisible(0);
    setDone(false);
  }, [dialog]);

  const text = dialog.lines[line] ?? "";
  useEffect(() => {
    setDone(false);
    setVisible(0);
    if (text.length === 0) {
      setDone(true);
      return;
    }
    const iv = setInterval(() => {
      setVisible((v) => {
        if (v >= text.length) {
          clearInterval(iv);
          setDone(true);
          return v;
        }
        return v + 2;
      });
    }, 22);
    return () => clearInterval(iv);
  }, [line, text]);

  const advance = () => {
    if (!done) {
      setDone(true);
      setVisible(text.length);
      return;
    }
    if (line < dialog.lines.length - 1) {
      setLine(line + 1);
    } else {
      onClose();
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Enter" || e.code === "Space") {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="absolute inset-0 z-40 flex items-end justify-center bg-black/50 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-label={dialog.name}
        className="glass-pop mb-4 flex w-[min(560px,92vw)] items-start gap-4 rounded-2xl border border-amber-300/30 bg-slate-900/95 p-5 shadow-2xl sm:mb-10"
      >
        {/* Процедурный портрет */}
        <div
          aria-hidden
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 border-amber-300/60 bg-gradient-to-b from-indigo-500 to-indigo-800 text-3xl"
        >
          {dialog.name === l10n.t("dialog.intro.name") ? "🤘" : "🏰"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black uppercase tracking-widest text-amber-300">{dialog.name}</div>
          <p className="mt-1 min-h-12 text-[15px] leading-snug text-white">
            {text.slice(0, visible)}
            {!done && <span className="animate-pulse">▍</span>}
          </p>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-white/40">
              {line + 1}/{dialog.lines.length}
            </span>
            <div className="flex gap-2">
              {onSkip && (
                <button onClick={onSkip} className="min-h-11 rounded-xl bg-white/10 px-4 py-2 text-xs font-black uppercase text-white/70">
                  {t("common.next")} »
                </button>
              )}
              <button
                onClick={advance}
                autoFocus
                className="min-h-11 rounded-xl bg-gradient-to-b from-amber-300 to-orange-400 px-5 py-2 text-xs font-black uppercase text-slate-900 shadow-lg"
              >
                {done && line === dialog.lines.length - 1 ? t("common.start") : t("common.next")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
