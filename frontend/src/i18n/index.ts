import az from "./az.json";
import en from "./en.json";
import ru from "./ru.json";

export const SUPPORTED_LOCALES = ["az", "en", "ru"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Азербайджанский — язык по умолчанию и последняя опора при отсутствии ключа. */
export const DEFAULT_LOCALE: Locale = "az";

export type Params = Record<string, string | number>;

const DICTIONARIES: Record<Locale, unknown> = { az, en, ru };

// Правила выбора формы берутся у платформы, а не пишутся руками: русский
// различает три формы, и «если 1 то день иначе дней» ошибается на 2, 3, 4,
// 22 и далее.
const PLURAL_RULES: Record<Locale, Intl.PluralRules> = {
  az: new Intl.PluralRules("az"),
  en: new Intl.PluralRules("en"),
  ru: new Intl.PluralRules("ru"),
};

const PLURAL_FORMS = new Set(["zero", "one", "two", "few", "many", "other"]);

function isPluralEntry(value: object): boolean {
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => PLURAL_FORMS.has(key));
}

/**
 * Разворачивает вложенный словарь в плоский набор ключей. Запись со
 * множественным числом — один ключ, а не набор: у языков разное число форм,
 * и сравнивать словари по формам значило бы требовать от азербайджанского
 * русского `few`.
 */
export function flattenKeys(dictionary: object, prefix = ""): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(dictionary)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !isPluralEntry(value)) {
      Object.assign(flat, flattenKeys(value, path));
    } else {
      flat[path] = value;
    }
  }
  return flat;
}

function lookup(dictionary: unknown, key: string): unknown {
  let node: unknown = dictionary;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

function pick(value: unknown, locale: Locale, params?: Params): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && params && typeof params.count === "number") {
    const form = PLURAL_RULES[locale].select(params.count);
    const forms = value as Record<string, string>;
    return forms[form] ?? forms.other;
  }
  return undefined;
}

function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/**
 * Переводит машинный ключ в текст на языке читателя.
 *
 * Отсутствующий ключ не показывает пустоту: он падает на азербайджанский и
 * пишет предупреждение в консоль, а если его нет и там — возвращает сам ключ,
 * потому что видимый `auth.error.email_taken` чинится, а невидимая пустая
 * строка живёт в интерфейсе годами.
 */
export function translate(locale: Locale, key: string, params?: Params): string {
  const own = pick(lookup(DICTIONARIES[locale], key), locale, params);
  if (own !== undefined) return interpolate(own, params);

  console.warn(`i18n: ключ «${key}» отсутствует в словаре «${locale}»`);

  const fallback = pick(lookup(DICTIONARIES[DEFAULT_LOCALE], key), DEFAULT_LOCALE, params);
  if (fallback !== undefined) return interpolate(fallback, params);

  console.warn(`i18n: ключ «${key}» отсутствует во всех словарях`);
  return key;
}

export function isSupportedLocale(value: string | null | undefined): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
