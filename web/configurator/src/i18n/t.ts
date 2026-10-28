// Side effect: src/shared/i18n.js sets window.BEmeshI18n, the translation layer the tool pages share.
import "../../../../src/shared/i18n.js";
import { signal } from "@preact/signals";
import sharedEn from "../../../../src/shared/i18n/shared.en.json";
import en from "./en.json";

export type Lang = "en" | "nl" | "fr";
type Messages = Record<string, string>;
type Params = Record<string, string | number>;

type I18nApi = {
  LANGS: Lang[];
  NAMES: Record<Lang, string>;
  lang: Lang;
  dev: boolean;
  pick(o: { query?: string | null; stored?: string | null; browser?: string | null }): { lang: Lang; remember: boolean };
  detect(): Lang;
  t(key: string, params?: Params): string;
  has(key: string): boolean;
  textIn(lang: Lang, key: string): string | undefined;
  add(lang: Lang, dict: Messages): void;
  use(lang: Lang): void;
  onChange(fn: (lang: Lang) => void): () => void;
  choose(lang: string): void;
  switchTo: ((lang: Lang) => void) | null;
  number(n: number, opts?: Intl.NumberFormatOptions): string;
  date(d: Date | number | string, opts?: Intl.DateTimeFormatOptions): string;
  locale(): string;
  regionName(code: string): string;
  municipalityName(name: string): string;
};

export const I18N = (window as unknown as { BEmeshI18n: I18nApi }).BEmeshI18n;
I18N.dev = import.meta.env.DEV;
I18N.add("en", { ...(sharedEn as Messages), ...(en as Messages) });

/** The page language; components that call t() re-render when it changes. */
export const lang = signal<Lang>(I18N.lang);

const LOADERS: Record<Exclude<Lang, "en">, () => Promise<Messages>> = {
  nl: () =>
    Promise.all([import("../../../../src/shared/i18n/shared.nl.json"), import("./nl.json")]).then(([s, c]) => ({
      ...(s.default as Messages),
      ...(c.default as Messages),
    })),
  fr: () =>
    Promise.all([import("../../../../src/shared/i18n/shared.fr.json"), import("./fr.json")]).then(([s, c]) => ({
      ...(s.default as Messages),
      ...(c.default as Messages),
    })),
};
const loaded = new Set<Lang>(["en"]);

/** Loads a language's messages (once) and switches the page to it. */
export async function setLang(next: Lang): Promise<void> {
  if (!loaded.has(next)) {
    I18N.add(next, await LOADERS[next as Exclude<Lang, "en">]());
    loaded.add(next);
  }
  I18N.use(next);
  lang.value = next;
}

/** The ☰ menu's language switch re-renders the configurator instead of reloading it (the USB link stays open). */
I18N.switchTo = (next) => void setLang(next);

/** Translate a key: `{name}` interpolation, the language's plural form when params.count is a number. */
export function t(key: string, params?: Params): string {
  void lang.value;
  return I18N.t(key, params);
}

/** Whether a text exists for this key (for optional texts such as a field's longer help). */
export const hasText = (key: string): boolean => {
  void lang.value;
  return I18N.has(key);
};

/** A number in the page language. */
export const formatNumber = (n: number, opts?: Intl.NumberFormatOptions): string => {
  void lang.value;
  return I18N.number(n, opts);
};

/** Province, gewest or country name in the page language. */
export const regionName = (code: string): string => {
  void lang.value;
  return I18N.regionName(code);
};

/** A municipality's name in the page language where it has an official one (Brussels), else as given. */
export const municipalityName = (name: string): string => {
  void lang.value;
  return I18N.municipalityName(name);
};
