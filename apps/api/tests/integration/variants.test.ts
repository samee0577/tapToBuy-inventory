import { UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { ApiErrorCode } from '@inventory/shared';

import { prisma } from '../../src/lib/prisma.js';
import { api, authCookie, createTestUser, type TestUser } from './helpers.js';

async function admin(): Promise<TestUser> {
  return createTestUser({ role: UserRole.ADMIN });
}

async function staff(): Promise<TestUser> {
  return createTestUser({ role: UserRole.STAFF });
}

function unique(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

interface Fixture {
  productId: string;
  variantId: string;
  categoryId: string;
}

/**
 * Creates a product with one variant. `initialStock` decides whether the variant
 * has any movement history, which is what the size/colour freeze rule depends on.
 */
async function makeProduct(
  adminUser: TestUser,
  options?: { initialStock?: number },
): Promise<Fixture> {
  const category = await prisma.category.create({
    data: { name: unique('Vcat') },
    select: { id: true },
  });

  const created = await api()
    .post('/api/products')
    .set(await authCookie(adminUser))
    .send({
      name: unique('Variant Product'),
      productCode: unique('VP'),
      categoryId: category.id,
      variants: [
        {
          size: 'M',
          color: 'Black',
          buyingPrice: '400.00',
          sellingPrice: '699.00',
          initialStock: options?.initialStock ?? 0,
        },
      ],
    })
    .expect(201);

  return {
    productId: created.body.data.id as string,
    variantId: created.body.data.variants[0].id as string,
    categoryId: category.id,
  };
}

describe('POST /api/products/:id/variants authorization', () => {
  it('lets an ADMIN add a variant', async () => {
    const user = await admin();
    const fixture = await makeProduct(user);

    const response = await api()
      .post(`/api/products/${fixture.productId}/variants`)
      .set(await authCookie(user))
      .send({
        size: 'L',
        color: 'Navy',
        buyingPrice: '420.00',
        sellingPrice: '799.00',
        initialStock: 6,
      })
      .expect(201);

    expect(response.body.data).toMatchObject({ size: 'L', color: 'Navy', stockQuantity: 6 });
    // Admin sees the cost, since they supplied it.
    expect(response.body.data.buyingPrice).toBe('420.00');
  });

  it('refuses a STAFF user the ability to add a variant', async () => {
    const adminUser = await admin();
    const staffUser = await staff();
    const fixture = await makeProduct(adminUser);

    const response = await api()
      .post(`/api/products/${fixture.productId}/variants`)
      .set(await authCookie(staffUser))
      .send({
        size: 'XL',
        color: 'Black',
        buyingPrice: '500.00',
        sellingPrice: '899.00',
        initialStock: 3,
      })
      .expect(403);

    expect(response.body.error.code).toBe(ApiErrorCode.FORBIDDEN);

    const count = await prisma.productVariant.count({
      where: { productId: fixture.productId },
    });
    expect(count).toBe(1);
  });

  it('requires authentication', async () => {
    await api().post('/api/products/some-id/variants').send({}).expect(401);
  });

  it('rejects a duplicate size and colour for the same product', async () => {
    const user = await admin();
    const fixture = await makeProduct(user);

    const response = await api()
      .post(`/api/products/${fixture.productId}/variants`)
      .set(await authCookie(user))
      .send({
        size: 'm',
        color: 'black',
        buyingPrice: '410.00',
        sellingPrice: '699.00',
        initialStock: 2,
      })
      .expect(409);

    expect(response.body.error.code).toBe(ApiErrorCode.DUPLICATE_VARIANT);
  });

  it('records initial stock as a movement and a starting price history', async () => {
    const user = await admin();
    const fixture = await makeProduct(user);

    const created = await api()
      .post(`/api/products/${fixture.productId}/variants`)
      .set(await authCookie(user))
      .send({
        size: 'S',
        color: 'Olive',
        buyingPrice: '350.00',
        sellingPrice: '649.00',
        initialStock: 9,
      })
      .expect(201);

    const variantId = created.body.data.id as string;

    const movement = await prisma.inventoryMovement.findFirstOrThrow({
      where: { variantId },
    });
    expect(movement.type).toBe('STOCK_IN');
    expect(movement.previousStock).toBe(0);
    expect(movement.newStock).toBe(9);

    expect(await prisma.priceHistory.count({ where: { variantId } })).toBe(1);
  });

  it('reports 404 when the product does not exist', async () => {
    const user = await admin();

    const response = await api()
      .post('/api/products/00000000-0000-4000-8000-000000000000/variants')
      .set(await authCookie(user))
      .send({
        size: 'M',
        color: 'Black',
        buyingPrice: '400.00',
        sellingPrice: '699.00',
        initialStock: 1,
      })
      .expect(404);

    expect(response.body.error.code).toBe(ApiErrorCode.NOT_FOUND);
  });
});

describe('PATCH /api/variants/:id price changes', () => {
  it('writes one price history entry when the selling price changes', async () => {
    const user = await admin();
    const fixture = await makeProduct(user);

    const before = await prisma.priceHistory.count({ where: { variantId: fixture.variantId } });

    const response = await api()
      .patch(`/api/variants/${fixture.variantId}`)
      .set(await authCookie(user))
      .send({ sellingPrice: '749.00' })
      .expect(200);

    expect(response.body.data.sellingPrice).toBe('749.00');

    const entries = await prisma.priceHistory.findMany({
      where: { variantId: fixture.variantId },
      orderBy: { changedAt: 'asc' },
    });

    expect(entries).toHaveLength(before + 1);
    expect(entries.at(-1)?.oldSellingPrice?.toFixed(2)).toBe('699.00');
    expect(entries.at(-1)?.newSellingPrice.toFixed(2)).toBe('749.00');
  });

  it('updates the variant and the history atomically', async () => {
    const user = await admin();
    const fixture = await makeProduct(user);

    await api()
      .patch(`/api/variants/${fixture.variantId}`)
      .set(await authCookie(user))
      .send({ sellingPrice: '849.00', buyingPrice: '450.00' })
      .expect(200);

    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: fixture.variantId },
      select: { sellingPrice: true, buyingPrice: true },
    });

    expect(variant.sellingPrice.toFixed(2)).toBe('849.00');
    expect(variant.buyingPrice.toFixed(2)).toBe('450.00');
  });

  it('writes no history entry when the price is unchanged', async () => {
    const user = await admin();
    const fixture = await makeProduct(user);

    const before = await prisma.priceHistory.count({ where: { variantId: fixture.variantId } });

    await api()
      .patch(`/api/variants/${fixture.variantId}`)
      .set(await authCookie(user))
      .send({ sellingPrice: '699.00' })
      .expect(200);

    expect(await prisma.priceHistory.count({ where: { variantId: fixture.variantId } })).toBe(
      before,
    );
  });

  it('writes no history entry when only isActive changes', async () => {
    const user = await admin();
    const fixture = await makeProduct(user);

    const before = await prisma.priceHistory.count({ where: { variantId: fixture.variantId } });

    await api()
      .patch(`/api/variants/${fixture.variantId}`)
      .set(await authCookie(user))
      .send({ isActive: false })
      .expect(200);

    expect(await prisma.priceHistory.count({ where: { variantId: fixture.variantId } })).toBe(
      before,
    );
  });

  it('recomputes profit from the frozen prices', async () => {
    const user = await admin();
    const fixture = await makeProduct(user);

    const response = await api()
      .patch(`/api/variants/${fixture.variantId}`)
      .set(await authCookie(user))
      .send({ sellingPrice: '699.00', buyingPrice: '299.00' })
      .expect(200);

    expect(response.body.data.unitProfit).toBe('400.00');
    expect(response.body.data.marginPercent).toBe('57.22');
  });
});

describe('PATCH /api/variants/:id identity fields', () => {
  it('allows a size change while the variant has no stock history', async () => {
    const user = await admin();
    const fixture = await makeProduct(user, { initialStock: 0 });

    const response = await api()
      .patch(`/api/variants/${fixture.variantId}`)
      .set(await authCookie(user))
      .send({ size: 'XL', color: 'Charcoal' })
      .expect(200);

    expect(response.body.data).toMatchObject({ size: 'XL', color: 'Charcoal' });
  });

  it('freezes size and colour once the variant has stock history', async () => {
    const user = await admin();
    const fixture = await makeProduct(user, { initialStock: 12 });

    const response = await api()
      .patch(`/api/variants/${fixture.variantId}`)
      .set(await authCookie(user))
      .send({ size: 'XL' })
      .expect(409);

    expect(response.body.error.code).toBe(ApiErrorCode.VALIDATION_ERROR);
    expect(response.body.error.message).toMatch(/stock history/i);
    expect(response.body.error.message).toMatch(/deactivate/i);

    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: fixture.variantId },
      select: { size: true, color: true },
    });
    expect(variant.size).toBe('M');
    expect(variant.color).toBe('Black');
  });

  it('still allows a price change on a variant whose identity is frozen', async () => {
    const user = await admin();
    const fixture = await makeProduct(user, { initialStock: 12 });

    const response = await api()
      .patch(`/api/variants/${fixture.variantId}`)
      .set(await authCookie(user))
      .send({ sellingPrice: '799.00' })
      .expect(200);

    expect(response.body.data.sellingPrice).toBe('799.00');
  });
});

describe('variant editing by role', () => {
  it('lets STAFF change a selling price but never sees the buying price', async () => {
    const adminUser = await admin();
    const staffUser = await staff();
    const fixture = await makeProduct(adminUser);

    const response = await api()
      .patch(`/api/variants/${fixture.variantId}`)
      .set(await authCookie(staffUser))
      .send({ sellingPrice: '729.00' })
      .expect(200);

    expect(response.body.data.sellingPrice).toBe('729.00');
    expect(JSON.stringify(response.body)).not.toContain('buyingPrice');
    expect(JSON.stringify(response.body)).not.toContain('unitProfit');
  });

  it('refuses a STAFF attempt to change a buying price', async () => {
    const adminUser = await admin();
    const staffUser = await staff();
    const fixture = await makeProduct(adminUser);

    const response = await api()
      .patch(`/api/variants/${fixture.variantId}`)
      .set(await authCookie(staffUser))
      .send({ sellingPrice: '729.00', buyingPrice: '1.00' })
      .expect(403);

    expect(response.body.error.code).toBe(ApiErrorCode.FORBIDDEN);

    // The legitimate half of that request must not have been applied either.
    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: fixture.variantId },
      select: { sellingPrice: true, buyingPrice: true },
    });
    expect(variant.sellingPrice.toFixed(2)).toBe('699.00');
    expect(variant.buyingPrice.toFixed(2)).toBe('400.00');
  });

  it('rejects a variant update for an unknown id', async () => {
    const user = await admin();

    const response = await api()
      .patch('/api/variants/00000000-0000-4000-8000-000000000000')
      .set(await authCookie(user))
      .send({ isActive: false })
      .expect(404);

    expect(response.body.error.code).toBe(ApiErrorCode.NOT_FOUND);
  });
});

describe('GET /api/products/:id/price-history', () => {
  it('is forbidden for STAFF, since it exposes buying prices', async () => {
    const adminUser = await admin();
    const staffUser = await staff();
    const fixture = await makeProduct(adminUser);

    const response = await api()
      .get(`/api/products/${fixture.productId}/price-history/${fixture.variantId}`)
      .set(await authCookie(staffUser))
      .expect(403);

    expect(response.body.error.code).toBe(ApiErrorCode.FORBIDDEN);
  });

  it('returns the timeline for an ADMIN, newest first', async () => {
    const user = await admin();
    const fixture = await makeProduct(user);

    await api()
      .patch(`/api/variants/${fixture.variantId}`)
      .set(await authCookie(user))
      .send({ sellingPrice: '749.00' })
      .expect(200);

    const response = await api()
      .get(`/api/products/${fixture.productId}/price-history/${fixture.variantId}`)
      .set(await authCookie(user))
      .expect(200);

    const data = response.body.data as {
      currentSellingPrice: string;
      entries: Array<{ oldSellingPrice: string | null; newSellingPrice: string }>;
    };

    expect(data.currentSellingPrice).toBe('749.00');
    expect(data.entries).toHaveLength(2);
    // The creation entry has no previous price, which is how "starting price"
    // is represented.
    expect(data.entries[1]?.oldSellingPrice).toBeNull();
    expect(data.entries[0]?.newSellingPrice).toBe('749.00');
  });

  it('does not leak a variant belonging to a different product', async () => {
    const user = await admin();
    const first = await makeProduct(user);
    const second = await makeProduct(user);

    const response = await api()
      .get(`/api/products/${second.productId}/price-history/${first.variantId}`)
      .set(await authCookie(user))
      .expect(404);

    expect(response.body.error.code).toBe(ApiErrorCode.NOT_FOUND);
  });
});