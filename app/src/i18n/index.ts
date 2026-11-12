// The language of the UI. It is chosen once, when the app starts: the language saved by the switch in the masthead,
// otherwise the first language of the system (or the browser) that the app has, and English when it has none of them.
// Changing it saves the choice and reloads the window, so nothing in the app has to react to a language change while
// it runs.

import { saveSnapshot } from "../restore";
import { de } from "./de";
import { en, type Strings } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { id } from "./id";
import { it } from "./it";
import { ja } from "./ja";
import { ko } from "./ko";
import { tr } from "./tr";
import { zhCN } from "./zh-CN";

/**
 * The languages of the UI: the text of each, and the tag its dates and numbers are formatted by (see `format.ts`).
 * English takes British conventions, as FM is British.
 */
const LANGUAGES = {
  en: { strings: en, intl: "en-GB" },
  tr: { strings: tr, intl: "tr-TR" },
  es: { strings: es, intl: "es-ES" },
  de: { strings: de, intl: "de-DE" },
  fr: { strings: fr, intl: "fr-FR" },
  id: { strings: id, intl: "id-ID" },
  it: { strings: it, intl: "it-IT" },
  ja: { strings: ja, intl: "ja-JP" },
  ko: { strings: ko, intl: "ko-KR" },
  "zh-CN": { strings: zhCN, intl: "zh-CN" },
} satisfies Record<string, { strings: Strings; intl: string }>;

export type Locale = keyof typeof LANGUAGES;

/** Where the chosen language is kept. */
const STORAGE_KEY = "fmlibre.locale";

/** Whether `value` names one of the languages of the UI. */
function isLocale(value: string | null | undefined): value is Locale {
  return value != null && Object.prototype.hasOwnProperty.call(LANGUAGES, value);
}

/** The language the user chose earlier; null when none is saved, or when the storage cannot be read. */
function savedLocale(): Locale | null {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(saved) ? saved : null;
  } catch {
    return null;
  }
}

/**
 * The first of the system's languages, most preferred first, that the app has: "es-MX" is Spanish, "tr" Turkish,
 * "id-ID" Indonesian, "ja-JP" Japanese, "ko-KR" Korean, and "zh", "zh-CN", "zh-SG" or "zh-Hans" Simplified Chinese. Traditional Chinese
 * ("zh-TW", "zh-HK", "zh-Hant") is not taken for it: English reads better than the other script. English when it has
 * none of them. WebView2 lists the languages of Windows; WKWebView only the first one of macOS.
 */
function systemLocale(): Locale {
  const { languages, language } = window.navigator;
  for (const tag of languages?.length ? languages : [language]) {
    const normalized = tag?.replace(/_/g, "-").toLowerCase();
    if (
      normalized === "zh" ||
      normalized === "zh-cn" ||
      normalized?.startsWith("zh-cn-") ||
      normalized === "zh-sg" ||
      normalized === "zh-hans" ||
      normalized?.startsWith("zh-hans-")
    ) {
      return "zh-CN";
    }
    const primary = normalized?.split("-")[0];
    if (isLocale(primary)) {
      return primary;
    }
  }
  return "en";
}

/** The language of this run. */
export const locale: Locale = savedLocale() ?? systemLocale();

/** The text of the language in use. `labels.ts` hands it out to the components. */
export const strings: Strings = LANGUAGES[locale].strings;

/** The tag dates and numbers are formatted by (see `format.ts`). */
export const intlLocale: string = LANGUAGES[locale].intl;

// Browsers use the language of the page for hyphenation, spell checking and upper-casing: the dotted İ of the table
// headers, which are upper-cased by the style sheet, depends on it.
document.documentElement.lang = locale;

/**
 * Makes `next` the language and reloads the window to apply it. The choice is saved first, so that the reload picks
 * it up; when it cannot be saved the window is left alone, as the reload would only bring the old language back. What
 * the window shows is saved too, so that the app comes back where it was (see `restore.ts`). Callers that have edits
 * pending ask the user first (see `askToLeave`).
 */
export function setLocale(next: Locale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    return;
  }
  saveSnapshot();
  window.location.reload();
}
