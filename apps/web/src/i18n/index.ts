/**
 * The builder's own screen texts (not package texts). One JSON file per
 * language with the same keys; `messages.test.ts` keeps them in step.
 *
 * Placeholders are `{name}`. Counted texts have `.one` and `.other` keys
 * and are read with `tc`.
 */
import de from "./messages/de.json";
import en from "./messages/en.json";
import es from "./messages/es.json";
import fr from "./messages/fr.json";
import it from "./messages/it.json";

export const UI_LANGUAGES = ["de", "en", "fr", "it", "es"] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: UiLanguage = "de";

/**
 * Remembers the language chosen before login. Functional only; nothing
 * else is stored. Lives here, not in a client module: the server reads it
 * for the first paint, and a value imported from a "use client" file is
 * only a reference on the server, never the string.
 */
export const LANGUAGE_COOKIE = "lang";

/**
 * Each language named in itself. The only place where a word of another
 * language may appear on screen: whoever switched by mistake must find
 * their own language again. Shown with a matching `lang` attribute.
 */
export const LANGUAGE_NAMES: Record<UiLanguage, string> = {
  de: "Deutsch",
  en: "English",
  fr: "Français",
  it: "Italiano",
  es: "Español",
};

export type MessageKey = keyof typeof de;
type Base<K> = K extends `${infer B}.one` ? B : never;
export type CountedKey = Base<MessageKey>;
export type Vars = Readonly<Record<string, string | number>>;

export const MESSAGES: Record<UiLanguage, Record<MessageKey, string>> = { de, en, fr, it, es };

export function isUiLanguage(value: unknown): value is UiLanguage {
  return typeof value === "string" && (UI_LANGUAGES as readonly string[]).includes(value);
}

/** The first supported language of an Accept-Language header, else the default. */
export function pickLanguage(acceptLanguage: string | null | undefined): UiLanguage {
  for (const part of (acceptLanguage ?? "").split(",")) {
    const tag = part.split(";")[0]?.trim().toLowerCase().split("-")[0];
    if (isUiLanguage(tag)) return tag;
  }
  return DEFAULT_LANGUAGE;
}

export function formatNumber(lang: string, n: number): string {
  return new Intl.NumberFormat(lang).format(n);
}

/** French words that lose their vowel before one: "de Armure" is "d’Armure", "le Écu" is "l’Écu". */
const ELIDED: Record<string, string> = {
  de: "d",
  De: "D",
  le: "l",
  Le: "L",
  la: "l",
  La: "L",
  que: "qu",
  Que: "Qu",
};

/**
 * French elision where a placeholder meets a word of the template: the
 * package's word is only known when filled. A word starting with "h" keeps
 * its "de" ("de Hache"): the rule depends on the word, and a missing
 * apostrophe reads better than a wrong one.
 */
function elide(template: string, lang: string, vars: Vars): string {
  if (lang !== "fr") return template;
  return template.replace(
    /(^|[^\p{L}’'])(de|De|le|Le|la|La|que|Que) \{(\w+)\}/gu,
    (whole, before: string, word: string, name: string) => {
      const v = vars[name];
      return typeof v === "string" && /^[aeiouàâäéèêëîïôöùûüœæ]/iu.test(v)
        ? `${before}${ELIDED[word]}’{${name}}`
        : whole;
    },
  );
}

/**
 * Fills the placeholders. A text that starts with one starts with a capital:
 * a word put in small for the middle of a sentence ("level") may open one.
 */
export function fill(template: string, lang: string, vars: Vars = {}, capital = true): string {
  const out = elide(template, lang, vars).replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = vars[name];
    if (v === undefined) return whole;
    return typeof v === "number" ? formatNumber(lang, v) : v;
  });
  if (!capital || !template.startsWith("{") || out === "") return out;
  const first = String.fromCodePoint(out.codePointAt(0)!);
  return first.toLocaleUpperCase(lang) + out.slice(first.length);
}

export interface Translator {
  lang: UiLanguage;
  t(key: MessageKey, vars?: Vars): string;
  /** Counted text: `.one` for 1, `.other` otherwise; `{count}` is filled. */
  tc(key: CountedKey, count: number, vars?: Vars): string;
  /** "A, B und C" in the screen language. */
  list(items: readonly string[]): string;
}

export function translator(lang: UiLanguage): Translator {
  const messages = MESSAGES[lang];
  const t = (key: MessageKey, vars?: Vars) => fill(messages[key], lang, vars);
  return {
    lang,
    t,
    tc: (key, count, vars) =>
      fill(messages[`${key}.${count === 1 ? "one" : "other"}` as MessageKey], lang, { ...vars, count }),
    list: (items) => {
      if (items.length <= 1) return items[0] ?? "";
      const head = items.slice(0, -1).join(", ");
      // A piece of a sentence: no capital, whatever it starts with.
      return fill(messages["flow.and"], lang, { a: head, b: items.at(-1)! }, false);
    },
  };
}
