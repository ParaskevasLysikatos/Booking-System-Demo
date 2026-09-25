/**
 * Money display. The API has no currency field; the demo's properties are
 * in Greece, so everything is shown in euros. Change CURRENCY/LOCALE here
 * and every price in the app follows.
 */
export const CURRENCY = 'EUR';
const LOCALE = 'en-IE'; // "€1,234.50"

const whole = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY, maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY, minimumFractionDigits: 2 });

/** "91.00" -> "€91", "95.50" -> "€95.50" (API decimals arrive as strings). */
export function formatPrice(amount: string | number): string {
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value)) return '';
  return Number.isInteger(value) ? whole.format(value) : cents.format(value);
}
