import { UserRole } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';

import { ApiErrorCode } from '@inventory/shared';

import { prisma } from '../../src/lib/prisma.js';
import { api, authCookie, createTestUser, type TestUser } from './helpers.js';

/**
 * No fixture cleanup runs in this file, and none can.
 *
 * Creating a product writes inventory movements and price history, both of which
 * are append-only and RESTRICT-referenced from users and categories. Deleting the
 * fixtures is therefore impossible by design — which is precisely the guarantee
 * the application makes about a shop's records. The suite leans on the disposable
 * schema that scripts/prepare-test-db.ts recreates before each run instead.
 */

async function makeUser(role: UserRole): Promise<TestUser> {
  return createTestUser({ role });
}

let categoryId = '';

beforeEach(async () => {
  // A fresh category per test keeps category-scoped queries from leaking between
  // cases without depending on test execution order.
  const category = await prisma.category.create({
    data: { name: `Cat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
    select: { id: true },
  });
  categoryId = category.id;
});

function productBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Classic T-Shirt',
    productCode: `TS-${Date.now()}`,
    categoryId,
    variants: [
      {
        size: 'M',
        color: 'Black',
        buyingPrice: '400.00',
        sellingPrice: '699.00',
        initialStock: 20,
      },
    ],
    ...overrides,
  };
}

describe('POST /api/products authorization', () => {
  it('refuses a STAFF user the ability to create a product', async () => {
    const staff = await makeUser(UserRole.STAFF);
    const probeName = `Staff Must Not Create ${Date.now()}`;

    const response = await api()
      .post('/api/products')
      .set(await authCookie(staff))
      .send(productBody({ name: probeName }))
      .expect(403);

    expect(response.body.error.code).toBe(ApiErrorCode.FORBIDDEN);

    // Nothing was created. The name is unique to this test because products
    // accumulate in the shared schema for the duration of the run.
    expect(await prisma.product.count({ where: { name: probeName } })).toBe(0);
  });

  it('requires authentication', async () => {
    await api().post('/api/products').send(productBody()).expect(401);
  });

  it('lets an ADMIN create a product', async () => {
    const admin = await makeUser(UserRole.ADMIN);

    const response = await api()
      .post('/api/products')
      .set(await authCookie(admin))
      .send(productBody())
      .expect(201);

    expect(response.body.data).toMatchObject({
      name: 'Classic T-Shirt',
      categoryName: expect.any(String),
      variantCount: 1,
      totalStock: 20,
    });
  });
});

describe('product creation', () => {
  it('records opening stock as a STOCK_IN movement, not a silent quantity', async () => {
    const admin = await makeUser(UserRole.ADMIN);

    const response = await api()
      .post('/api/products')
      .set(await authCookie(admin))
      .send(productBody())
      .expect(201);

    const variantId = response.body.data.variants[0].id as string;

    const movement = await prisma.inventoryMovement.findFirstOrThrow({
      where: { variantId },
    });

    expect(movement.type).toBe('STOCK_IN');
    expect(movement.quantity).toBe(20);
    expect(movement.previousStock).toBe(0);
    expect(movement.newStock).toBe(20);
    // The price snapshots are frozen so historical profit stays correct.
    expect(movement.sellingPriceSnapshot?.toFixed(2)).toBe('699.00');
    expect(movement.unitProfit?.toFixed(2)).toBe('299.00');
  });

  it('creates a variant at zero stock when no opening stock is given', async () => {
    const admin = await makeUser(UserRole.ADMIN);

    const response = await api()
      .post('/api/products')
      .set(await authCookie(admin))
      .send(
        productBody({
          variants: [
            {
              size: 'L',
              color: 'Navy',
              buyingPrice: '420.00',
              sellingPrice: '799.00',
              initialStock: 0,
            },
          ],
        }),
      )
      .expect(201);

    expect(response.body.data.totalStock).toBe(0);

    // No movement at all, rather than a zero-quantity one.
    const movements = await prisma.inventoryMovement.count({
      where: { variantId: response.body.data.variants[0].id as string },
    });
    expect(movements).toBe(0);
  });

  it('writes an initial price history entry for each variant', async () => {
    const admin = await makeUser(UserRole.ADMIN);

    const response = await api()
      .post('/api/products')
      .set(await authCookie(admin))
      .send(productBody())
      .expect(201);

    const variantId = response.body.data.variants[0].id as string;
    const entries = await prisma.priceHistory.findMany({ where: { variantId } });

    expect(entries).toHaveLength(1);
    // A null old price is how "this was the starting price" is recorded.
    expect(entries[0]?.oldBuyingPrice).toBeNull();
    expect(entries[0]?.newBuyingPrice.toFixed(2)).toBe('400.00');
  });

  it('rejects a duplicate product code', async () => {
    const admin = await makeUser(UserRole.ADMIN);
    const code = `DUP-${Date.now()}`;

    await api()
      .post('/api/products')
      .set(await authCookie(admin))
      .send(productBody({ productCode: code }))
      .expect(201);

    const response = await api()
      .post('/api/products')
      .set(await authCookie(admin))
      .send(productBody({ productCode: code.toLowerCase() }))
      .expect(409);

    expect(response.body.error.code).toBe(ApiErrorCode.DUPLICATE_PRODUCT_CODE);
  });

  it('rejects two variants with the same size and colour, leaving nothing behind', async () => {
    const admin = await makeUser(UserRole.ADMIN);
    const name = `Atomicity Probe ${Date.now()}`;

    // Counts are taken before the request because earlier cases in this file have
    // legitimately created movements; what matters is that this failed transaction
    // added none.
    const movementsBefore = await prisma.inventoryMovement.count();
    const priceHistoryBefore = await prisma.priceHistory.count();

    const response = await api()
      .post('/api/products')
      .set(await authCookie(admin))
      .send(
        productBody({
          name,
          variants: [
            { size: 'M', color: 'Black', buyingPrice: '400.00', sellingPrice: '699.00', initialStock: 5 },
            { size: 'M', color: 'Black', buyingPrice: '410.00', sellingPrice: '699.00', initialStock: 5 },
          ],
        }),
      )
      .expect(409);

    expect(response.body.error.code).toBe(ApiErrorCode.DUPLICATE_VARIANT);

    // The transaction rolled back completely: no product row, and critically no
    // STOCK_IN movements or price history, which is where a partial write would
    // otherwise leave stock with no ledger entry explaining it.
    expect(await prisma.product.count({ where: { name } })).toBe(0);
    expect(await prisma.inventoryMovement.count()).toBe(movementsBefore);
    expect(await prisma.priceHistory.count()).toBe(priceHistoryBefore);
  });

  it('rejects an unknown category', async () => {
    const admin = await makeUser(UserRole.ADMIN);

    const response = await api()
      .post('/api/products')
      .set(await authCookie(admin))
      .send(productBody({ categoryId: '00000000-0000-4000-8000-000000000000' }))
      .expect(404);

    expect(response.body.error.code).toBe(ApiErrorCode.NOT_FOUND);
  });

  it('rejects a deactivated category', async () => {
    const admin = await makeUser(UserRole.ADMIN);
    await prisma.category.update({ where: { id: categoryId }, data: { isActive: false } });

    const response = await api()
      .post('/api/products')
      .set(await authCookie(admin))
      .send(productBody())
      .expect(400);

    expect(response.body.error.message).toMatch(/deactivated/i);
  });

  it('uppercases the product code so uniqueness is case-insensitive', async () => {
    const admin = await makeUser(UserRole.ADMIN);

    const response = await api()
      .post('/api/products')
      .set(await authCookie(admin))
      .send(productBody({ productCode: `mixed-${Date.now()}` }))
      .expect(201);

    expect(response.body.data.productCode).toMatch(/^MIXED-/);
  });

  it('rejects an invalid image reference', async () => {
    const admin = await makeUser(UserRole.ADMIN);

    const response = await api()
      .post('/api/products')
      .set(await authCookie(admin))
      .send(
        productBody({
          imageKey: 'somebody-elses-asset',
          imageUrl: 'https://res.cloudinary.com/demo/image/upload/x.jpg',
        }),
      )
      .expect(400);

    expect(response.body.error.code).toBe(ApiErrorCode.VALIDATION_ERROR);
  });

  it('accepts a properly shaped Cloudinary reference', async () => {
    const admin = await makeUser(UserRole.ADMIN);
    const publicId = `products/${crypto.randomUUID()}`;

    const response = await api()
      .post('/api/products')
      .set(await authCookie(admin))
      .send(
        productBody({
          imageKey: publicId,
          imageUrl: `https://res.cloudinary.com/demo/image/upload/v1/${publicId}.png`,
        }),
      )
      .expect(201);

    expect(response.body.data.imageKey).toBe(publicId);
  });
});

describe('financial privacy', () => {
  it('omits buying price and profit entirely from a STAFF product payload', async () => {
    const admin = await makeUser(UserRole.ADMIN);
    const staff = await makeUser(UserRole.STAFF);

    const created = await api()
      .post('/api/products')
      .set(await authCookie(admin))
      .send(productBody())
      .expect(201);

    const productId = created.body.data.id as string;

    for (const response of [
      await api().get(`/api/products/${productId}`).set(await authCookie(staff)).expect(200),
      await api().get('/api/products').set(await authCookie(staff)).expect(200),
    ]) {
      const serialised = JSON.stringify(response.body);

      expect(serialised).not.toContain('buyingPrice');
      expect(serialised).not.toContain('unitProfit');
      expect(serialised).not.toContain('marginPercent');
      // The selling price is legitimately visible to Staff.
      expect(serialised).toContain('699.00');
    }
  });

  it('includes buying price and profit for an ADMIN', async () => {
    const admin = await makeUser(UserRole.ADMIN);

    const created = await api()
      .post('/api/products')
      .set(await authCookie(admin))
      .send(productBody())
      .expect(201);

    const productId = created.body.data.id as string;
    const response = await api()
      .get(`/api/products/${productId}`)
      .set(await authCookie(admin))
      .expect(200);

    expect(response.body.data.variants[0]).toMatchObject({
      buyingPrice: '400.00',
      unitProfit: '299.00',
      sellingPrice: '699.00',
    });
  });
});

describe('product listing, search and filtering', () => {
  it('finds a product by name, code, size, colour and category', async () => {
    const admin = await makeUser(UserRole.ADMIN);

    const created = await api()
      .post('/api/products')
      .set(await authCookie(admin))
      .send(
        productBody({
          name: 'Oxford Shirt',
          productCode: `OX-${Date.now()}`,
          variants: [
            { size: 'XL', color: 'Sky Blue', buyingPrice: '900.00', sellingPrice: '1499.00', initialStock: 3 },
          ],
        }),
      )
      .expect(201);

    const productId = created.body.data.id as string;
    const categoryName = created.body.data.categoryName as string;

    for (const search of ['Oxford', created.body.data.productCode, 'XL', 'Sky Blue', categoryName]) {
      const response = await api()
        .get('/api/products')
        .query({ search, status: 'all' })
        .set(await authCookie(admin))
        .expect(200);

      expect(
        response.body.data.items.map((item: { id: string }) => item.id),
        `search "${search}" should find the product`,
      ).toContain(productId);
    }
  });

  it('filters by category and by variant size', async () => {
    const admin = await makeUser(UserRole.ADMIN);

    const created = await api()
      .post('/api/products')
      .set(await authCookie(admin))
      .send(productBody())
      .expect(201);

    const byCategory = await api()
      .get('/api/products')
      .query({ categoryId, status: 'all' })
      .set(await authCookie(admin))
      .expect(200);

    expect(
      byCategory.body.data.items.map((item: { id: string }) => item.id),
    ).toContain(created.body.data.id);

    const bySize = await api()
      .get('/api/products')
      .query({ size: 'M', status: 'all' })
      .set(await authCookie(admin))
      .expect(200);

    expect(bySize.body.data.items.map((item: { id: string }) => item.id)).toContain(
      created.body.data.id,
    );
  });

  it('filters by stock status using the documented thresholds', async () => {
    const admin = await makeUser(UserRole.ADMIN);

    // 3 units is LOW_STOCK (threshold is 5), 40 is IN_STOCK.
    const low = await api()
      .post('/api/products')
      .set(await authCookie(admin))
      .send(
        productBody({
          variants: [
            { size: 'S', color: 'Grey', buyingPrice: '300.00', sellingPrice: '599.00', initialStock: 3 },
          ],
        }),
      )
      .expect(201);

    const stocked = await api()
      .post('/api/products')
      .set(await authCookie(admin))
      .send(
        productBody({
          variants: [
            { size: 'M', color: 'Grey', buyingPrice: '300.00', sellingPrice: '599.00', initialStock: 40 },
          ],
        }),
      )
      .expect(201);

    const lowStock = await api()
      .get('/api/products')
      .query({ stockStatus: 'LOW_STOCK', status: 'all' })
      .set(await authCookie(admin))
      .expect(200);

    const ids = lowStock.body.data.items.map((item: { id: string }) => item.id);
    expect(ids).toContain(low.body.data.id);
    expect(ids).not.toContain(stocked.body.data.id);
  });

  it('hides deactivated products by default but can include them', async () => {
    const admin = await makeUser(UserRole.ADMIN);

    const created = await api()
      .post('/api/products')
      .set(await authCookie(admin))
      .send(productBody())
      .expect(201);

    const productId = created.body.data.id as string;
    await api()
      .patch(`/api/products/${productId}`)
      .set(await authCookie(admin))
      .send({ isActive: false })
      .expect(200);

    const activeOnly = await api()
      .get('/api/products')
      .set(await authCookie(admin))
      .expect(200);
    expect(activeOnly.body.data.items.map((item: { id: string }) => item.id)).not.toContain(productId);

    const includingInactive = await api()
      .get('/api/products')
      .query({ status: 'all' })
      .set(await authCookie(admin))
      .expect(200);
    expect(
      includingInactive.body.data.items.map((item: { id: string }) => item.id),
    ).toContain(productId);
  });

  it('keeps a deactivated product stock sellable rather than stranding it', async () => {
    const admin = await makeUser(UserRole.ADMIN);

    const created = await api()
      .post('/api/products')
      .set(await authCookie(admin))
      .send(productBody())
      .expect(201);

    const productId = created.body.data.id as string;
    await api()
      .patch(`/api/products/${productId}`)
      .set(await authCookie(admin))
      .send({ isActive: false })
      .expect(200);

    const detail = await api()
      .get(`/api/products/${productId}`)
      .set(await authCookie(admin))
      .expect(200);

    expect(detail.body.data.isActive).toBe(false);
    // Stock survives, so staff can still record the sale of the last pieces.
    expect(detail.body.data.totalStock).toBe(20);
    expect(detail.body.data.variants).toHaveLength(1);
  });

  it('sorts and paginates', async () => {
    const admin = await makeUser(UserRole.ADMIN);

    for (const name of ['Alpha', 'Bravo', 'Charlie']) {
      await api()
        .post('/api/products')
        .set(await authCookie(admin))
        .send(productBody({ name }))
        .expect(201);
    }

    const ascending = await api()
      .get('/api/products')
      .query({ sortBy: 'name', sortOrder: 'asc', status: 'all', pageSize: 100 })
      .set(await authCookie(admin))
      .expect(200);

    const names = ascending.body.data.items.map((item: { name: string }) => item.name);
    expect(names).toEqual([...names].sort());

    const page = await api()
      .get('/api/products')
      .query({ sortBy: 'name', sortOrder: 'asc', status: 'all', page: 1, pageSize: 2 })
      .set(await authCookie(admin))
      .expect(200);

    expect(page.body.data.items).toHaveLength(2);
    expect(page.body.data.pageSize).toBe(2);
    expect(page.body.data.totalPages).toBeGreaterThan(1);
  });
});

describe('product update', () => {
  it('lets STAFF correct a product name', async () => {
    const admin = await makeUser(UserRole.ADMIN);
    const staff = await makeUser(UserRole.STAFF);

    const created = await api()
      .post('/api/products')
      .set(await authCookie(admin))
      .send(productBody())
      .expect(201);

    const response = await api()
      .patch(`/api/products/${created.body.data.id}`)
      .set(await authCookie(staff))
      .send({ name: 'Classic Tee (revised)' })
      .expect(200);

    expect(response.body.data.name).toBe('Classic Tee (revised)');
  });

  it('reports 404 for an unknown product', async () => {
    const admin = await makeUser(UserRole.ADMIN);

    const response = await api()
      .patch('/api/products/00000000-0000-4000-8000-000000000000')
      .set(await authCookie(admin))
      .send({ name: 'Nope' })
      .expect(404);

    expect(response.body.error.code).toBe(ApiErrorCode.NOT_FOUND);
  });

  it('has no delete route', async () => {
    const admin = await makeUser(UserRole.ADMIN);

    const created = await api()
      .post('/api/products')
      .set(await authCookie(admin))
      .send(productBody())
      .expect(201);

    await api()
      .delete(`/api/products/${created.body.data.id}`)
      .set(await authCookie(admin))
      .expect(404);

    expect(
      await prisma.product.count({ where: { id: created.body.data.id } }),
    ).toBe(1);
  });
});