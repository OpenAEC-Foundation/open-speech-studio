import { createSignal, createContext, useContext, type JSX } from "solid-js";
import nl from "../locales/nl";
import en from "../locales/en";

// ── Types ──────────────────────────────────────────────────
export type Locale = "nl" | "en";

type Translations = Record<string, string>;

const locales: Record<Locale, Translations> = { nl, en };

// ── Core i18n factory ──────────────────────────────────────

export function createI18n(initialLocale: Locale = "en") {
  const [locale, setLocale] = createSignal<Locale>(initialLocale);

  /**
   * Look up a translation key.
   *
   * 1. Try the current locale
   * 2. Fall back to Dutch ("nl") if the key is missing
   * 3. Return the raw key if it exists in neither locale
   *
   * Supports `{param}` interpolation:
   *   t("app.startupActive", { hotkey: "Ctrl+Win" })
   */
  const t = (key: string, params?: Record<string, string | number>): string => {
    let value =
      locales[locale()]?.[key] ??
      locales["en"]?.[key] ??
      key;

    if (params) {
      for (const [k, v] of Object.entries(params)) {
        value = value.replaceAll(`{${k}}`, String(v));
      }
    }

    return value;
  };

  const availableLocales: Locale[] = ["nl", "en"];

  return { t, locale, setLocale, availableLocales };
}

// ── Context / Provider / Hook ──────────────────────────────

type I18nValue = ReturnType<typeof createI18n>;

export const I18nContext = createContext<I18nValue>();

interface I18nProviderProps {
  initialLocale?: Locale;
  children: JSX.Element;
}

export function I18nProvider(props: I18nProviderProps) {
  const i18n = createI18n(props.initialLocale ?? "en");

  return (
    // @ts-ignore — SolidJS JSX provider typing
    <I18nContext.Provider value={i18n}>
      {props.children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within an <I18nProvider>");
  }
  return ctx;
}

// ── Language options helper ────────────────────────────────

/**
 * Returns an array of `{ value, label }` objects for a speech-recognition
 * language selector, translated via the supplied `t` function.
 */
export function getLanguageOptions(t: (key: string) => string) {
  return [
    { value: "auto", label: t("languages.auto") },
    { value: "nl", label: t("languages.nl") },
    { value: "en", label: t("languages.en") },
    { value: "de", label: t("languages.de") },
    { value: "fr", label: t("languages.fr") },
    { value: "es", label: t("languages.es") },
    { value: "it", label: t("languages.it") },
    { value: "pt", label: t("languages.pt") },
    { value: "pl", label: t("languages.pl") },
    { value: "ja", label: t("languages.ja") },
    { value: "zh", label: t("languages.zh") },
    { value: "ru", label: t("languages.ru") },
    { value: "uk", label: t("languages.uk") },
    { value: "tr", label: t("languages.tr") },
    { value: "ar", label: t("languages.ar") },
    { value: "ko", label: t("languages.ko") },
  ];
}
