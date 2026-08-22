/**
 * LocalizationManager: все строки в JSON-файлах (public/locales/*.json),
 * переключение языка на лету без перезагрузки страницы.
 */
import { EventEmitter } from "../core/EventEmitter";

export type Lang = "ru" | "en";
export type TFunc = (key: string, params?: Record<string, string | number>) => string;

type Dict = Record<string, string>;

export class LocalizationManager {
  readonly events = new EventEmitter<{ change: Lang }>();

  private dicts = new Map<Lang, Dict>();
  private fallbackDict: Dict = {};
  lang: Lang = "ru";
  private loading: Promise<void> | null = null;

  /** Загрузить словарь языка (кэшируется). */
  async loadLang(lang: Lang): Promise<void> {
    if (this.dicts.has(lang)) return;
    try {
      const res = await fetch(`locales/${lang}.json`, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const dict = (await res.json()) as Dict;
      this.dicts.set(lang, dict);
      if (lang === "ru") this.fallbackDict = dict;
    } catch (err) {
      console.warn(`[L10n] failed to load "${lang}":`, err);
    }
  }

  /** Загрузить fallback (ru) + текущий язык. */
  async init(savedLang: Lang): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      await this.loadLang("ru");
      await this.loadLang(savedLang);
      this.lang = this.dicts.has(savedLang) ? savedLang : "ru";
      this.events.emit("change", this.lang);
    })();
    return this.loading;
  }

  async setLang(lang: Lang): Promise<void> {
    await this.loadLang(lang);
    this.lang = lang;
    this.events.emit("change", this.lang);
  }

  /** Получить строку: key → params → fallback → key. */
  t(key: string, params?: Record<string, string | number>): string {
    const dict = this.dicts.get(this.lang);
    let str = dict?.[key] ?? this.fallbackDict[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.split(`{${k}}`).join(String(v));
      }
    }
    return str;
  }

  /** Список строк диалога по префиксу (например dialog.intro.0). */
  dialogLines(prefix: string): { name: string; lines: string[] } {
    const name = this.t(`${prefix}.name`);
    const lines: string[] = [];
    for (let i = 0; ; i++) {
      const line = this.t(`${prefix}.${i}`);
      if (line === `${prefix}.${i}`) break; // ключ отсутствует
      lines.push(line);
    }
    return { name, lines };
  }

  getSnapshot(): Lang {
    return this.lang;
  }

  subscribe(cb: () => void): () => void {
    return this.events.on("change", cb);
  }
}

export const l10n = new LocalizationManager();
