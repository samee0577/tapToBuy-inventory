/**
 * Money on the wire is a decimal *string* ("749.00"), never a JSON number.
 * JSON numbers are IEEE-754 doubles, which cannot represent 0.1 exactly; using
 * them for currency reintroduces the float error that PostgreSQL `numeric`
 * exists to avoid. The frontend and backend both parse with these helpers.
 */
export const MONEY_SCALE = 2;

const MONEY_PATTERN = /^\d{1,10}(?:\.\d{1,2})?$/;

export type MoneyInput = string | number;

export function isMoneyString(value: string): boolean {
  return MONEY_PATTERN.test(value);
}

/** Canonicalises any accepted money input to a fixed 2-decimal string. */
export function normalizeMoney(value: MoneyInput): string {
  const raw = typeof value === 'number' ? value.toFixed(MONEY_SCALE) : value.trim();

  if (!MONEY_PATTERN.test(raw)) {
    throw new RangeError(`Invalid money value: ${String(value)}`);
  }

  const separatorIndex = raw.indexOf('.');
  const whole = separatorIndex === -1 ? raw : raw.slice(0, separatorIndex);
  const fraction = separatorIndex === -1 ? '' : raw.slice(separatorIndex + 1);

  return `${whole}.${fraction.padEnd(MONEY_SCALE, '0')}`;
}

export function assertMoney(value: MoneyInput): string {
  const normalized = normalizeMoney(value);
  if (!isMoneyString(normalized)) {
    throw new RangeError(`Invalid money value: ${String(value)}`);
  }
  return normalized;
}

/**
 * Converts a money string to integer minor units (paise). All money arithmetic
 * in this codebase runs on integers, so no rounding error can accumulate.
 */
export function toMinorUnits(value: MoneyInput): number {
  const normalized = normalizeMoney(value);
  const separatorIndex = normalized.indexOf('.');
  const whole = Number(normalized.slice(0, separatorIndex));
  const fraction = Number(normalized.slice(separatorIndex + 1));
  return whole * 100 + fraction;
}

export function fromMinorUnits(minorUnits: number): string {
  if (!Number.isSafeInteger(minorUnits)) {
    throw new RangeError(`Money overflow: ${minorUnits}`);
  }
  const sign = minorUnits < 0 ? '-' : '';
  const absolute = Math.abs(minorUnits);
  const whole = Math.floor(absolute / 100);
  const fraction = absolute % 100;
  return `${sign}${whole}.${String(fraction).padStart(MONEY_SCALE, '0')}`;
}

export function addMoney(a: MoneyInput, b: MoneyInput): string {
  return fromMinorUnits(toMinorUnits(a) + toMinorUnits(b));
}

export function subtractMoney(a: MoneyInput, b: MoneyInput): string {
  return fromMinorUnits(toMinorUnits(a) - toMinorUnits(b));
}

export function multiplyMoney(value: MoneyInput, quantity: number): string {
  if (!Number.isSafeInteger(quantity)) {
    throw new RangeError(`Quantity must be a safe integer: ${quantity}`);
  }
  return fromMinorUnits(toMinorUnits(value) * quantity);
}

/** Unit profit = selling - buying. Negative results are returned as-is. */
export function unitProfit(sellingPrice: MoneyInput, buyingPrice: MoneyInput): string {
  return subtractMoney(sellingPrice, buyingPrice);
}

const currencyFormatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(value: MoneyInput, currency = 'INR', locale = 'en-IN'): string {
  const key = `${locale}:${currency}`;
  let formatter = currencyFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
    currencyFormatters.set(key, formatter);
  }
  return formatter.format(toMinorUnits(value) / 100);
}

export function formatQuantity(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value);
}
