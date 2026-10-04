import { z } from 'zod';

import { MONEY_SCALE, normalizeMoney } from '../money.js';

const MONEY_INPUT_PATTERN = /^\d{1,10}(?:\.\d{1,2})?$/;

/** Largest single price that fits Decimal(12,2) with room for multiplication. */
export const MAX_PRICE = '99999999.99';

/**
 * Accepts a decimal string or a JSON number and emits a canonical 2-decimal
 * string. Every downstream consumer treats money as a string; arithmetic goes
 * through the integer minor-unit helpers in ../money.ts, never via Number().
 */
export const moneySchema = z
  .union([z.string(), z.number().finite()])
  .transform((value, ctx) => {
    const raw = typeof value === 'number' ? value.toFixed(MONEY_SCALE) : value.trim();

    if (!MONEY_INPUT_PATTERN.test(raw)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Must be a non-negative amount with at most 2 decimal places',
      });
      return z.NEVER;
    }

    return normalizeMoney(raw);
  });

export const priceSchema = z
  .union([z.string(), z.number().finite()])
  .transform((value, ctx) => {
    const raw = typeof value === 'number' ? value.toFixed(MONEY_SCALE) : value.trim();

    if (!MONEY_INPUT_PATTERN.test(raw) || Number(raw) > 99_999_999) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Price must be between 0.00 and 99,999,999.99 with at most 2 decimal places',
      });
      return z.NEVER;
    }

    return normalizeMoney(raw);
  });
