import {
  isAdmin,
  multiplyMoney,
  profitDirection,
  PROFIT_BEARING_MOVEMENT_TYPES,
  type InventoryMovementType,
  type InventoryRowAdminDto,
  type InventoryRowBaseDto,
  type InventoryRowDto,
  type MovementAdminDto,
  type MovementBaseDto,
  type MovementDto,
  type UserRole,
} from '@inventory/shared';
import type { Prisma } from '@prisma/client';

import { toMoneyString, toNullableMoneyString } from '../lib/prisma.js';

/**
 * Everything a movement row needs in one query.
 *
 * The product and actor are joined rather than looked up per row: the history
 * screen renders a list of movements, and a per-row lookup would be a round trip
 * per line on a phone's connection.
 */
export const MOVEMENT_SELECT = {
  id: true,
  variantId: true,
  type: true,
  quantity: true,
  previousStock: true,
  newStock: true,
  buyingPriceSnapshot: true,
  sellingPriceSnapshot: true,
  unitProfit: true,
  reason: true,
  note: true,
  createdAt: true,
  variant: {
    select: {
      id: true,
      size: true,
      color: true,
      product: {
        select: { id: true, name: true, productCode: true, imageUrl: true },
      },
    },
  },
  performedBy: { select: { id: true, name: true, role: true } },
} as const;

export type MovementRow = Prisma.InventoryMovementGetPayload<{ select: typeof MOVEMENT_SELECT }>;

/**
 * Realized profit for one movement, or null when the type does not realize any.
 *
 * A STOCK_IN is money paid for stock, not profit, and an ADJUSTMENT is a
 * correction of the count rather than a transaction with a customer — both report
 * null so the dashboard's realized-profit figure is not quietly inflated by
 * inventory arriving. A SALE adds unit profit per unit; a RETURN subtracts the
 * same amount, because the unit goes back on the shelf and its margin is given up.
 */
export function movementProfit(movement: {
  type: InventoryMovementType;
  quantity: number;
  unitProfit: Prisma.Decimal | null;
}): string | null {
  if (!PROFIT_BEARING_MOVEMENT_TYPES.has(movement.type) || movement.unitProfit === null) {
    return null;
  }

  const total = multiplyMoney(toMoneyString(movement.unitProfit), movement.quantity);
  const sign = profitDirection(movement.type);
  return sign === 1 ? total : `-${total.replace('-', '')}`;
}

/**
 * Serialises a movement for the given role.
 *
 * A STAFF object contains no buying price, no unit profit and no total profit:
 * those keys are absent rather than blanked, so there is nothing on the wire for a
 * client to accidentally surface and no field for a future edit to forget to
 * strip. Selling price is omitted too, even though Staff can see a variant's
 * current selling price — the snapshot is a financial record and this endpoint is
 * the one place a year of history is dumped at once.
 */
export function serializeMovement(movement: MovementRow, role: UserRole): MovementDto {
  const base: MovementBaseDto = {
    id: movement.id,
    variantId: movement.variantId,
    productId: movement.variant.product.id,
    productName: movement.variant.product.name,
    productCode: movement.variant.product.productCode,
    productImageUrl: movement.variant.product.imageUrl,
    size: movement.variant.size,
    color: movement.variant.color,
    type: movement.type,
    // Always a positive magnitude; stockDelta carries the direction unambiguously
    // so a UI never has to infer a sign from the movement type.
    quantity: movement.quantity,
    previousStock: movement.previousStock,
    newStock: movement.newStock,
    stockDelta: movement.newStock - movement.previousStock,
    reason: movement.reason,
    note: movement.note,
    performedBy: movement.performedBy,
    createdAt: movement.createdAt.toISOString(),
  };

  if (!isAdmin(role)) return base;

  return {
    ...base,
    buyingPriceSnapshot: toNullableMoneyString(movement.buyingPriceSnapshot),
    sellingPriceSnapshot: toNullableMoneyString(movement.sellingPriceSnapshot),
    unitProfit: toNullableMoneyString(movement.unitProfit),
    profit: movementProfit(movement),
  } satisfies MovementAdminDto;
}

/**
 * The variant columns an inventory row needs. Reuses VARIANT_SELECT so the
 * inventory screen and the product screen cannot disagree about a variant's shape.
 */
export const INVENTORY_ROW_SELECT = {
  id: true,
  productId: true,
  size: true,
  color: true,
  buyingPrice: true,
  sellingPrice: true,
  stockQuantity: true,
  isActive: true,
  updatedAt: true,
  product: {
    select: {
      id: true,
      name: true,
      productCode: true,
      imageUrl: true,
      isActive: true,
      category: { select: { id: true, name: true } },
    },
  },
} as const;

export type InventoryRow = Prisma.ProductVariantGetPayload<{
  select: typeof INVENTORY_ROW_SELECT;
}>;

/**
 * One row of the inventory screen: the variant, plus just enough of its product to
 * label it. Staff see no cost figures; Admin additionally gets the stock value at
 * buying price, which is what the inventory page is really for — knowing what is on
 * the shelf in money terms.
 */
export function serializeInventoryRow(row: InventoryRow, role: UserRole): InventoryRowDto {
  const base: InventoryRowBaseDto = {
    variantId: row.id,
    productId: row.product.id,
    productName: row.product.name,
    productCode: row.product.productCode,
    imageUrl: row.product.imageUrl,
    categoryId: row.product.category.id,
    categoryName: row.product.category.name,
    size: row.size,
    color: row.color,
    sellingPrice: toMoneyString(row.sellingPrice),
    stockQuantity: row.stockQuantity,
    stockValue: multiplyMoney(toMoneyString(row.sellingPrice), row.stockQuantity),
    isActive: row.isActive,
    productIsActive: row.product.isActive,
    updatedAt: row.updatedAt.toISOString(),
  };

  if (!isAdmin(role)) return base;

  return {
    ...base,
    buyingPrice: toMoneyString(row.buyingPrice),
    stockCostValue: multiplyMoney(toMoneyString(row.buyingPrice), row.stockQuantity),
  } satisfies InventoryRowAdminDto;
}