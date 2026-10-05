import {
  ApiErrorCode,
  InventoryMovementType,
  isAdmin,
  type CreateVariantInput,
  type UpdateVariantInput,
  type UserRole,
} from '@inventory/shared';

import { AppError, conflict, forbidden, notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma, toDecimal } from '../../lib/prisma.js';
import { isUniqueViolationOn } from '../../lib/prisma-errors.js';
import { applyStockChange } from '../../lib/stock-change.js';
import { serializePriceHistory } from '../../serializers/product.js';
import { serializeVariant, VARIANT_SELECT } from '../../serializers/variant.js';

/**
 * A variant that has ever been moved in the ledger may no longer be renamed.
 *
 * Movements reference the variant by id, not by copying its size and colour, so a
 * rename would retroactively relabel history: a sale recorded against "M / Black"
 * would start displaying as "L / Black". For an audit trail that is worse than
 * the inconvenience, so the identity fields freeze and a corrected variant is
 * added instead.
 */
async function assertIdentityIsEditable(variantId: string): Promise<void> {
  const movementCount = await prisma.inventoryMovement.count({ where: { variantId } });

  if (movementCount > 0) {
    throw new AppError(
      ApiErrorCode.VALIDATION_ERROR,
      'This variant has stock history, so its size and colour can no longer be changed. ' +
        'Deactivate it and add a new variant instead.',
      409,
    );
  }
}

export async function getVariant(variantId: string, role: UserRole) {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: VARIANT_SELECT,
  });

  if (!variant) throw notFound('Variant');

  return serializeVariant(variant, role);
}

export async function createVariant(
  productId: string,
  input: CreateVariantInput,
  actorId: string,
  role: UserRole,
) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });

  if (!product) throw notFound('Product');

  const variantId = await prisma.$transaction(async (tx) => {
    const created = await tx.productVariant.create({
      data: {
        productId,
        size: input.size,
        color: input.color,
        buyingPrice: toDecimal(input.buyingPrice),
        sellingPrice: toDecimal(input.sellingPrice),
        stockQuantity: 0,
      },
      select: { id: true },
    });

    await tx.priceHistory.create({
      data: {
        variantId: created.id,
        oldBuyingPrice: null,
        newBuyingPrice: toDecimal(input.buyingPrice),
        oldSellingPrice: null,
        newSellingPrice: toDecimal(input.sellingPrice),
        changedById: actorId,
      },
    });

    if (input.initialStock > 0) {
      await applyStockChange(tx, {
        variantId: created.id,
        type: InventoryMovementType.STOCK_IN,
        quantity: input.initialStock,
        actorId,
        reason: 'Opening stock',
      });
    }

    return created.id;
  }).catch((error: unknown) => {
    if (isUniqueViolationOn(error, ['productId', 'size', 'color'])) {
      throw conflict(
        ApiErrorCode.DUPLICATE_VARIANT,
        `This product already has a ${input.size} / ${input.color} variant.`,
      );
    }
    throw error;
  });

  logger.info({ actorId, productId, variantId }, 'variant created');

  return getVariant(variantId, role);
}

/**
 * Updates a variant, recording a price history entry whenever either price moves.
 *
 * The variant update and the history insert share one transaction, so a price can
 * never change without leaving a record of what it changed from.
 */
export async function updateVariant(
  variantId: string,
  input: UpdateVariantInput,
  actorId: string,
  role: UserRole,
) {
  const existing = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: VARIANT_SELECT,
  });

  if (!existing) throw notFound('Variant');

  // Buying price is never sent to a Staff client, so a Staff member sending one is
  // either tampering or working from a stale client. Refuse rather than silently
  // drop it, so a legitimate edit never appears to succeed without doing anything.
  if (input.buyingPrice !== undefined && !isAdmin(role)) {
    throw forbidden('Only an administrator can change a buying price.');
  }

  const identityChanged = input.size !== undefined || input.color !== undefined;

  if (identityChanged) {
    await assertIdentityIsEditable(variantId);
  }

  // Comparing against the stored decimal, so re-submitting the same value is not
  // mistaken for a change and does not pad the history with no-op entries.
  const priceChanged =
    (input.buyingPrice !== undefined && existing.buyingPrice.toFixed(2) !== input.buyingPrice) ||
    (input.sellingPrice !== undefined &&
      existing.sellingPrice.toFixed(2) !== input.sellingPrice);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.productVariant.update({
        where: { id: variantId },
        data: {
          ...(input.size === undefined ? {} : { size: input.size }),
          ...(input.color === undefined ? {} : { color: input.color }),
          ...(input.buyingPrice === undefined
            ? {}
            : { buyingPrice: toDecimal(input.buyingPrice) }),
          ...(input.sellingPrice === undefined
            ? {}
            : { sellingPrice: toDecimal(input.sellingPrice) }),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        },
      });

      if (priceChanged) {
        await tx.priceHistory.create({
          data: {
            variantId,
            oldBuyingPrice: existing.buyingPrice,
            newBuyingPrice: toDecimal(input.buyingPrice ?? existing.buyingPrice.toFixed(2)),
            oldSellingPrice: existing.sellingPrice,
            newSellingPrice: toDecimal(input.sellingPrice ?? existing.sellingPrice.toFixed(2)),
            changedById: actorId,
          },
        });
      }
    });
  } catch (error) {
    if (isUniqueViolationOn(error, ['productId', 'size', 'color'])) {
      throw conflict(
        ApiErrorCode.DUPLICATE_VARIANT,
        'Another variant of this product already uses that size and colour.',
      );
    }
    throw error;
  }

  logger.info({ actorId, variantId, priceChanged }, 'variant updated');

  return getVariant(variantId, role);
}

/**
 * Price history for one variant. Reachable only through an Admin-guarded route,
 * so this serialises prices without a role check (§7, §27).
 */
export async function getPriceHistory(productId: string, variantId: string) {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: {
      id: true,
      productId: true,
      size: true,
      color: true,
      buyingPrice: true,
      sellingPrice: true,
    },
  });

  if (!variant || variant.productId !== productId) {
    throw notFound('Variant');
  }

  const rows = await prisma.priceHistory.findMany({
    where: { variantId },
    select: {
      id: true,
      variantId: true,
      oldBuyingPrice: true,
      newBuyingPrice: true,
      oldSellingPrice: true,
      newSellingPrice: true,
      changedAt: true,
      changedBy: { select: { id: true, name: true, role: true } },
    },
    orderBy: { changedAt: 'desc' },
    take: 100,
  });

  return serializePriceHistory(rows, {
    id: variant.id,
    size: variant.size,
    color: variant.color,
    currentPrices: { buyingPrice: variant.buyingPrice, sellingPrice: variant.sellingPrice },
  });
}