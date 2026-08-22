/**
 * Настройки: язык (без перезагрузки), качество (LOD), звук, музыка,
 * вибрация, тряска камеры, FPS, сброс прогресса. Всё сохраняется в GameStore.
 */
import { useEffect, useState } from "react";
import { store } from "../../game/core/GameState";
import { l10n } from "../../game/localization/LocalizationManager";
import { audio } from "../../game/audio/AudioEngine";
import { useL10n } from "../useL10n";

export function Settings({ onBack }: { onBack: () => void }) {
  const { t, lang } = useL10n();
  const [, force] = useState(0);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => store.events.on("change", () => force((x) => x + 1)), []);
  const s = store.getData().settings;

  const setLang = async (l: "ru" | "en") => {
    await l10n.setLang(l);
    store.setSettings({ lang: l });
    audio.ui();
  };

  const toggle = (key: keyof typeof s) => {
    const patch = { [key]: !s[key] } as Partial<typeof s>;
    store.setSettings(patch);
    if (key === "sound") audio.setSound(patch.sound!);
    if (key === "music") audio.setMusic(patch.music!);
    if (key === "haptics") audio.hapticsOn = patch.haptics!;
    audio.ui();
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between p-4">
        <button onClick={onBack} className="btn rounded-xl px-4 py-2 text-sm font-black uppercase">← {t("common.back")}</button>
        <h1 className="text-xl font-black uppercase tracking-widest text-white sm:text-2xl">{t("settings.title")}</h1>
        <span className="w-16" />
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto px-4 pb-10">
        <div className="mx-auto flex max-w-xl flex-col gap-3">
          {/* Язык */}
          <Row label={t("settings.lang")}>
            <div className="flex gap-2" role="radiogroup" aria-label={t("settings.lang")}>
              {(["ru", "en"] as const).map((l) => (
                <button
                  key={l}
                  role="radio"
                  aria-checked={lang === l}
                  onClick={() => setLang(l)}
                  className={`min-h-11 rounded-xl border-2 px-4 py-2 text-sm font-black uppercase transition-all focus-visible:outline-2 focus-visible:outline-amber-300 ${
                    lang === l ? "border-amber-300 bg-amber-400/20 text-amber-200" : "border-white/20 bg-white/5 text-white/60"
                  }`}
                >
                  {l === "ru" ? "Русский" : "English"}
                </button>
              ))}
            </div>
          </Row>

          {/* Качество */}
          <Row label={t("settings.quality")}>
            <select
              value={s.quality}
              onChange={(e) => store.setSettings({ quality: e.target.value as typeof s.quality })}
              className="min-h-11 rounded-xl border-2 border-white/20 bg-slate-800 px-3 py-2 text-sm font-bold text-white focus-visible:outline-2 focus-visible:outline-amber-300"
            >
              {(["auto", "low", "med", "high"] as const).map((q) => (
                <option key={q} value={q}>{t(`settings.quality.${q}`)}</option>
              ))}
            </select>
          </Row>

          <Toggle label={t("settings.sound")} checked={s.sound} onToggle={() => toggle("sound")} />
          <Toggle label={t("settings.music")} checked={s.music} onToggle={() => toggle("music")} />
          <Toggle label={t("settings.haptics")} checked={s.haptics} onToggle={() => toggle("haptics")} />
          <Toggle label={t("settings.shake")} checked={s.shake} onToggle={() => toggle("shake")} />
          <Toggle label={t("settings.fps")} checked={s.showFps} onToggle={() => toggle("showFps")} />

          {/* Сброс */}
          <div className="glass rounded-xl p-3">
            {confirmReset ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-red-300">{t("settings.resetConfirm")}</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      store.resetAll();
                      setConfirmReset(false);
                    }}
                    className="min-h-11 rounded-xl bg-red-500 px-3 py-2 text-sm font-black text-white"
                  >
                    {t("common.yes")}
                  </button>
                  <button
                    onClick={() => setConfirmReset(false)}
                    className="min-h-11 rounded-xl bg-white/10 px-3 py-2 text-sm font-black text-white"
                  >
                    {t("common.no")}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmReset(true)}
                className="min-h-11 w-full rounded-xl bg-red-500/20 px-3 py-2 text-sm font-black text-red-300 hover:bg-red-500/30"
              >
                {t("settings.reset")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="glass flex items-center justify-between gap-3 rounded-xl p-3">
      <span className="text-sm font-bold text-white">{label}</span>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <div className="glass flex items-center justify-between rounded-xl p-3">
      <span className="text-sm font-bold text-white">{label}</span>
      <button
        onClick={onToggle}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`relative h-7 w-13 min-w-12 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-amber-300 ${
          checked ? "bg-amber-400" : "bg-white/15"
        }`}
        style={{ width: 52 }}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? "left-[24px]" : "left-0.5"}`}
        />
      </button>
    </div>
  );
}
