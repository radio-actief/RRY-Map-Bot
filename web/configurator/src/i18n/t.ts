import en from "./en.json";

const messages = en as Record<string, string>;
const warned = new Set<string>();
const plural = new Intl.PluralRules("en");

/** Translate a key: `{name}` interpolation, `key_one` / `key_other` when params.count is given. */
export function t(key: string, params?: Record<string, string | number>): string {
  let text: string | undefined;
  if (params && typeof params.count === "number") {
    text = messages[`${key}_${plural.select(params.count)}`];
  }
  text ??= messages[key];
  if (text === undefined) {
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`Missing translation: ${key}`);
    }
    return key;
  }
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

/** Whether en.json holds this key (for optional texts such as a field's longer help). */
export const hasText = (key: string): boolean => key in messages;
