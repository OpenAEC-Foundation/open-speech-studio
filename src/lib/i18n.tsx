import { createSignal, createContext, useContext, type JSX } from "solid-js";
import nl from "../locales/nl";
import en from "../locales/en";
import de from "../locales/de";
import fr from "../locales/fr";
import es from "../locales/es";
import pt from "../locales/pt";
import zh from "../locales/zh";
import ja from "../locales/ja";
import pl from "../locales/pl";
import tr from "../locales/tr";
import ko from "../locales/ko";
import it from "../locales/it";
import ru from "../locales/ru";
import uk from "../locales/uk";
import cs from "../locales/cs";
import ro from "../locales/ro";
import hu from "../locales/hu";
import sv from "../locales/sv";
import da from "../locales/da";
import no from "../locales/no";
import fi from "../locales/fi";
import el from "../locales/el";
import bg from "../locales/bg";
import hr from "../locales/hr";
import sk from "../locales/sk";

// ── Types ──────────────────────────────────────────────────
export type Locale = "nl" | "en" | "de" | "fr" | "es" | "pt" | "zh" | "ja" | "pl" | "tr" | "ko" | "it" | "ru" | "uk" | "cs" | "ro" | "hu" | "sv" | "da" | "no" | "fi" | "el" | "bg" | "hr" | "sk";

type Translations = Record<string, string>;

const locales: Record<Locale, Translations> = { nl, en, de, fr, es, pt, zh, ja, pl, tr, ko, it, ru, uk, cs, ro, hu, sv, da, no, fi, el, bg, hr, sk };

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
      key;

    if (params) {
      for (const [k, v] of Object.entries(params)) {
        value = value.replaceAll(`{${k}}`, String(v));
      }
    }

    return value;
  };

  const availableLocales: Locale[] = ["en", "nl", "de", "fr", "es", "pt", "it", "pl", "ru", "tr", "zh", "ja", "ko", "uk", "cs", "ro", "hu", "sv", "da", "no", "fi", "el", "bg", "hr", "sk"];

  return { t, locale, setLocale, availableLocales };
}

// ── Standalone t() for use outside components ─────────────

let _sharedI18n: ReturnType<typeof createI18n> | null = null;

/**
 * Standalone translation function for use outside SolidJS components
 * (e.g. in api.ts, utility modules). Uses the same locale as the provider.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  if (!_sharedI18n) _sharedI18n = createI18n("en");
  return _sharedI18n.t(key, params);
}

// ── Context / Provider / Hook ──────────────────────────────

type I18nValue = ReturnType<typeof createI18n>;

export const I18nContext = createContext<I18nValue>();

interface I18nProviderProps {
  initialLocale?: Locale;
  children: JSX.Element;
}

export function I18nProvider(props: I18nProviderProps) {
  // Re-use the shared singleton so standalone t() stays in sync
  if (!_sharedI18n) _sharedI18n = createI18n(props.initialLocale ?? "en");
  else if (props.initialLocale) _sharedI18n.setLocale(props.initialLocale);
  const i18n = _sharedI18n;

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
// Native script names for each language (constant, never translated)
const nativeNames: Record<string, string> = {
  af: "Afrikaans", am: "\u12A0\u121B\u122D\u129B", ar: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629",
  as: "\u0985\u09B8\u09AE\u09C0\u09AF\u09BC\u09BE", az: "Az\u0259rbaycanca", ba: "\u0411\u0430\u0448\u04A1\u043E\u0440\u0442",
  be: "\u0411\u0435\u043B\u0430\u0440\u0443\u0441\u043A\u0430\u044F", bg: "\u0411\u044A\u043B\u0433\u0430\u0440\u0441\u043A\u0438",
  bn: "\u09AC\u09BE\u0982\u09B2\u09BE", bo: "\u0F56\u0F7C\u0F51\u0F0B\u0F66\u0F90\u0F51",
  br: "Brezhoneg", bs: "Bosanski", ca: "Catal\u00E0", cs: "\u010Ce\u0161tina",
  cy: "Cymraeg", da: "Dansk", de: "Deutsch", el: "\u0395\u03BB\u03BB\u03B7\u03BD\u03B9\u03BA\u03AC",
  en: "English", es: "Espa\u00F1ol", et: "Eesti", eu: "Euskara",
  fa: "\u0641\u0627\u0631\u0633\u06CC", fi: "Suomi", fo: "F\u00F8royskt", fr: "Fran\u00E7ais",
  gl: "Galego", gu: "\u0A97\u0AC1\u0A9C\u0AB0\u0ABE\u0AA4\u0AC0", ha: "Hausa",
  haw: "\u02BBOlelo Hawai\u02BBi", he: "\u05E2\u05D1\u05E8\u05D9\u05EA",
  hi: "\u0939\u093F\u0928\u094D\u0926\u0940", hr: "Hrvatski",
  ht: "Krey\u00F2l Ayisyen", hu: "Magyar", hy: "\u0540\u0561\u0575\u0565\u0580\u0565\u0576",
  id: "Bahasa Indonesia", is: "\u00CDslenska", it: "Italiano",
  ja: "\u65E5\u672C\u8A9E", jw: "Basa Jawa", ka: "\u10E5\u10D0\u10E0\u10D7\u10E3\u10DA\u10D8",
  kk: "\u049A\u0430\u0437\u0430\u049B", km: "\u1781\u17D2\u1798\u17C2\u179A",
  kn: "\u0C95\u0CA8\u0CCD\u0CA8\u0CA1", ko: "\uD55C\uAD6D\uC5B4", la: "Latina",
  lb: "L\u00EBtzebuergesch", ln: "Ling\u00E1la", lo: "\u0EA5\u0EB2\u0EA7",
  lt: "Lietuvi\u0173", lv: "Latvie\u0161u", mg: "Malagasy",
  mi: "Te Reo M\u0101ori", mk: "\u041C\u0430\u043A\u0435\u0434\u043E\u043D\u0441\u043A\u0438",
  ml: "\u0D2E\u0D32\u0D2F\u0D3E\u0D33\u0D02", mn: "\u041C\u043E\u043D\u0433\u043E\u043B",
  mr: "\u092E\u0930\u093E\u0920\u0940", ms: "Bahasa Melayu", mt: "Malti",
  my: "\u1019\u103C\u1014\u103A\u1019\u102C", ne: "\u0928\u0947\u092A\u093E\u0932\u0940",
  nl: "Nederlands", nn: "Nynorsk", no: "Norsk", oc: "Occitan",
  pa: "\u0A2A\u0A70\u0A1C\u0A3E\u0A2C\u0A40", pl: "Polski", ps: "\u067E\u069A\u062A\u0648",
  pt: "Portugu\u00EAs", ro: "Rom\u00E2n\u0103", ru: "\u0420\u0443\u0441\u0441\u043A\u0438\u0439",
  sa: "\u0938\u0902\u0938\u094D\u0915\u0943\u0924\u092E\u094D", sd: "\u0633\u0646\u068C\u064A",
  si: "\u0DC3\u0DD2\u0D82\u0DC4\u0DBD", sk: "Sloven\u010Dina", sl: "Sloven\u0161\u010Dina",
  sn: "ChiShona", so: "Soomaali", sq: "Shqip",
  sr: "\u0421\u0440\u043F\u0441\u043A\u0438", su: "Basa Sunda", sv: "Svenska",
  sw: "Kiswahili", ta: "\u0BA4\u0BAE\u0BBF\u0BB4\u0BCD", te: "\u0C24\u0C46\u0C32\u0C41\u0C17\u0C41",
  tg: "\u0422\u043E\u04B7\u0438\u043A\u04E3", th: "\u0E44\u0E17\u0E22",
  tk: "T\u00FCrkmen", tl: "Tagalog", tr: "T\u00FCrk\u00E7e",
  tt: "\u0422\u0430\u0442\u0430\u0440", uk: "\u0423\u043A\u0440\u0430\u0457\u043D\u0441\u044C\u043A\u0430",
  ur: "\u0627\u0631\u062F\u0648", uz: "O\u02BBzbek", vi: "Ti\u1EBFng Vi\u1EC7t",
  yi: "\u05D9\u05D9\u05D3\u05D9\u05E9", yo: "Yor\u00F9b\u00E1",
  yue: "\u7CB5\u8A9E", zh: "\u4E2D\u6587",
};

export function getLanguageOptions(t: (key: string) => string) {
  const codes = Object.keys(nativeNames);
  const langs = codes.map((c) => {
    const translated = t(`languages.${c}`);
    const native = nativeNames[c];
    // If the translated name is the same as the native name, don't repeat it
    const label = translated === native ? translated : `${translated} (${native})`;
    return { value: c, label };
  });
  langs.sort((a, b) => a.label.localeCompare(b.label));
  return [{ value: "auto", label: t("languages.auto") }, ...langs];
}
