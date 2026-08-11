import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  translate,
  type Locale,
  type Params,
} from "./index";

const STORAGE_KEY = "flowline.locale";

type LocaleContextValue = {
  locale: Locale;
  /** Явный выбор человека: запоминается и побеждает всё остальное. */
  setLocale: (locale: Locale) => void;
  /**
   * Язык из профиля вошедшего. Не спорит с выбором человека: если тот уже
   * выбрал язык руками, профиль его не перебивает — иначе переключатель в
   * шапке работал бы ровно до перезагрузки страницы.
   */
  adoptProfileLocale: (locale: string) => void;
  t: (key: string, params?: Params) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function storedChoice(): Locale | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isSupportedLocale(value) ? value : null;
  } catch {
    // Приватный режим браузера умеет запрещать localStorage. Язык при этом
    // просто не запоминается между сессиями — это не повод падать.
    return null;
  }
}

function fromBrowser(): Locale | null {
  // Инвариантный toLowerCase: в азербайджанской локали `toLocaleLowerCase`
  // превращает `I` в `ı`, и сравнение кодов языков начинает вести себя
  // по-разному у разных людей.
  const tag = navigator.language?.split("-")[0]?.toLowerCase();
  return isSupportedLocale(tag) ? tag : null;
}

export function LocaleProvider({
  children,
  initial,
}: {
  children: ReactNode;
  initial?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(
    () => initial ?? storedChoice() ?? fromBrowser() ?? DEFAULT_LOCALE,
  );

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // см. storedChoice()
    }
  }, []);

  const adoptProfileLocale = useCallback((next: string) => {
    if (!isSupportedLocale(next)) return;
    if (storedChoice() !== null) return;
    setLocaleState(next);
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      adoptProfileLocale,
      t: (key, params) => translate(locale, key, params),
    }),
    [locale, setLocale, adoptProfileLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (value === null) {
    throw new Error("useLocale вызван вне LocaleProvider");
  }
  return value;
}
