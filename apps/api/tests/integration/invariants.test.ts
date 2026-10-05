/**
 * Proves the database-level invariants from migration 20261004120100_invariants
 * actually reject bad writes.
 *
 * Every case runs inside a transaction that is rolled back afterwards, so the
 * suite leaves no rows behind even though the append-only trigger makes cleanup
 * by DELETE impossible. A deliberately invalid statement aborts its transaction;
 * the helper then reports the database error instead of the rollback sentinel.
 */
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import { prisma } from '../../src/lib/prisma.js';

class Rollback extends Error {
  constructor() {
    super('rollback');
    this.name = 'Rollback';
  }
}

/**
 * Runs `work` in a transaction that is always rolled back. Returns the error the
 * database raised, or throws if the statement unexpectedly succeeded.
 */
async function expectViolation(
  work: (tx: Prisma.TransactionClient) => Promise<unknown>,
): Promise<Error> {
  let caught: unknown;

  try {
    await prisma.$transaction(async (tx) => {
      await work(tx);
      throw new Rollback();
    });
  } catch (error) {
    caught = error;
  }

  if (caught instanceof Rollback) {
    throw new Error('Expected a database error, but the statement succeeded.');
  }

  if (!(caught instanceof Error)) {
    throw new Error('Expected an Error to be thrown.');
  }

  return caught;
}

/** Same transaction discipline, but for statements that must succeed. */
async function withRolledBackTransaction<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  let result: T | undefined;

  await prisma.$transaction(async (tx) => {
    result = await work(tx);
    throw new Rollback();
  }).catch((error: unknown) => {
    if (!(error instanceof Rollback)) throw error;
  });

  if (result === undefined) {
    throw new Error('Transaction body did not produce a result.');
  }

  return result;
}

/**
 * Unique per call, in whichever case the column demands.
 *
 * A timestamp alone is not enough: several of these tests call seedGraph twice,
 * and two calls landing in the same millisecond would collide and fail the suite
 * for a reason unrelated to what it is testing.
 *
 * Two variants are needed because the database enforces case on these columns —
 * `users_email_lowercase` and `products_product_code_upper` — and fixtures have to
 * satisfy exactly the same constraints as real data. A test that writes invalid
 * rows is not exercising the rules.
 */
function uniqueSuffix(): string {
  return `${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function upperSuffix(): string {
  return `${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

async function seedGraph(tx: Prisma.TransactionClient) {
  const user = await tx.user.create({
    data: { name: 'Invariant Tester', email: `invariant-${uniqueSuffix()}@example.test` },
  });

  const category = await tx.category.create({ data: { name: `Cat-${uniqueSuffix()}` } });

  const product = await tx.product.create({
    data: { name: 'Test Product', productCode: `T-${upperSuffix()}`, categoryId: category.id },
  });

  const variant = await tx.productVariant.create({
    data: {
      productId: product.id,
      size: 'M',
      color: 'Black',
      buyingPrice: '100.00',
      sellingPrice: '150.00',
      stockQuantity: 10,
    },
  });

  return { user, category, product, variant };
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe('stock can never be negative', () => {
  it('rejects a variant created with negative stock', async () => {
    const error = await expectViolation(async (tx) => {
      const category = await tx.category.create({
        data: { name: `Cat-${uniqueSuffix()}` },
      });
      const product = await tx.product.create({
        data: {
          name: 'P',
          productCode: `T-${upperSuffix()}`,
          categoryId: category.id,
        },
      });
      await tx.productVariant.create({
        data: { productId: product.id, size: 'M', color: 'Black', stockQuantity: -1 },
      });
    });

    expect(error.message).toContain('product_variants_stock_non_negative');
  });

  it('rejects driving stock below zero', async () => {
    const error = await expectViolation(async (tx) => {
      const { variant } = await seedGraph(tx);
      await tx.productVariant.update({
        where: { id: variant.id },
        data: { stockQuantity: -5 },
      });
    });

    expect(error.message).toContain('product_variants_stock_non_negative');
  });
});

describe('movement quantity must be a positive magnitude', () => {
  it('rejects a zero-quantity movement', async () => {
    const error = await expectViolation(async (tx) => {
      const { user, variant } = await seedGraph(tx);
      await tx.inventoryMovement.create({
        data: {
          variantId: variant.id,
          type: 'STOCK_IN',
          quantity: 0,
          previousStock: 10,
          newStock: 10,
          performedById: user.id,
        },
      });
    });

    expect(error.message).toContain('inventory_movements_quantity_positive');
  });

  it('rejects a negative-quantity movement', async () => {
    const error = await expectViolation(async (tx) => {
      const { user, variant } = await seedGraph(tx);
      await tx.inventoryMovement.create({
        data: {
          variantId: variant.id,
          type: 'SALE',
          quantity: -2,
          previousStock: 10,
          newStock: 12,
          performedById: user.id,
        },
      });
    });

    expect(error.message).toContain('inventory_movements_quantity_positive');
  });

  it('rejects a movement whose quantity does not reconcile with the stock change', async () => {
    const error = await expectViolation(async (tx) => {
      const { user, variant } = await seedGraph(tx);
      await tx.inventoryMovement.create({
        data: {
          variantId: variant.id,
          type: 'STOCK_IN',
          quantity: 5,
          previousStock: 10,
          newStock: 12, // should be 15
          performedById: user.id,
        },
      });
    });

    expect(error.message).toContain('inventory_movements_quantity_reconciles');
  });
});

describe('prices cannot be negative', () => {
  it('rejects a negative selling price', async () => {
    const error = await expectViolation(async (tx) => {
      const { product } = await seedGraph(tx);
      await tx.productVariant.create({
        data: {
          productId: product.id,
          size: 'L',
          color: 'Black',
          buyingPrice: '100.00',
          sellingPrice: '-1.00',
        },
      });
    });

    expect(error.message).toContain('product_variants_prices_non_negative');
  });
});

describe('canonicalisation is enforced in the database', () => {
  it('rejects a lowercase product code', async () => {
    const error = await expectViolation(async (tx) => {
      const category = await tx.category.create({ data: { name: `Cat-${uniqueSuffix()}` } });
      await tx.product.create({
        data: { name: 'P', productCode: 'ts-001', categoryId: category.id },
      });
    });

    expect(error.message).toContain('products_product_code_upper');
  });

  it('rejects a lowercase size', async () => {
    const error = await expectViolation(async (tx) => {
      const { product } = await seedGraph(tx);
      await tx.productVariant.create({
        data: { productId: product.id, size: 'm', color: 'Black' },
      });
    });

    expect(error.message).toContain('product_variants_size_upper');
  });

  it('rejects a mixed-case email', async () => {
    const error = await expectViolation(async (tx) => {
      await tx.user.create({
        data: { name: 'Mixed Case', email: 'Someone@Example.com' },
      });
    });

    expect(error.message).toContain('users_email_lowercase');
  });
});

describe('uniqueness invariants', () => {
  it('rejects a duplicate product code', async () => {
    const error = await expectViolation(async (tx) => {
      const { product } = await seedGraph(tx);
      const category = await tx.category.create({ data: { name: `Cat-${uniqueSuffix()}` } });
      await tx.product.create({
        data: {
          name: 'Another',
          productCode: product.productCode,
          categoryId: category.id,
        },
      });
    });

    expect(error.message).toMatch(/products_product_code_key|unique/i);
  });

  it('rejects a duplicate product + size + colour combination', async () => {
    const error = await expectViolation(async (tx) => {
      const { product } = await seedGraph(tx);
      await tx.productVariant.create({
        data: { productId: product.id, size: 'M', color: 'Black' },
      });
    });

    expect(error.message).toMatch(/product_variant_identity_key|unique/i);
  });
});

describe('ledgers are append-only', () => {
  it('refuses to update an existing movement', async () => {
    const error = await expectViolation(async (tx) => {
      const { user, variant } = await seedGraph(tx);
      const movement = await tx.inventoryMovement.create({
        data: {
          variantId: variant.id,
          type: 'STOCK_IN',
          quantity: 5,
          previousStock: 10,
          newStock: 15,
          performedById: user.id,
        },
      });

      await tx.$executeRaw`UPDATE "inventory_movements" SET "quantity" = 999 WHERE id = ${movement.id}::uuid`;
    });

    expect(error.message).toContain('append-only');
  });

  it('refuses to delete a movement', async () => {
    const error = await expectViolation(async (tx) => {
      const { user, variant } = await seedGraph(tx);
      const movement = await tx.inventoryMovement.create({
        data: {
          variantId: variant.id,
          type: 'SALE',
          quantity: 2,
          previousStock: 10,
          newStock: 8,
          performedById: user.id,
        },
      });

      await tx.$executeRaw`DELETE FROM "inventory_movements" WHERE id = ${movement.id}::uuid`;
    });

    expect(error.message).toContain('append-only');
  });

  it('refuses to update a price history record', async () => {
    const error = await expectViolation(async (tx) => {
      const { user, variant } = await seedGraph(tx);
      const record = await tx.priceHistory.create({
        data: {
          variantId: variant.id,
          oldBuyingPrice: null,
          newBuyingPrice: '100.00',
          oldSellingPrice: null,
          newSellingPrice: '150.00',
          changedById: user.id,
        },
      });

      await tx.$executeRaw`UPDATE "price_history" SET "new_buying_price" = 1 WHERE id = ${record.id}::uuid`;
    });

    expect(error.message).toContain('append-only');
  });

  it('refuses to delete a variant that has inventory history', async () => {
    const error = await expectViolation(async (tx) => {
      const { user, variant } = await seedGraph(tx);
      await tx.inventoryMovement.create({
        data: {
          variantId: variant.id,
          type: 'STOCK_IN',
          quantity: 5,
          previousStock: 0,
          newStock: 5,
          performedById: user.id,
        },
      });

      await tx.productVariant.delete({ where: { id: variant.id } });
    });

    expect(error.message).toMatch(/history|append-only/i);
  });
});

describe('the happy path still works', () => {
  it('accepts a valid movement and a price change', async () => {
    const movement = await withRolledBackTransaction(async (tx) => {
      const { user, variant } = await seedGraph(tx);

      await tx.inventoryMovement.create({
        data: {
          variantId: variant.id,
          type: 'SALE',
          quantity: 2,
          previousStock: 10,
          newStock: 8,
          buyingPriceSnapshot: '100.00',
          sellingPriceSnapshot: '150.00',
          unitProfit: '50.00',
          performedById: user.id,
        },
      });

      await tx.priceHistory.create({
        data: {
          variantId: variant.id,
          oldBuyingPrice: '100.00',
          newBuyingPrice: '110.00',
          oldSellingPrice: '150.00',
          newSellingPrice: '175.00',
          changedById: user.id,
        },
      });

      return tx.inventoryMovement.findFirstOrThrow({
        where: { variantId: variant.id },
        orderBy: { createdAt: 'desc' },
      });
    });

    expect(movement.quantity).toBe(2);
    expect(movement.previousStock).toBe(10);
    expect(movement.newStock).toBe(8);
  });
});
