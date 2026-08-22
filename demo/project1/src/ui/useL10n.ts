/**
 * React-хуки для LocalizationManager (переключение языка без перезагрузки).
 */
import { useSyncExternalStore } from "react";
import { l10n } from "../game/localization/LocalizationManager";
import type { Lang, TFunc } from "../game/localization/LocalizationManager";

export function useL10n(): { t: TFunc; lang: Lang } {
  const lang = useSyncExternalStore(
    (cb) => l10n.subscribe(cb),
    () => l10n.getSnapshot(),
  );
  return { t: (k, p) => l10n.t(k, p), lang };
}
