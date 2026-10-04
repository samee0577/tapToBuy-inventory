import { z } from 'zod';

import { MAX_MOVEMENT_QUANTITY } from '../constants/stock.js';
import { priceSchema } from './money.js';

/**
 * Sizes and colours are free text, but canonicalised on write so that "black",
 * "BLACK" and " Black " cannot fragment the filter dropdowns (§ C6). No lookup
 * tables: distinct values are derived from the variants table itself.
 */
export const sizeSchema = z
  .string()
  .trim()
  .min(1, 'Size is required')
  .max(20, 'Size must be at most 20 characters')
  .transform((value) => value.toUpperCase());

export const colorSchema = z
  .string()
  .trim()
  .min(1, 'Colour is required')
  .max(40, 'Colour must be at most 40 characters')
  .transform((value) =>
    value
      .toLowerCase()
      .replace(/(^|[\s\-/])([a-z])/g, (_match, boundary: string, letter: string) =>
        `${boundary}${letter.toUpperCase()}`,
      ),
  );

export const initialStockSchema = z
  .number()
  .int('Initial stock must be a whole number')
  .min(0, 'Initial stock cannot be negative')
  .max(MAX_MOVEMENT_QUANTITY, `Initial stock cannot exceed ${MAX_MOVEMENT_QUANTITY}`)
  .default(0);

export const createVariantSchema = z.object({
  size: sizeSchema,
  color: colorSchema,
  buyingPrice: priceSchema,
  sellingPrice: priceSchema,
  initialStock: initialStockSchema,
});

export type CreateVariantInput = z.infer<typeof createVariantSchema>;

export const updateVariantSchema = z
  .object({
    size: sizeSchema.optional(),
    color: colorSchema.optional(),
    buyingPrice: priceSchema.optional(),
    sellingPrice: priceSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  })
  .refine(
    (value) => value.buyingPrice === undefined || value.sellingPrice !== undefined,
    { message: 'Provide sellingPrice when changing buyingPrice', path: ['sellingPrice'] },
  );

export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;
