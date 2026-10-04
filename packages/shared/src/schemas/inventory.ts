import { z } from 'zod';

import { InventoryMovementType } from '../domain.js';
import { MAX_MOVEMENT_QUANTITY, MAX_STOCK_QUANTITY } from '../constants/stock.js';
import { isoDateSchema, paginationSchema, searchTermSchema, uuidSchema } from './common.js';

const noteSchema = z.string().trim().max(280, 'Note must be at most 280 characters').optional();

const reasonSchema = z
  .string()
  .trim()
  .min(2, 'A reason is required')
  .max(200, 'Reason must be at most 200 characters');

/**
 * §16 Rule 2: movement quantity is always a positive integer magnitude. The
 * direction of an ADJUSTMENT is therefore derived from newStock - previousStock
 * rather than stored as a signed number, which keeps the invariant uniform
 * across all four movement types.
 */
const quantitySchema = z
  .number()
  .int('Quantity must be a whole number')
  .min(1, 'Quantity must be at least 1')
  .max(MAX_MOVEMENT_QUANTITY, `Quantity cannot exceed ${MAX_MOVEMENT_QUANTITY}`);

export const stockInSchema = z.object({
  quantity: quantitySchema,
  reason: reasonSchema.optional(),
  note: noteSchema,
});

export type StockInInput = z.infer<typeof stockInSchema>;

export const saleSchema = z.object({
  quantity: quantitySchema,
  note: noteSchema,
});

export type SaleInput = z.infer<typeof saleSchema>;

export const returnSchema = z.object({
  quantity: quantitySchema,
  reason: reasonSchema.optional(),
  note: noteSchema,
});

export type ReturnInput = z.infer<typeof returnSchema>;

/**
 * Either restate the counted quantity (`newStock`, the usual "I counted the
 * shelf" case) or apply a signed correction (`delta`). Exactly one is required,
 * and a reason is mandatory because adjustments silently rewrite the ledger's
 * meaning if unexplained.
 */
export const adjustmentSchema = z
  .object({
    newStock: z.number().int().min(0).max(MAX_STOCK_QUANTITY).optional(),
    delta: z.number().int().min(-MAX_MOVEMENT_QUANTITY).max(MAX_MOVEMENT_QUANTITY).optional(),
    reason: reasonSchema,
    note: noteSchema,
  })
  .refine((value) => (value.newStock === undefined) !== (value.delta === undefined), {
    message: 'Provide exactly one of newStock or delta',
    path: ['newStock'],
  })
  .refine((value) => value.delta === undefined || value.delta !== 0, {
    message: 'Adjustment would not change stock',
    path: ['delta'],
  });

export type AdjustmentInput = z.infer<typeof adjustmentSchema>;

export const movementSortSchema = z.enum(['createdAt', 'quantity', 'type', 'product']);
export const variantSortSchema = z.enum([
  'productName',
  'productCode',
  'size',
  'color',
  'stockQuantity',
  'sellingPrice',
  'buyingPrice',
  'createdAt',
  'updatedAt',
]);

export const listMovementsQuerySchema = paginationSchema
  .extend({
    productId: uuidSchema.optional(),
    variantId: uuidSchema.optional(),
    categoryId: uuidSchema.optional(),
    type: z.nativeEnum(InventoryMovementType).optional(),
    performedById: uuidSchema.optional(),
    search: searchTermSchema,
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    sortBy: movementSortSchema.default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  })
  .refine((value) => !value.from || !value.to || new Date(value.from) <= new Date(value.to), {
    message: '`from` must be on or before `to`',
    path: ['from'],
  });

export type ListMovementsQuery = z.infer<typeof listMovementsQuerySchema>;

export const listInventoryQuerySchema = paginationSchema.extend({
  search: searchTermSchema,
  categoryId: uuidSchema.optional(),
  size: z.string().trim().min(1).max(20).transform((v) => v.toUpperCase()).optional(),
  color: z.string().trim().min(1).max(40).optional(),
  stockStatus: z.enum(['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK']).optional(),
  status: z.enum(['all', 'active', 'inactive']).default('active'),
  sortBy: variantSortSchema.default('updatedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type ListInventoryQuery = z.infer<typeof listInventoryQuerySchema>;

export const dashboardRangeSchema = z.enum(['7d', '30d', '90d']);
export type DashboardRange = z.infer<typeof dashboardRangeSchema>;

export const RANGE_TO_DAYS: Record<DashboardRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};
