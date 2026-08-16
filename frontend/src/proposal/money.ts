/**
 * Деньги и числа сметы — через Intl, как даты в i18n/dates.
 *
 * Свой форматтер, а не toFixed: разряды и десятичный знак зависят от языка
 * читателя, и «1,500.00» на русском экране читается как полторы единицы.
 */

export function formatAmount(locale: string, value: number): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}

export function formatMoney(locale: string, currency: string, value: number): string {
  // Код валюты — ввод человека, и до конца набора он не код: Intl на «EU»
  // поднимает RangeError, а смета не должна падать из-за недописанной буквы.
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${formatAmount(locale, value)} ${currency}`;
  }
}
