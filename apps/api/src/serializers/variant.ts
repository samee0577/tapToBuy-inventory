import { deriveStockStatus, isAdmin, type StockStatus, type UserRole } from '@inventory/shared';
import type { Prisma } from '@prisma/client';

import { toMoneyString } from '../lib/prisma.js';

/**
 * The variant columns a serialiser needs. Kept explicit so the shape of a
 * variant query is visible, and so a serialiser can never be handed a row missing
 * a field it would silently render as zero.
 */
export const VARIANT_SELECT = {
  id: true,
  productId: true,
  size: true,
  color: true,
  buyingPrice: true,
  sellingPrice: true,
  stockQuantity: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type VariantRow = Prisma.ProductVariantGetPayload<{ select: typeof VARIANT_SELECT }>;

function marginPercent(sellingPrice: Prisma.Decimal, unitProfit: Prisma.Decimal): string {
  // A zero selling price would make the percentage meaningless, and financial
  // output must never contain Infinity or NaN.
  if (sellingPrice.isZero()) return '0.00';
  return toMoneyString(unitProfit.dividedBy(sellingPrice).times(100));
}

/**
 * Serialises a variant for the given role.
 *
 * Financial fields are absent from a STAFF object entirely rather than
 * present-but-hidden. There is no key on the wire to redact later and no
 * controller that can forget to strip one: `buyingPrice` simply is not a property
 * of the object a Staff client receives.
 */
export function serializeVariant(
  variant: VariantRow,
  role: UserRole,
): Record<string, unknown> {
  const base = {
    id: variant.id,
    productId: variant.productId,
    size: variant.size,
    color: variant.color,
    sellingPrice: toMoneyString(variant.sellingPrice),
    stockQuantity: variant.stockQuantity,
    stockStatus: deriveStockStatus(variant.stockQuantity) satisfies StockStatus,
    isActive: variant.isActive,
    createdAt: variant.createdAt.toISOString(),
    updatedAt: variant.updatedAt.toISOString(),
  };

  if (!isAdmin(role)) return base;

  const unitProfit = variant.sellingPrice.minus(variant.buyingPrice);

  return {
    ...base,
    buyingPrice: toMoneyString(variant.buyingPrice),
    unitProfit: toMoneyString(unitProfit),
    marginPercent: marginPercent(variant.sellingPrice, unitProfit),
  };
}