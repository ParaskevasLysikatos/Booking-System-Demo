import { MONEY_LOCALES, currentLang } from './i18n/locale';

/**
 * Money display. The API has no currency field; the demo's properties are
 * in Greece, so everything is shown in euros. Change CURRENCY here and every
 * price in the app follows.
 *
 * The format follows the chosen language (TICKET-038): "€1,234.50" in
 * English, "1.234,50 €" in Greek. `formatPrice` reads the language signal,
 * so templates and `computed()`s that call it follow a switch.
 */
export const CURRENCY = 'EUR';

const formats = new Map<string, { whole: Intl.NumberFormat; cents: Intl.NumberFormat }>();

function moneyFormats() {
  const locale = MONEY_LOCALES[currentLang()];
  let f = formats.get(locale);
  if (!f) {
    f = {
      whole: new Intl.NumberFormat(locale, { style: 'currency', currency: CURRENCY, maximumFractionDigits: 0 }),
      cents: new Intl.NumberFormat(locale, { style: 'currency', currency: CURRENCY, minimumFractionDigits: 2 }),
    };
    formats.set(locale, f);
  }
  return f;
}

/** "91.00" -> "€91" / "91 €", "95.50" -> "€95.50" / "95,50 €" (API decimals arrive as strings). */
export function formatPrice(amount: string | number): string {
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value)) return '';
  const f = moneyFormats();
  return Number.isInteger(value) ? f.whole.format(value) : f.cents.format(value);
}
