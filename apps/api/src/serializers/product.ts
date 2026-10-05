import {
  deriveStockStatus,
  isAdmin,
  type StockStatus,
  type UserRole,
} from '@inventory/shared';
import type { Prisma } from '@prisma/client';

import { toMoneyString } from '../lib/prisma.js';
import { serializeVariant, VARIANT_SELECT } from './variant.js';

/**
 * Everything the product list needs in one query. `variants` is included rather
 * than fetched separately because the list screen renders a card per product with
 * its variants (§19), and a second round trip per card is what makes an
 * inventory screen feel slow on a phone.
 */
export const PRODUCT_LIST_SELECT = {
  id: true,
  name: true,
  productCode: true,
  categoryId: true,
  imageKey: true,
  imageUrl: true,
  description: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true, role: true } },
  variants: { select: VARIANT_SELECT },
} as const;

export type ProductListRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_LIST_SELECT }>;
export type ProductDetailRow = ProductListRow;

/**
 * A product's stock status is derived from the total across its active variants.
 * Low-stock attention is a variant-level concern (§18 lists low-stock *variants*
 * and *items*), so aggregating here keeps the card honest without letting one
 * nearly-empty variant mark a well-stocked product as low.
 */
export interface SerializedProduct {
  id: string;
  name: string;
  productCode: string;
  categoryId: string;
  categoryName: string;
  imageKey: string | null;
  imageUrl: string | null;
  description: string | null;
  isActive: boolean;
  variantCount: number;
  totalStock: number;
  stockStatus: StockStatus;
  createdAt: string;
  updatedAt: string;
  variants: Record<string, unknown>[];
  createdBy?: { id: string; name: string; role: UserRole } | null;
}

export function serializeProduct(
  product: ProductListRow,
  role: UserRole,
  options?: { includeCreatedBy?: boolean },
): SerializedProduct {
  const activeVariants = product.variants.filter((variant) => variant.isActive);
  const totalStock = activeVariants.reduce((sum, variant) => sum + variant.stockQuantity, 0);

  return {
    id: product.id,
    name: product.name,
    productCode: product.productCode,
    categoryId: product.categoryId,
    categoryName: product.category.name,
    imageKey: product.imageKey,
    imageUrl: product.imageUrl,
    description: product.description,
    isActive: product.isActive,
    variantCount: activeVariants.length,
    totalStock,
    stockStatus: deriveStockStatus(totalStock),
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
    variants: activeVariants.map((variant) => serializeVariant(variant, role)),
    ...(options?.includeCreatedBy && isAdmin(role)
      ? { createdBy: product.createdBy }
      : {}),
  };
}

export interface PriceHistoryRow {
  id: string;
  variantId: string;
  oldBuyingPrice: Prisma.Decimal | null;
  newBuyingPrice: Prisma.Decimal;
  oldSellingPrice: Prisma.Decimal | null;
  newSellingPrice: Prisma.Decimal;
  changedAt: Date;
  changedBy: { id: string; name: string; role: UserRole };
}

/**
 * Price history is an ADMIN-only endpoint (§7, §27), so this serialiser has no
 * role parameter: it is unreachable for Staff by construction, guarded at the
 * router.
 *
 * `currentPrices` is passed in rather than joined onto each row because the
 * variant's live prices are not part of a history record.
 */
export function serializePriceHistory(
  rows: PriceHistoryRow[],
  variant: { id: string; size: string; color: string; currentPrices: { buyingPrice: Prisma.Decimal; sellingPrice: Prisma.Decimal } },
) {
  return {
    variantId: variant.id,
    size: variant.size,
    color: variant.color,
    currentBuyingPrice: toMoneyString(variant.currentPrices.buyingPrice),
    currentSellingPrice: toMoneyString(variant.currentPrices.sellingPrice),
    entries: rows.map((row) => ({
      id: row.id,
      variantId: row.variantId,
      oldBuyingPrice: row.oldBuyingPrice === null ? null : toMoneyString(row.oldBuyingPrice),
      newBuyingPrice: toMoneyString(row.newBuyingPrice),
      oldSellingPrice: row.oldSellingPrice === null ? null : toMoneyString(row.oldSellingPrice),
      newSellingPrice: toMoneyString(row.newSellingPrice),
      changedBy: row.changedBy,
      changedAt: row.changedAt.toISOString(),
    })),
  };
}