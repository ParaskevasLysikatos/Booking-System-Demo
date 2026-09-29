import { parseIsoDate } from '../dates';
import { LOCALES, currentLang } from './locale';

/**
 * Dates and numbers in the chosen language (TICKET-038 step 2).
 *
 * Every helper reads the language signal, so a template or `computed()`
 * that uses one follows a switch without extra code. Formatters are built
 * once per language + style and reused (building an `Intl` formatter is the
 * slow part).
 *
 *                     English (en-GB)       Greek (el-GR)
 *   full              Wed, 10 Mar 2027      Τετ 10 Μαρ 2027
 *   medium            10 Mar 2027           10 Μαρ 2027
 *   dayMonth          10 Mar                10 Μαρ
 *   weekdayDayMonth   Wed 10 Mar            Τετ 10 Μαρ
 *   monthYear         March 2027            Μάρτιος 2027
 *   month             March                 Μαρτίου  (genitive: "έναντι Μαρτίου")
 *   monthShort        Mar                   Μαρ
 *   day               10                    10
 *   time              15:05                 15:05    (24-hour in both)
 */
export const DATE_STYLES = {
  full: { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' },
  medium: { day: 'numeric', month: 'short', year: 'numeric' },
  dayMonth: { day: 'numeric', month: 'short' },
  weekdayDayMonth: { weekday: 'short', day: 'numeric', month: 'short' },
  monthYear: { month: 'long', year: 'numeric' },
  month: { month: 'long' },
  monthShort: { month: 'short' },
  day: { day: 'numeric' },
  // el-GR defaults to a 12-hour clock ("03:05 μ.μ."); the app shows 24-hour times.
  time: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

export type DateStyle = keyof typeof DATE_STYLES;

const dateFormats = new Map<string, Intl.DateTimeFormat>();

function dateFormat(style: DateStyle): Intl.DateTimeFormat {
  const locale = LOCALES[currentLang()];
  const key = `${locale}|${style}`;
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, DATE_STYLES[style]);
    dateFormats.set(key, format);
  }
  return format;
}

/**
 * A date in the chosen language.
 * - a `Date` is used as it is
 * - `'YYYY-MM-DD'` (the API's date-only values) is read as a *local* date, so
 *   it never shifts a day in Greece's UTC+2/+3
 * - any other string is an ISO timestamp (`created_at`, `expires_at`, ...)
 * An unreadable value gives `''` rather than "Invalid Date".
 */
export function formatDate(value: Date | string, style: DateStyle = 'medium'): string {
  const date = typeof value === 'string' ? (parseIsoDate(value) ?? new Date(value)) : value;
  if (Number.isNaN(date.getTime())) return '';
  return dateFormat(style).format(date);
}

/** "15:05" (24-hour) in the chosen language's style. */
export function formatTime(value: Date | string): string {
  return formatDate(value, 'time');
}

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const locale = LOCALES[currentLang()];
  const cacheKey = `${locale}|${key}`;
  let format = numberFormats.get(cacheKey);
  if (!format) {
    format = new Intl.NumberFormat(locale, options);
    numberFormats.set(cacheKey, format);
  }
  return format;
}

/** A number with exactly `decimals` decimals: 4.7 -> "4.7" / "4,7"; 12345 -> "12,345" / "12.345". */
export function formatNumber(value: number, decimals = 0): string {
  return numberFormat(`n${decimals}`, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}

/** A rate (0..1) as a percentage: 0.125 -> "12.5%" / "12,5%". */
export function formatPercent(rate: number, decimals = 1): string {
  return numberFormat(`p${decimals}`, { style: 'percent', minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(rate);
}
