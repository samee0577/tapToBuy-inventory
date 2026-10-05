import {
  ApiErrorCode,
  type InventoryMovementType,
  type StockStatus,
  deriveStockStatus,
  stockDirection,
} from '@inventory/shared';
import type { Prisma } from '@prisma/client';

import { AppError, insufficientStock, notFound } from './errors.js';

export interface StockChangeRequest {
  variantId: string;
  type: InventoryMovementType;
  /** Always a positive magnitude (§16 Rule 2). Direction comes from the type. */
  quantity: number;
  actorId: string;
  reason?: string;
  note?: string;
  /**
   * Restated on-hand quantity, used by ADJUSTMENT only. The movement's magnitude
   * is then derived as the absolute difference from the current stock, which keeps
   * `quantity` positive for every movement type as the schema requires.
   */
  restatedStock?: number;
}

export interface StockChangeResult {
  variantId: string;
  previousStock: number;
  newStock: number;
  stockStatus: StockStatus;
  /** Signed effect on stock on hand, so callers need not recompute it. */
  stockDelta: number;
  quantity: number;
  movementId: string;
}

const VARIANT_SELECT = {
  id: true,
  stockQuantity: true,
  buyingPrice: true,
  sellingPrice: true,
} as const;

/**
 * The only function in the codebase permitted to change `stockQuantity`.
 *
 * Every path that moves stock - initial stock on a new product, stock-in, sale,
 * return and adjustment - funnels through here, so the business rules cannot
 * drift apart between them.
 *
 * Three things are guaranteed by construction:
 *
 *   1. Atomicity. The guarded UPDATE and the INSERT that records the movement run
 *      inside the caller's transaction. Either both land or neither does.
 *   2. Concurrency safety. The UPDATE carries a `stockQuantity = previousStock`
 *      predicate. If another transaction moved the stock between our read and our
 *      write the predicate matches nothing and we report a conflict rather than
 *      silently overwriting it. This is optimistic locking, chosen over
 *      SELECT ... FOR UPDATE because serverless invocations cannot hold a
 *      transaction open across requests usefully.
 *   3. Price snapshots. The buying and selling prices at the moment of the
 *      movement are frozen onto the movement row, so profit reported for a sale
 *      last month stays correct after the variant is repriced today.
 *
 * `isActive` is deliberately NOT consulted. Deactivation hides a product or
 * variant from browsing; it must not make existing stock unsellable, or the shop
 * ends up holding inventory nobody is permitted to record a sale against. An
 * ADJUSTMENT is how a retired line is written off.
 */
export async function applyStockChange(
  tx: Prisma.TransactionClient,
  request: StockChangeRequest,
): Promise<StockChangeResult> {
  const { variantId, type, actorId, reason, note, restatedStock } = request;

  const variant = await tx.productVariant.findUnique({
    where: { id: variantId },
    select: VARIANT_SELECT,
  });

  if (!variant) {
    throw notFound('Variant');
  }

  const previousStock = variant.stockQuantity;

  let quantity = request.quantity;
  let newStock: number;

  if (type === 'ADJUSTMENT') {
    if (restatedStock === undefined) {
      throw new AppError(
        ApiErrorCode.INVALID_ADJUSTMENT_QUANTITY,
        'An adjustment must restate the stock on hand.',
        400,
      );
    }

    const difference = restatedStock - previousStock;
    if (difference === 0) {
      throw new AppError(
        ApiErrorCode.INVALID_ADJUSTMENT_QUANTITY,
        'The counted quantity matches the recorded stock, so there is nothing to adjust.',
        400,
      );
    }

    quantity = Math.abs(difference);
    newStock = restatedStock;
  } else {
    newStock = previousStock + stockDirection(type) * quantity;
  }

  // Checked before the write so the caller gets a precise, actionable message
  // instead of a database constraint violation. The CHECK constraint on
  // stock_quantity remains the backstop.
  if (newStock < 0) {
    throw insufficientStock(previousStock, quantity);
  }

  const updated = await tx.productVariant.updateMany({
    where: { id: variantId, stockQuantity: previousStock },
    data: { stockQuantity: newStock },
  });

  if (updated.count === 0) {
    throw new AppError(
      ApiErrorCode.CONFLICT,
      'Someone else changed this stock at the same time. Please try again.',
      409,
    );
  }

  // Frozen here, from the row as read above, not from anything the client sent.
  const buyingPriceSnapshot = variant.buyingPrice;
  const sellingPriceSnapshot = variant.sellingPrice;
  const unitProfit = sellingPriceSnapshot.minus(buyingPriceSnapshot);

  const movement = await tx.inventoryMovement.create({
    data: {
      variantId,
      type,
      quantity,
      previousStock,
      newStock,
      buyingPriceSnapshot,
      sellingPriceSnapshot,
      unitProfit,
      ...(reason === undefined ? {} : { reason }),
      ...(note === undefined ? {} : { note }),
      performedById: actorId,
    },
    select: { id: true },
  });

  return {
    variantId,
    previousStock,
    newStock,
    stockStatus: deriveStockStatus(newStock),
    stockDelta: newStock - previousStock,
    quantity,
    movementId: movement.id,
  };
}