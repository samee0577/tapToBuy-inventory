import { formatMoney, formatQuantity } from '@inventory/shared';

/**
 * Presentation-only formatting.
 *
 * The API sends money as a decimal string and never a number, so every formatter
 * here takes a string. The point of the shared helpers is that the browser and the
 * server derive the same value from the same text: a displayed total that disagrees
 * with the ledger by a paisa is worse than one that is merely ugly.
 */

const CURRENCY = 'INR';
const LOCALE = 'en-IN';

/** A rupee amount, e.g. ₹1,234.50. */
export function money(value: string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return formatMoney(value, CURRENCY, LOCALE);
}

/**
 * A signed rupee amount, used for profit.
 *
 * The sign is carried by the number itself rather than a separate arrow, so a
 * column of mixed profits still lines up and the negative is unambiguous when read
 * aloud or copied into a spreadsheet.
 */
export function signedMoney(value: string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return formatMoney(value, CURRENCY, LOCALE);
}

/** True when a money string represents a loss, for colouring the figure. */
export function isNegativeMoney(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  return value.startsWith('-');
}

/** A unit count, grouped for the locale. */
export function quantity(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return formatQuantity(value);
}

const dateTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const dateFormatter = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium' });

/** An absolute timestamp, e.g. 4 Mar 2026, 14:05. */
export function dateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : dateTimeFormatter.format(parsed);
}

/** A calendar date with no time, for grouping a history feed by day. */
export function dateOnly(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : dateFormatter.format(parsed);
}

const RELATIVE_UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['week', 604_800_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

const relativeFormatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });

/**
 * A coarse "how long ago", for activity feeds.
 *
 * Coarse on purpose. On a screen someone glances at while walking past a shelf,
 * "2 hours ago" is the useful reading; seconds of precision is noise, and it would
 * make the list jitter as timers tick.
 */
export function relativeTime(value: string | null | undefined): string {
  if (!value) return '—';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';

  const elapsed = parsed.getTime() - Date.now();
  const magnitude = Math.abs(elapsed);

  for (const [unit, ms] of RELATIVE_UNITS) {
    if (magnitude >= ms) {
      return relativeFormatter.format(Math.round(elapsed / ms), unit);
    }
  }

  return 'just now';
}

/** The YYYY-MM-DD form a date-range filter sends back to the API. */
export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** The date N days ago, as a YYYY-MM-DD string. */
export function daysAgoInputValue(days: number): string {
  return toDateInputValue(new Date(Date.now() - days * 86_400_000));
}

/**
 * Initials for an avatar fallback, from a person's name.
 *
 * Takes the first letter of the first two words, skipping anything that is only
 * punctuation, so "A. B. Shah" does not render as "..".
 */
export function initials(name: string | null | undefined): string {
  if (!name) return '?';

  const parts = name
    .split(/\s+/)
    .map((part) => part.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);

  const letters = parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase());
  return letters.join('') || '?';
}
