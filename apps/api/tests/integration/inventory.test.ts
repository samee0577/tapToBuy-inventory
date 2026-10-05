import { UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiErrorCode } from '@inventory/shared';

import { prisma } from '../../src/lib/prisma.js';
import { api, authCookie, createTestUser, type TestUser } from './helpers.js';

/**
 * The inventory engine's own test suite.
 *
 * No fixture cleanup runs here, and none can. Recording a movement writes to
 * inventory_movements, which the database refuses to UPDATE or DELETE, and users
 * are RESTRICT-referenced from those rows. The suite relies on the disposable
 * `inventory_test` schema that scripts/prepare-test-db.ts recreates before each run
 * — the same guarantee the shop's real records get.
 *
 * Fixtures are built directly with Prisma rather than through the product API. The
 * engine's own endpoints are what is under test here, and going through product
 * creation for every case multiplied the number of round trips to a remote database
 * enough to make the whole suite time-sensitive. The one thing that must use the
 * real path — opening stock — does, because a movement-less fixture would not
 * exercise the ledger.
 */

function unique(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

let admin: TestUser;
let staff: TestUser;

/**
 * One of each role for the whole file. Hashing a password with Argon2 is the most
 * expensive thing in the suite, and a per-test user buys nothing here: nothing in
 * these tests mutates a role or an active flag.
 */
beforeAll(async () => {
  admin = await createTestUser({ role: UserRole.ADMIN });
  staff = await createTestUser({ role: UserRole.STAFF });
});

afterAll(async () => {
  await prisma.$disconnect();
});

interface Fixture {
  productId: string;
  variantId: string;
  categoryId: string;
  productCode: string;
}

/**
 * A category with one product and one M/Black variant, at the given stock.
 *
 * `openingStock` is opened through the real STOCK_IN endpoint, so every fixture
 * variant starts its life with a genuine ledger entry and the history a test reads
 * back is the history the engine actually wrote.
 */
async function makeVariant(options?: {
  initialStock?: number;
  buyingPrice?: string;
  sellingPrice?: string;
  productName?: string;
}): Promise<Fixture> {
  const category = await prisma.category.create({
    data: { name: unique('ICat') },
    select: { id: true },
  });

  const productCode = unique('IP');

  const variant = await prisma.productVariant.create({
    data: {
      product: {
        create: {
          name: options?.productName ?? unique('Inventory Product'),
          productCode,
          categoryId: category.id,
        },
      },
      size: 'M',
      color: 'Black',
      buyingPrice: options?.buyingPrice ?? '400.00',
      sellingPrice: options?.sellingPrice ?? '699.00',
      stockQuantity: 0,
    },
    select: { id: true, productId: true },
  });

  if ((options?.initialStock ?? 0) > 0) {
    await api()
      .post(`/api/inventory/variants/${variant.id}/stock-in`)
      .set(await authCookie(admin))
      .send({ quantity: options?.initialStock as number, reason: 'Opening stock' })
      .expect(201);
  }

  return {
    productId: variant.productId,
    variantId: variant.id,
    categoryId: category.id,
    productCode,
  };
}

describe('POST /api/inventory/variants/:variantId/stock-in', () => {
  it('raises stock and records a STOCK_IN movement', async () => {
    const fixture = await makeVariant();

    const response = await api()
      .post(`/api/inventory/variants/${fixture.variantId}/stock-in`)
      .set(await authCookie(admin))
      .send({ quantity: 25, reason: 'Supplier delivery' })
      .expect(201);

    expect(response.body.data.variant.stockQuantity).toBe(25);
    expect(response.body.data.variant.stockStatus).toBe('IN_STOCK');
    expect(response.body.data.movement).toMatchObject({
      type: 'STOCK_IN',
      quantity: 25,
      previousStock: 0,
      newStock: 25,
      stockDelta: 25,
      reason: 'Supplier delivery',
    });

    const stored = await prisma.productVariant.findUniqueOrThrow({
      where: { id: fixture.variantId },
      select: { stockQuantity: true },
    });
    expect(stored.stockQuantity).toBe(25);
  });

  it('freezes the price snapshots at the moment of the movement', async () => {
    const fixture = await makeVariant({ initialStock: 5 });

    await api()
      .post(`/api/inventory/variants/${fixture.variantId}/stock-in`)
      .set(await authCookie(admin))
      .send({ quantity: 10 })
      .expect(201);

    // Reprice afterwards. The earlier movement must keep the prices that were in
    // force when it happened, or historical profit silently changes.
    await api()
      .patch(`/api/variants/${fixture.variantId}`)
      .set(await authCookie(admin))
      .send({ buyingPrice: '900.00', sellingPrice: '1500.00' })
      .expect(200);

    const movements = await prisma.inventoryMovement.findMany({
      where: { variantId: fixture.variantId },
      select: { buyingPriceSnapshot: true, sellingPriceSnapshot: true, unitProfit: true },
    });

    expect(movements).toHaveLength(2);
    for (const movement of movements) {
      expect(movement.buyingPriceSnapshot?.toFixed(2)).toBe('400.00');
      expect(movement.sellingPriceSnapshot?.toFixed(2)).toBe('699.00');
      expect(movement.unitProfit?.toFixed(2)).toBe('299.00');
    }
  });

  it('lets STAFF receive a delivery', async () => {
    const fixture = await makeVariant();

    await api()
      .post(`/api/inventory/variants/${fixture.variantId}/stock-in`)
      .set(await authCookie(staff))
      .send({ quantity: 8, reason: 'Delivery' })
      .expect(201);
  });

  it('rejects a non-integer or non-positive quantity', async () => {
    const fixture = await makeVariant();

    for (const quantity of [0, -3, 2.5]) {
      const response = await api()
        .post(`/api/inventory/variants/${fixture.variantId}/stock-in`)
        .set(await authCookie(admin))
        .send({ quantity })
        .expect(400);

      expect(response.body.error.code).toBe(ApiErrorCode.VALIDATION_ERROR);
    }
  });

  it('rejects a quantity beyond the documented ceiling', async () => {
    const fixture = await makeVariant();

    const response = await api()
      .post(`/api/inventory/variants/${fixture.variantId}/stock-in`)
      .set(await authCookie(admin))
      .send({ quantity: 10_000_000 })
      .expect(400);

    expect(response.body.error.code).toBe(ApiErrorCode.VALIDATION_ERROR);
  });

  it('reports 404 for an unknown variant', async () => {
    const response = await api()
      .post('/api/inventory/variants/00000000-0000-4000-8000-000000000000/stock-in')
      .set(await authCookie(admin))
      .send({ quantity: 1 })
      .expect(404);

    expect(response.body.error.code).toBe(ApiErrorCode.NOT_FOUND);
  });

  it('requires authentication', async () => {
    const fixture = await makeVariant();

    await api()
      .post(`/api/inventory/variants/${fixture.variantId}/stock-in`)
      .send({ quantity: 1 })
      .expect(401);
  });
});

describe('POST /api/inventory/variants/:variantId/sales', () => {
  it('reduces stock, records a SALE, and reports realized profit', async () => {
    const fixture = await makeVariant({ initialStock: 10 });

    const response = await api()
      .post(`/api/inventory/variants/${fixture.variantId}/sales`)
      .set(await authCookie(admin))
      .send({ quantity: 3 })
      .expect(201);

    expect(response.body.data.variant.stockQuantity).toBe(7);
    expect(response.body.data.movement).toMatchObject({
      type: 'SALE',
      quantity: 3,
      previousStock: 10,
      newStock: 7,
      stockDelta: -3,
      // 699 - 400 = 299 per unit, times 3.
      buyingPriceSnapshot: '400.00',
      sellingPriceSnapshot: '699.00',
      unitProfit: '299.00',
      profit: '897.00',
    });
  });

  it('refuses to sell more than is on hand, and changes nothing', async () => {
    const fixture = await makeVariant({ initialStock: 4 });

    const movementsBefore = await prisma.inventoryMovement.count({
      where: { variantId: fixture.variantId },
    });

    const response = await api()
      .post(`/api/inventory/variants/${fixture.variantId}/sales`)
      .set(await authCookie(admin))
      .send({ quantity: 5 })
      .expect(409);

    expect(response.body.error.code).toBe(ApiErrorCode.INSUFFICIENT_STOCK);
    expect(response.body.error.details).toMatchObject({ available: 4, requested: 5 });

    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: fixture.variantId },
      select: { stockQuantity: true },
    });
    expect(variant.stockQuantity).toBe(4);

    // A refused sale must leave no trace: no movement row claiming a sale that did
    // not happen.
    expect(
      await prisma.inventoryMovement.count({ where: { variantId: fixture.variantId } }),
    ).toBe(movementsBefore);
  });

  it('refuses a sale of a variant with no stock at all', async () => {
    const fixture = await makeVariant();

    const response = await api()
      .post(`/api/inventory/variants/${fixture.variantId}/sales`)
      .set(await authCookie(admin))
      .send({ quantity: 1 })
      .expect(409);

    expect(response.body.error.code).toBe(ApiErrorCode.INSUFFICIENT_STOCK);
  });

  it('lets STAFF record a sale without exposing profit', async () => {
    const fixture = await makeVariant({ initialStock: 10 });

    const response = await api()
      .post(`/api/inventory/variants/${fixture.variantId}/sales`)
      .set(await authCookie(staff))
      .send({ quantity: 2 })
      .expect(201);

    expect(response.body.data.variant.stockQuantity).toBe(8);

    const serialised = JSON.stringify(response.body.data.movement);
    expect(serialised).not.toContain('profit');
    expect(serialised).not.toContain('buyingPrice');
    // The quantities they are responsible for are still present.
    expect(serialised).toContain('"quantity":2');
  });

  it('drives stock to exactly zero rather than refusing the last unit', async () => {
    const fixture = await makeVariant({ initialStock: 2 });

    const response = await api()
      .post(`/api/inventory/variants/${fixture.variantId}/sales`)
      .set(await authCookie(admin))
      .send({ quantity: 2 })
      .expect(201);

    expect(response.body.data.variant.stockQuantity).toBe(0);
    expect(response.body.data.variant.stockStatus).toBe('OUT_OF_STOCK');
  });
});

describe('POST /api/inventory/variants/:variantId/returns', () => {
  it('puts the units back and gives back the margin', async () => {
    const fixture = await makeVariant({ initialStock: 10 });

    await api()
      .post(`/api/inventory/variants/${fixture.variantId}/sales`)
      .set(await authCookie(admin))
      .send({ quantity: 4 })
      .expect(201);

    const response = await api()
      .post(`/api/inventory/variants/${fixture.variantId}/returns`)
      .set(await authCookie(admin))
      .send({ quantity: 2, reason: 'Wrong size sent' })
      .expect(201);

    expect(response.body.data.variant.stockQuantity).toBe(8);
    expect(response.body.data.movement).toMatchObject({
      type: 'RETURN',
      quantity: 2,
      previousStock: 6,
      newStock: 8,
      stockDelta: 2,
      reason: 'Wrong size sent',
      // A return subtracts the profit it had added: 299 x 2.
      profit: '-598.00',
    });
  });

  it('can return more than was sold, which is how damaged stock comes back in', async () => {
    const fixture = await makeVariant({ initialStock: 3 });

    const response = await api()
      .post(`/api/inventory/variants/${fixture.variantId}/returns`)
      .set(await authCookie(staff))
      .send({ quantity: 5, reason: 'Faulty items sent back by supplier' })
      .expect(201);

    expect(response.body.data.variant.stockQuantity).toBe(8);
  });
});

describe('POST /api/inventory/variants/:variantId/adjustments', () => {
  it('restates stock from a counted total', async () => {
    const fixture = await makeVariant({ initialStock: 10 });

    const response = await api()
      .post(`/api/inventory/variants/${fixture.variantId}/adjustments`)
      .set(await authCookie(admin))
      .send({ newStock: 7, reason: 'Physical count' })
      .expect(201);

    expect(response.body.data.variant.stockQuantity).toBe(7);
    expect(response.body.data.movement).toMatchObject({
      type: 'ADJUSTMENT',
      // The magnitude is the difference, not the restated total.
      quantity: 3,
      previousStock: 10,
      newStock: 7,
      stockDelta: -3,
      reason: 'Physical count',
    });
  });

  it('accepts a signed delta in both directions', async () => {
    const fixture = await makeVariant({ initialStock: 10 });

    const down = await api()
      .post(`/api/inventory/variants/${fixture.variantId}/adjustments`)
      .set(await authCookie(admin))
      .send({ delta: -4, reason: 'Damaged in store' })
      .expect(201);

    expect(down.body.data.variant.stockQuantity).toBe(6);
    expect(down.body.data.movement.stockDelta).toBe(-4);

    const up = await api()
      .post(`/api/inventory/variants/${fixture.variantId}/adjustments`)
      .set(await authCookie(admin))
      .send({ delta: 2, reason: 'Found in the back room' })
      .expect(201);

    expect(up.body.data.variant.stockQuantity).toBe(8);
    expect(up.body.data.movement.stockDelta).toBe(2);
  });

  it('refuses an adjustment that changes nothing', async () => {
    const fixture = await makeVariant({ initialStock: 10 });

    const same = await api()
      .post(`/api/inventory/variants/${fixture.variantId}/adjustments`)
      .set(await authCookie(admin))
      .send({ newStock: 10, reason: 'Recount' })
      .expect(400);

    expect(same.body.error.code).toBe(ApiErrorCode.INVALID_ADJUSTMENT_QUANTITY);

    await api()
      .post(`/api/inventory/variants/${fixture.variantId}/adjustments`)
      .set(await authCookie(admin))
      .send({ delta: 0, reason: 'Recount' })
      .expect(400);
  });

  it('requires a reason', async () => {
    const fixture = await makeVariant({ initialStock: 10 });

    const response = await api()
      .post(`/api/inventory/variants/${fixture.variantId}/adjustments`)
      .set(await authCookie(admin))
      .send({ newStock: 8 })
      .expect(400);

    expect(response.body.error.code).toBe(ApiErrorCode.VALIDATION_ERROR);
  });

  it('rejects a restatement that would drive stock below zero', async () => {
    const fixture = await makeVariant({ initialStock: 4 });

    const response = await api()
      .post(`/api/inventory/variants/${fixture.variantId}/adjustments`)
      .set(await authCookie(admin))
      .send({ newStock: -1, reason: 'Mistyped count' })
      .expect(400);

    expect(response.body.error.code).toBe(ApiErrorCode.VALIDATION_ERROR);
  });

  it('refuses a STAFF user, since a write-off has no counterpart to verify it', async () => {
    const fixture = await makeVariant({ initialStock: 10 });

    const response = await api()
      .post(`/api/inventory/variants/${fixture.variantId}/adjustments`)
      .set(await authCookie(staff))
      .send({ newStock: 100, reason: 'Whatever' })
      .expect(403);

    expect(response.body.error.code).toBe(ApiErrorCode.FORBIDDEN);

    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: fixture.variantId },
      select: { stockQuantity: true },
    });
    expect(variant.stockQuantity).toBe(10);
  });

  it('refuses both newStock and delta together', async () => {
    const fixture = await makeVariant({ initialStock: 10 });

    await api()
      .post(`/api/inventory/variants/${fixture.variantId}/adjustments`)
      .set(await authCookie(admin))
      .send({ newStock: 8, delta: -2, reason: 'Ambiguous' })
      .expect(400);
  });
});

describe('GET /api/inventory', () => {
  it('lists one row per variant with its stock and value', async () => {
    const fixture = await makeVariant({ initialStock: 12 });

    const response = await api()
      .get('/api/inventory')
      .query({ search: fixture.productCode })
      .set(await authCookie(admin))
      .expect(200);

    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0]).toMatchObject({
      variantId: fixture.variantId,
      productCode: fixture.productCode,
      size: 'M',
      color: 'Black',
      stockQuantity: 12,
      // 699 x 12
      stockValue: '8388.00',
      buyingPrice: '400.00',
    });
  });

  it('omits cost figures for STAFF', async () => {
    const fixture = await makeVariant({ initialStock: 12 });

    const response = await api()
      .get('/api/inventory')
      .query({ search: fixture.productCode })
      .set(await authCookie(staff))
      .expect(200);

    expect(JSON.stringify(response.body.data.items[0])).not.toContain('buyingPrice');
    expect(JSON.stringify(response.body.data.items[0])).not.toContain('stockCostValue');
  });

  it('filters by stock status using the documented thresholds', async () => {
    // 3 units is LOW_STOCK (threshold is 5); 40 is IN_STOCK.
    const low = await makeVariant({ initialStock: 3 });
    const healthy = await makeVariant({ initialStock: 40 });

    const response = await api()
      .get('/api/inventory')
      .query({ stockStatus: 'LOW_STOCK', status: 'all', pageSize: 100 })
      .set(await authCookie(admin))
      .expect(200);

    const ids = response.body.data.items.map((row: { variantId: string }) => row.variantId);
    expect(ids).toContain(low.variantId);
    expect(ids).not.toContain(healthy.variantId);
  });

  it('filters by size, colour and category', async () => {
    const fixture = await makeVariant({ initialStock: 6 });
    const other = await makeVariant({ initialStock: 6 });

    // Sizes are canonicalised to upper case on the way in, so a lowercase filter
    // still matches: the dropdown cannot drift from what is stored.
    const bySize = await api()
      .get('/api/inventory')
      .query({ size: 'm', status: 'all', pageSize: 100 })
      .set(await authCookie(admin))
      .expect(200);
    expect(bySize.body.data.items.map((row: { variantId: string }) => row.variantId)).toContain(
      fixture.variantId,
    );

    const byColor = await api()
      .get('/api/inventory')
      .query({ color: 'BLACK', status: 'all', pageSize: 100 })
      .set(await authCookie(admin))
      .expect(200);
    expect(byColor.body.data.items.map((row: { variantId: string }) => row.variantId)).toContain(
      fixture.variantId,
    );

    const byCategory = await api()
      .get('/api/inventory')
      .query({ categoryId: fixture.categoryId, status: 'all', pageSize: 100 })
      .set(await authCookie(admin))
      .expect(200);
    const ids = byCategory.body.data.items.map((row: { variantId: string }) => row.variantId);
    expect(ids).toContain(fixture.variantId);
    expect(ids).not.toContain(other.variantId);
  });

  it('sorts by product name in both directions', async () => {
    // Three rows with distinct names, all sharing a prefix, so the search scopes
    // the assertion to exactly this test. The wider table holds duplicates from
    // other suites and names whose Postgres collation order differs from
    // JavaScript's, neither of which this test is about.
    const names = ['Ival-Alder', 'Ival-Birch', 'Ival-Cedar'];
    for (const productName of names) {
      await makeVariant({ initialStock: 5, productName });
    }

    const ascending = await api()
      .get('/api/inventory')
      .query({ search: 'Ival-', sortBy: 'productName', sortOrder: 'asc' })
      .set(await authCookie(admin))
      .expect(200);

    const descending = await api()
      .get('/api/inventory')
      .query({ search: 'Ival-', sortBy: 'productName', sortOrder: 'desc' })
      .set(await authCookie(admin))
      .expect(200);

    const asc = ascending.body.data.items.map((row: { productName: string }) => row.productName);
    const desc = descending.body.data.items.map((row: { productName: string }) => row.productName);

    expect(asc).toEqual(names);
    expect(desc).toEqual([...names].reverse());
  });

  it('paginates', async () => {
    await makeVariant({ initialStock: 5 });
    await makeVariant({ initialStock: 5 });

    const response = await api()
      .get('/api/inventory')
      .query({ page: 1, pageSize: 2, status: 'all' })
      .set(await authCookie(admin))
      .expect(200);

    expect(response.body.data.items).toHaveLength(2);
    expect(response.body.data.pageSize).toBe(2);
    expect(response.body.data.totalPages).toBeGreaterThan(1);
  });

  it('hides deactivated variants by default', async () => {
    const fixture = await makeVariant({ initialStock: 5 });

    await api()
      .patch(`/api/variants/${fixture.variantId}`)
      .set(await authCookie(admin))
      .send({ isActive: false })
      .expect(200);

    const activeOnly = await api()
      .get('/api/inventory')
      .query({ search: fixture.productCode })
      .set(await authCookie(admin))
      .expect(200);
    expect(activeOnly.body.data.items).toHaveLength(0);

    const includingInactive = await api()
      .get('/api/inventory')
      .query({ search: fixture.productCode, status: 'all' })
      .set(await authCookie(admin))
      .expect(200);
    expect(includingInactive.body.data.items).toHaveLength(1);
  });
});

describe('GET /api/inventory/facets', () => {
  it('returns the distinct sizes and colours in use', async () => {
    const response = await api()
      .get('/api/inventory/facets')
      .set(await authCookie(admin))
      .expect(200);

    expect(response.body.data.sizes).toContain('M');
    expect(response.body.data.colors).toContain('Black');
    // No duplicates, since the query is distinct.
    expect(new Set(response.body.data.sizes).size).toBe(response.body.data.sizes.length);
    expect(new Set(response.body.data.colors).size).toBe(response.body.data.colors.length);
  });
});

describe('GET /api/inventory/summary', () => {
  it('reports counts and internally consistent stock value', async () => {
    const response = await api()
      .get('/api/inventory/summary')
      .set(await authCookie(admin))
      .expect(200);

    const data = response.body.data;

    expect(data.totalVariants).toBeGreaterThan(0);
    expect(data.totalStockUnits).toBeGreaterThan(0);

    // The one property worth asserting regardless of what else is in the shared
    // schema: potential profit is retail minus cost, and money never comes back as
    // anything but a fixed 2-decimal string.
    expect(data.retailValue).toMatch(/^\d+\.\d{2}$/);
    expect(data.costValue).toMatch(/^\d+\.\d{2}$/);
    expect(Number(data.potentialProfit)).toBe(
      Number(data.retailValue) - Number(data.costValue),
    );
  });

  it('counts a low-stock variant the fixture just created', async () => {
    // 3 units, which the shared threshold defines as LOW_STOCK.
    const fixture = await makeVariant({ initialStock: 3 });

    const response = await api()
      .get('/api/inventory')
      .query({ stockStatus: 'LOW_STOCK', status: 'all', pageSize: 100 })
      .set(await authCookie(admin))
      .expect(200);

    const ids = response.body.data.items.map((row: { variantId: string }) => row.variantId);
    expect(ids).toContain(fixture.variantId);
  });
});

describe('GET /api/inventory/movements', () => {
  it('returns the history newest first, labelled with product, variant and actor', async () => {
    const fixture = await makeVariant({ initialStock: 10 });

    await api()
      .post(`/api/inventory/variants/${fixture.variantId}/sales`)
      .set(await authCookie(staff))
      .send({ quantity: 2 })
      .expect(201);

    const response = await api()
      .get('/api/inventory/movements')
      .query({ variantId: fixture.variantId })
      .set(await authCookie(admin))
      .expect(200);

    expect(response.body.data.items).toHaveLength(2);
    expect(response.body.data.items[0]).toMatchObject({
      type: 'SALE',
      variantId: fixture.variantId,
      productId: fixture.productId,
      productCode: fixture.productCode,
      size: 'M',
      color: 'Black',
      performedBy: { id: staff.id },
    });
  });

  it('filters by movement type, actor, product and category', async () => {
    const fixture = await makeVariant({ initialStock: 10 });

    await api()
      .post(`/api/inventory/variants/${fixture.variantId}/sales`)
      .set(await authCookie(staff))
      .send({ quantity: 1 })
      .expect(201);

    const byType = await api()
      .get('/api/inventory/movements')
      .query({ variantId: fixture.variantId, type: 'SALE' })
      .set(await authCookie(admin))
      .expect(200);
    expect(byType.body.data.items).toHaveLength(1);
    expect(byType.body.data.items[0].type).toBe('SALE');

    const byActor = await api()
      .get('/api/inventory/movements')
      .query({ variantId: fixture.variantId, performedById: staff.id })
      .set(await authCookie(admin))
      .expect(200);
    expect(byActor.body.data.items).toHaveLength(1);
    expect(byActor.body.data.items[0].type).toBe('SALE');

    const byProduct = await api()
      .get('/api/inventory/movements')
      .query({ productId: fixture.productId })
      .set(await authCookie(admin))
      .expect(200);
    expect(byProduct.body.data.items.length).toBe(2);

    const byCategory = await api()
      .get('/api/inventory/movements')
      .query({ categoryId: fixture.categoryId, pageSize: 100 })
      .set(await authCookie(admin))
      .expect(200);
    expect(
      byCategory.body.data.items.map((row: { productId: string }) => row.productId),
    ).toContain(fixture.productId);
  });

  it('searches across product, variant and free text', async () => {
    const fixture = await makeVariant({ initialStock: 4 });

    for (const search of [fixture.productCode, 'Black', 'Opening stock']) {
      const response = await api()
        .get('/api/inventory/movements')
        .query({ search, pageSize: 100 })
        .set(await authCookie(admin))
        .expect(200);

      expect(
        response.body.data.items.map((row: { variantId: string }) => row.variantId),
        `search "${search}" should find the movement`,
      ).toContain(fixture.variantId);
    }
  });

  it('filters by an inclusive date range', async () => {
    const fixture = await makeVariant({ initialStock: 4 });

    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    const todayOnly = await api()
      .get('/api/inventory/movements')
      .query({ variantId: fixture.variantId, from: today, to: today })
      .set(await authCookie(admin))
      .expect(200);
    expect(todayOnly.body.data.items).toHaveLength(1);

    const yesterdayOnly = await api()
      .get('/api/inventory/movements')
      .query({ variantId: fixture.variantId, from: yesterday, to: yesterday })
      .set(await authCookie(admin))
      .expect(200);
    expect(yesterdayOnly.body.data.items).toHaveLength(0);
  });

  it('rejects a date range that runs backwards', async () => {
    const response = await api()
      .get('/api/inventory/movements')
      .query({ from: '2026-03-10', to: '2026-03-01' })
      .set(await authCookie(admin))
      .expect(400);

    expect(response.body.error.code).toBe(ApiErrorCode.VALIDATION_ERROR);
  });

  it('sorts by quantity', async () => {
    const fixture = await makeVariant({ initialStock: 20 });

    await api()
      .post(`/api/inventory/variants/${fixture.variantId}/sales`)
      .set(await authCookie(admin))
      .send({ quantity: 7 })
      .expect(201);

    const byQuantity = await api()
      .get('/api/inventory/movements')
      .query({ variantId: fixture.variantId, sortBy: 'quantity', sortOrder: 'asc' })
      .set(await authCookie(admin))
      .expect(200);
    expect(byQuantity.body.data.items.map((row: { quantity: number }) => row.quantity)).toEqual([
      7, 20,
    ]);

    const descending = await api()
      .get('/api/inventory/movements')
      .query({ variantId: fixture.variantId, sortBy: 'quantity', sortOrder: 'desc' })
      .set(await authCookie(admin))
      .expect(200);
    expect(descending.body.data.items.map((row: { quantity: number }) => row.quantity)).toEqual([
      20, 7,
    ]);
  });

  it('sorts by product name through the variant join', async () => {
    // Scoped to distinct names so the expected order is unambiguous, for the same
    // reason as the inventory sort case.
    const names = ['Ivar-Alder', 'Ivar-Birch', 'Ivar-Cedar'];
    for (const productName of names) {
      await makeVariant({ initialStock: 2, productName });
    }

    const ascending = await api()
      .get('/api/inventory/movements')
      .query({ search: 'Ivar-', sortBy: 'product', sortOrder: 'asc' })
      .set(await authCookie(admin))
      .expect(200);
    expect(
      ascending.body.data.items.map((row: { productName: string }) => row.productName),
    ).toEqual(names);

    const descending = await api()
      .get('/api/inventory/movements')
      .query({ search: 'Ivar-', sortBy: 'product', sortOrder: 'desc' })
      .set(await authCookie(admin))
      .expect(200);
    expect(
      descending.body.data.items.map((row: { productName: string }) => row.productName),
    ).toEqual([...names].reverse());
  });

  it('paginates rather than truncating the record', async () => {
    const fixture = await makeVariant({ initialStock: 20 });

    await api()
      .post(`/api/inventory/variants/${fixture.variantId}/sales`)
      .set(await authCookie(admin))
      .send({ quantity: 1 })
      .expect(201);

    const response = await api()
      .get('/api/inventory/movements')
      .query({ variantId: fixture.variantId, pageSize: 2, page: 1 })
      .set(await authCookie(admin))
      .expect(200);

    expect(response.body.data.items).toHaveLength(2);
    expect(response.body.data.total).toBe(2);
  });

  it('hides profit from STAFF but keeps the quantities they recorded', async () => {
    const fixture = await makeVariant({ initialStock: 10 });

    await api()
      .post(`/api/inventory/variants/${fixture.variantId}/sales`)
      .set(await authCookie(staff))
      .send({ quantity: 2 })
      .expect(201);

    const response = await api()
      .get('/api/inventory/movements')
      .query({ variantId: fixture.variantId })
      .set(await authCookie(staff))
      .expect(200);

    const serialised = JSON.stringify(response.body.data.items);
    expect(serialised).not.toContain('profit');
    expect(serialised).not.toContain('buyingPriceSnapshot');
    expect(serialised).not.toContain('sellingPriceSnapshot');
    expect(serialised).toContain('"quantity":2');
  });

  it('exposes profit to an ADMIN', async () => {
    const fixture = await makeVariant({ initialStock: 10 });

    await api()
      .post(`/api/inventory/variants/${fixture.variantId}/sales`)
      .set(await authCookie(admin))
      .send({ quantity: 1 })
      .expect(201);

    const response = await api()
      .get('/api/inventory/movements')
      .query({ variantId: fixture.variantId, type: 'SALE' })
      .set(await authCookie(admin))
      .expect(200);

    expect(response.body.data.items[0]).toMatchObject({
      buyingPriceSnapshot: '400.00',
      sellingPriceSnapshot: '699.00',
      unitProfit: '299.00',
      profit: '299.00',
    });
  });

  it('requires authentication', async () => {
    await api().get('/api/inventory/movements').expect(401);
  });
});

describe('GET /api/inventory/variants/:variantId/movements', () => {
  it('returns one variant timeline', async () => {
    const fixture = await makeVariant({ initialStock: 10 });
    const other = await makeVariant({ initialStock: 10 });

    await api()
      .post(`/api/inventory/variants/${fixture.variantId}/sales`)
      .set(await authCookie(admin))
      .send({ quantity: 1 })
      .expect(201);

    const response = await api()
      .get(`/api/inventory/variants/${fixture.variantId}/movements`)
      .set(await authCookie(admin))
      .expect(200);

    expect(response.body.data.items).toHaveLength(2);
    expect(
      response.body.data.items.map((row: { variantId: string }) => row.variantId),
    ).not.toContain(other.variantId);
  });

  it('cannot be widened into a shop-wide history by query parameters', async () => {
    const fixture = await makeVariant({ initialStock: 10 });
    const other = await makeVariant({ initialStock: 10 });

    await api()
      .post(`/api/inventory/variants/${other.variantId}/sales`)
      .set(await authCookie(admin))
      .send({ quantity: 1 })
      .expect(201);

    const response = await api()
      .get(`/api/inventory/variants/${fixture.variantId}/movements`)
      // These are accepted by the shared query schema, then dropped: the scope
      // comes from the path.
      .query({ performedById: admin.id, categoryId: other.categoryId })
      .set(await authCookie(admin))
      .expect(200);

    expect(
      response.body.data.items.map((row: { variantId: string }) => row.variantId),
    ).not.toContain(other.variantId);
  });

  it('reports 404 for an unknown variant', async () => {
    const response = await api()
      .get('/api/inventory/variants/00000000-0000-4000-8000-000000000000/movements')
      .set(await authCookie(admin))
      .expect(404);

    expect(response.body.error.code).toBe(ApiErrorCode.NOT_FOUND);
  });
});

describe('the ledger cannot be rewritten through the API', () => {
  it('has no route that edits or deletes a movement', async () => {
    const fixture = await makeVariant({ initialStock: 10 });

    const response = await api()
      .get('/api/inventory/movements')
      .query({ variantId: fixture.variantId })
      .set(await authCookie(admin))
      .expect(200);

    const movementId = response.body.data.items[0].id as string;

    for (const attempt of [
      api()
        .patch(`/api/inventory/movements/${movementId}`)
        .set(await authCookie(admin))
        .send({ quantity: 1 }),
      api().delete(`/api/inventory/movements/${movementId}`).set(await authCookie(admin)),
      api()
        .put(`/api/inventory/movements/${movementId}`)
        .set(await authCookie(admin))
        .send({ quantity: 1 }),
    ]) {
      await attempt.expect(404);
    }

    const movement = await prisma.inventoryMovement.findUniqueOrThrow({
      where: { id: movementId },
      select: { quantity: true },
    });
    expect(movement.quantity).toBe(10);
  });
});

describe('the ledger reconciles with on-hand stock across a long sequence', () => {
  it('chains every movement to the next', async () => {
    const fixture = await makeVariant({ initialStock: 30 });
    const endpoint = `/api/inventory/variants/${fixture.variantId}`;

    await api().post(`${endpoint}/sales`).set(await authCookie(admin)).send({ quantity: 5 }).expect(201);
    await api()
      .post(`${endpoint}/returns`)
      .set(await authCookie(admin))
      .send({ quantity: 2, reason: 'Swap' })
      .expect(201);
    await api()
      .post(`${endpoint}/adjustments`)
      .set(await authCookie(admin))
      .send({ delta: -3, reason: 'Damaged' })
      .expect(201);
    await api()
      .post(`${endpoint}/stock-in`)
      .set(await authCookie(admin))
      .send({ quantity: 8, reason: 'Restock' })
      .expect(201);

    // 30 - 5 + 2 - 3 + 8
    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: fixture.variantId },
      select: { stockQuantity: true },
    });
    expect(variant.stockQuantity).toBe(32);

    // Replaying the ledger must land on the same figure, with each row chaining to
    // the next: this is the property that makes the history trustworthy.
    const movements = await prisma.inventoryMovement.findMany({
      where: { variantId: fixture.variantId },
      orderBy: { createdAt: 'asc' },
      select: { type: true, quantity: true, previousStock: true, newStock: true },
    });

    let running = 0;
    for (const movement of movements) {
      expect(movement.previousStock).toBe(running);
      running = movement.newStock;
      // The database CHECK enforces abs(new - previous) = quantity; asserted here
      // too so a regression is reported against the API's own guarantee.
      expect(Math.abs(movement.newStock - movement.previousStock)).toBe(movement.quantity);
    }

    expect(running).toBe(32);
  });
});