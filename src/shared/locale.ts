export type Locale = "ja" | "en" | "zh-CN" | "zh-TW";
export const SUPPORTED_LOCALES: readonly Locale[] = ["ja", "en", "zh-CN", "zh-TW"];
export const LOCALE_NAMES: Record<Locale, string> = { ja: "日本語", en: "English", "zh-CN": "简体中文", "zh-TW": "繁體中文" };
const STORAGE_KEY = "skillsmaster-lang";

export function storedLocale(): Locale {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (SUPPORTED_LOCALES.includes(value as Locale)) return value as Locale;
  } catch { /* Storage may be disabled. */ }
  return "ja";
}

export function persistLocale(locale: Locale): void {
  try { localStorage.setItem(STORAGE_KEY, locale); } catch { /* Keep the in-memory choice. */ }
}
