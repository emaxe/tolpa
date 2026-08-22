/**
 * «Как играть»: управление и механики (доступность: крупный текст, контраст).
 */
import { useL10n } from "../useL10n";

export function Help({ onBack }: { onBack: () => void }) {
  const { t } = useL10n();
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between p-4">
        <button onClick={onBack} className="btn rounded-xl px-4 py-2 text-sm font-black uppercase">← {t("common.back")}</button>
        <h1 className="text-xl font-black uppercase tracking-widest text-white sm:text-2xl">{t("help.title")}</h1>
        <span className="w-16" />
      </header>
      <div className="scroll-thin flex-1 overflow-y-auto px-4 pb-10">
        <div className="mx-auto max-w-xl">
          <h2 className="mb-2 text-sm font-black uppercase tracking-widest text-amber-300">{t("help.controls")}</h2>
          <div className="glass mb-5 rounded-xl p-4 text-sm leading-relaxed text-white/85">
            <p>🖥️ {t("help.desktop")}</p>
            <p className="mt-2">📱 {t("help.mobile")}</p>
          </div>
          <h2 className="mb-2 text-sm font-black uppercase tracking-widest text-amber-300">{t("help.mechanics")}</h2>
          <ul className="flex flex-col gap-2">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <li key={i} className="glass rounded-xl p-4 text-sm leading-relaxed text-white/85">
                {t(`help.mechanic.${i}`)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
