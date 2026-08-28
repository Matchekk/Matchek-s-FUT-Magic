import { de } from "./locales/de.js";
import { en } from "./locales/en.js";

export const DEFAULT_LOCALE = "en";
export const SUPPORTED_LOCALES = Object.freeze(["en", "de"]);
const CATALOGS = Object.freeze({ en, de });
const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

export function normalizeLocale(locale) {
  const candidate = String(locale ?? DEFAULT_LOCALE).trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LOCALES.includes(candidate) ? candidate : DEFAULT_LOCALE;
}

export function translate(key, values = {}, { locale = DEFAULT_LOCALE } = {}) {
  if (typeof key !== "string" || !key.trim()) throw new TypeError("Translation key is required");
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new TypeError("Translation values must be an object");
  }
  const normalized = normalizeLocale(locale);
  const template = CATALOGS[normalized][key] ?? CATALOGS[DEFAULT_LOCALE][key];
  if (template == null) return key;
  return template.replace(PLACEHOLDER, (_match, name) => {
    if (!Object.hasOwn(values, name)) return `{${name}}`;
    const value = String(values[name]);
    if (value.length > 200) throw new RangeError(`Translation value ${name} is too long`);
    return value;
  });
}

export function getTranslationCatalog(locale = DEFAULT_LOCALE) {
  return Object.freeze({ ...CATALOGS[normalizeLocale(locale)] });
}
