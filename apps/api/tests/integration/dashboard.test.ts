import { UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import {
  ApiErrorCode,
  deriveStockStatus,
  hasDashboardFinancials,
  type DashboardAdminDto,
  type DashboardCountDto,
  type DashboardDto,
  type LowStockItemDto,
} from '@inventory/shared';

import { prisma } from '../../src/lib/prisma.js';
import { api, authCookie, createTestUser, type TestUser } from './helpers.js';

/**
 * The dashboard read model.
 *
 * The assertions are deliberately about *shape and consistency* rather than about
 * exact totals. Every suite shares one disposable schema, so absolute figures drift
 * as other files add fixtures — asserting them would make this file hostage to the
 * run order. What is stable, and what these tests actually check, is that the two
 * roles receive different payloads and that each payload's own numbers add up.
 */

function unique(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

async function admin(): Promise<TestUser> {
  return createTestUser({ role: UserRole.ADMIN });
}

async function staff(): Promise<TestUser> {
  return createTestUser({ role: UserRole.STAFF });
}

/**
 * A category, product and variant at the given stock.
 *
 * The variant is created with stock already on it rather than through the inventory
 * endpoint: this suite is about reading aggregates, and opening stock here would
 * only add movements to filter out of the activity assertions.
 */
async function makeVariant(stock: number, sellingPrice = '699.00', buyingPrice = '400.00') {
  const category = await prisma.category.create({
    data: { name: unique('DashCat') },
    select: { id: true },
  });

  const variant = await prisma.productVariant.create({
    data: {
      product: {
        create: {
          name: unique('Dashboard Product'),
          productCode: unique('DP'),
          categoryId: category.id,
        },
      },
      size: 'M',
      color: 'Black',
      buyingPrice,
      sellingPrice,
      stockQuantity: stock,
    },
    select: { id: true, productId: true },
  });

  return { variantId: variant.id, productId: variant.productId, categoryId: category.id };
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /api/dashboard authorization', () => {
  it('requires authentication', async () => {
    await api().get('/api/dashboard').expect(401);
  });

  it('lets STAFF read the dashboard', async () => {
    const response = await api()
      .get('/api/dashboard')
      .set(await authCookie(await staff()))
      .expect(200);

    expect(response.body.data.counts).toBeDefined();
  });
});

describe('GET /api/dashboard for an ADMIN', () => {
  it('includes the financial block', async () => {
    const response = await api()
      .get('/api/dashboard')
      .set(await authCookie(await admin()))
      .expect(200);

    const data = response.body.data as DashboardDto;
    expect(hasDashboardFinancials(data)).toBe(true);

    const adminData = data as DashboardAdminDto;
    expect(adminData.financials).toMatchObject({
      costValue: expect.any(String),
      retailValue: expect.any(String),
      potentialProfit: expect.any(String),
      unitsSold: expect.any(Number),
      unitsReturned: expect.any(Number),
      realizedProfit: expect.any(String),
    });

    for (const value of [
      adminData.financials.costValue,
      adminData.financials.retailValue,
      adminData.financials.potentialProfit,
      adminData.financials.realizedProfit,
    ]) {
      expect(value).toMatch(/^-?\d+\.\d{2}$/);
    }
  });

  it('reports potential profit as retail minus cost', async () => {
    const response = await api()
      .get('/api/dashboard')
      .set(await authCookie(await admin()))
      .expect(200);

    const { financials } = response.body.data as DashboardAdminDto;

    // The one invariant worth asserting regardless of what else is in the shared
    // schema: the three stock-value figures must be mutually consistent, or the
    // dashboard is showing arithmetic that does not add up.
    expect(Number(financials.potentialProfit)).toBe(
      Number(financials.retailValue) - Number(financials.costValue),
    );
  });

  it('names the range it measured and when it generated the payload', async () => {
    const response = await api()
      .get('/api/dashboard')
      .query({ range: '7d' })
      .set(await authCookie(await admin()))
      .expect(200);

    expect(response.body.data.rangeDays).toBe(7);
    expect(Date.parse(response.body.data.generatedAt)).not.toBeNaN();
  });

  it('defaults to a 30 day window so the first load is useful', async () => {
    const response = await api()
      .get('/api/dashboard')
      .set(await authCookie(await admin()))
      .expect(200);

    expect(response.body.data.rangeDays).toBe(30);
  });

  it('rejects an unrecognised range rather than silently defaulting', async () => {
    const response = await api()
      .get('/api/dashboard')
      .query({ range: '18mo' })
      .set(await authCookie(await admin()))
      .expect(400);

    expect(response.body.error.code).toBe(ApiErrorCode.VALIDATION_ERROR);
  });
});

describe('GET /api/dashboard for STAFF', () => {
  it('omits the financial block entirely', async () => {
    await makeVariant(10);

    const response = await api()
      .get('/api/dashboard')
      .set(await authCookie(await staff()))
      .expect(200);

    const data = response.body.data as DashboardDto;
    expect(hasDashboardFinancials(data)).toBe(false);

    // Absent rather than blanked: there is no key on the wire to un-hide, and no
    // future edit to the serialiser that can leak it by forgetting a field.
    const serialised = JSON.stringify(data);
    expect(serialised).not.toContain('realizedProfit');
    expect(serialised).not.toContain('potentialProfit');
    expect(serialised).not.toContain('costValue');
    expect(serialised).not.toContain('topProfitableVariants');
  });

  it('still receives counts, activity and low-stock items', async () => {
    await makeVariant(3);

    const response = await api()
      .get('/api/dashboard')
      .set(await authCookie(await staff()))
      .expect(200);

    const data = response.body.data as DashboardDto;

    expect(data.counts).toMatchObject({
      totalProducts: expect.any(Number),
      totalVariants: expect.any(Number),
      totalStockUnits: expect.any(Number),
      lowStockVariants: expect.any(Number),
      outOfStockVariants: expect.any(Number),
    });
    expect(Array.isArray(data.recentActivity)).toBe(true);
    expect(Array.isArray(data.lowStockItems)).toBe(true);
  });

  it('gives STAFF the same counts an ADMIN sees', async () => {
    const adminUser = await admin();
    const staffUser = await staff();

    // Written between the two reads so a stable dataset cannot hide a discrepancy:
    // a new variant must appear in both counts.
    const fixture = await makeVariant(7);

    const [asAdmin, asStaff] = await Promise.all([
      api().get('/api/dashboard').set(await authCookie(adminUser)).expect(200),
      api().get('/api/dashboard').set(await authCookie(staffUser)).expect(200),
    ]);

    expect(asStaff.body.data.counts).toEqual(asAdmin.body.data.counts);

    const ids = asStaff.body.data.lowStockItems.map(
      (item: { variantId: string }) => item.variantId,
    );
    // 7 units is above the low-stock threshold, so this one is in the counts but
    // not on the restock list.
    expect(ids).not.toContain(fixture.variantId);
  });
});

describe('low stock items', () => {
  it('counts a low variant in the totals', async () => {
    // 2 units: inside the low-stock band (1..5) and inside the severe band (1..2).
    const before = await api()
      .get('/api/dashboard')
      .set(await authCookie(await admin()))
      .expect(200);

    await makeVariant(2);

    const after = await api()
      .get('/api/dashboard')
      .set(await authCookie(await admin()))
      .expect(200);

    // Asserted on the counters rather than the ten-row feed, because the feed is
    // capped and ordered emptiest-first: once this file has created a dozen low
    // variants, a newly created one is legitimately crowded out of it. The counters
    // cover the whole catalogue, which is what this assertion is actually about.
    const previous = before.body.data.counts as DashboardCountDto;
    const current = after.body.data.counts as DashboardCountDto;

    expect(current.totalVariants).toBe(previous.totalVariants + 1);
    expect(current.lowStockVariants).toBe(previous.lowStockVariants + 1);
    expect(current.severeLowStockVariants).toBe(previous.severeLowStockVariants + 1);
    expect(current.outOfStockVariants).toBe(previous.outOfStockVariants);
  });

  it('labels each item with the status the shared thresholds imply', async () => {
    // Spanning quantities including zero, since the feed is ordered emptiest-first
    // and earlier cases in this file have already left a full list above them: the
    // assertion is on the labelling rule for whatever is present, not on which rows
    // survive the cap.
    for (const stock of [0, 1, 3, 5]) {
      await makeVariant(stock);
    }

    const response = await api()
      .get('/api/dashboard')
      .set(await authCookie(await admin()))
      .expect(200);

    const items = response.body.data.lowStockItems as Array<{
      stockQuantity: number;
      stockStatus: string;
    }>;

    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.stockStatus).toBe(deriveStockStatus(item.stockQuantity));
    }

    // Every row in this list is at or below the low-stock ceiling by definition of
    // the query, so no row may claim a healthy status.
    expect(items.some((item) => item.stockStatus === 'IN_STOCK')).toBe(false);
  });

  it('excludes a well-stocked variant', async () => {
    const fixture = await makeVariant(50);

    const response = await api()
      .get('/api/dashboard')
      .set(await authCookie(await admin()))
      .expect(200);

    const ids = response.body.data.lowStockItems.map(
      (item: { variantId: string }) => item.variantId,
    );
    expect(ids).not.toContain(fixture.variantId);
  });

  it('puts the emptiest shelves first', async () => {
    await makeVariant(4);
    await makeVariant(0);
    await makeVariant(2);

    const response = await api()
      .get('/api/dashboard')
      .set(await authCookie(await admin()))
      .expect(200);

    const quantities = (response.body.data.lowStockItems as LowStockItemDto[]).map(
      (item) => item.stockQuantity,
    );

    // A feed the owner acts on top-down must lead with the item that is actually
    // out, so the ordering itself is the assertion.
    expect(quantities).toEqual([...quantities].sort((a, b) => a - b));
    expect(quantities[0]).toBe(0);
  });

  it('never shows more than the documented cap', async () => {
    for (let index = 0; index < 12; index += 1) {
      await makeVariant(index % 6);
    }

    const response = await api()
      .get('/api/dashboard')
      .set(await authCookie(await admin()))
      .expect(200);

    // Truncated, not paginated: this is a dashboard, and a count that silently
    // changed shape would be worse than one that stops at ten.
    expect(response.body.data.lowStockItems.length).toBeLessThanOrEqual(10);
  });
});

describe('recent activity', () => {
  it('labels each movement with who did it and what it changed', async () => {
    const user = await admin();
    const fixture = await makeVariant(10);

    await api()
      .post(`/api/inventory/variants/${fixture.variantId}/sales`)
      .set(await authCookie(user))
      .send({ quantity: 2 })
      .expect(201);

    const response = await api()
      .get('/api/dashboard')
      .set(await authCookie(user))
      .expect(200);

    const feed = response.body.data.recentActivity as Array<{
      variantId: string;
      type: string;
      quantity: number;
      newStock: number;
      performedBy: { id: string };
    }>;

    const found = feed.find((entry) => entry.variantId === fixture.variantId);
    expect(found).toBeDefined();
    expect(found).toMatchObject({ type: 'SALE', quantity: 2, newStock: 8 });
    expect(found?.performedBy.id).toBe(user.id);
  });

  it('carries no cost figures, since STAFF can read this feed', async () => {
    const user = await admin();
    const fixture = await makeVariant(10);

    await api()
      .post(`/api/inventory/variants/${fixture.variantId}/sales`)
      .set(await authCookie(user))
      .send({ quantity: 1 })
      .expect(201);

    const response = await api()
      .get('/api/dashboard')
      .set(await authCookie(await staff()))
      .expect(200);

    const serialised = JSON.stringify(response.body.data.recentActivity);
    expect(serialised).not.toContain('buyingPrice');
    expect(serialised).not.toContain('unitProfit');
    expect(serialised).not.toContain('profit');
  });

  it('is newest first and capped', async () => {
    const user = await admin();
    const fixture = await makeVariant(20);

    for (const quantity of [1, 2, 3]) {
      await api()
        .post(`/api/inventory/variants/${fixture.variantId}/sales`)
        .set(await authCookie(user))
        .send({ quantity })
        .expect(201);
    }

    const response = await api()
      .get('/api/dashboard')
      .set(await authCookie(user))
      .expect(200);

    const feed = response.body.data.recentActivity as Array<{ createdAt: string }>;
    expect(feed.length).toBeLessThanOrEqual(10);

    const timestamps = feed.map((entry) => Date.parse(entry.createdAt));
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
  });
});

describe('realized profit comes from the frozen snapshots', () => {
  it('does not change when the variant is repriced afterwards', async () => {
    const user = await admin();
    const fixture = await makeVariant(10, '699.00', '400.00');

    // 699 - 400 = 299 per unit.
    await api()
      .post(`/api/inventory/variants/${fixture.variantId}/sales`)
      .set(await authCookie(user))
      .send({ quantity: 1 })
      .expect(201);

    const before = (await api()
      .get('/api/dashboard')
      .query({ range: '7d' })
      .set(await authCookie(user))
      .expect(200)).body.data.financials.realizedProfit as string;

    await api()
      .patch(`/api/variants/${fixture.variantId}`)
      .set(await authCookie(user))
      .send({ buyingPrice: '500.00', sellingPrice: '1200.00' })
      .expect(200);

    const after = (await api()
      .get('/api/dashboard')
      .query({ range: '7d' })
      .set(await authCookie(user))
      .expect(200)).body.data.financials.realizedProfit as string;

    // The whole reason applyStockChange freezes prices onto the movement: the sale
    // still made 299, whatever the variant costs now.
    expect(after).toBe(before);
  });

  it('counts a sale as sold and a return as returned, netting the profit', async () => {
    const user = await admin();
    const fixture = await makeVariant(20);

    await api()
      .post(`/api/inventory/variants/${fixture.variantId}/sales`)
      .set(await authCookie(user))
      .send({ quantity: 4 })
      .expect(201);
    await api()
      .post(`/api/inventory/variants/${fixture.variantId}/returns`)
      .set(await authCookie(user))
      .send({ quantity: 1, reason: 'Swap' })
      .expect(201);

    const response = await api()
      .get('/api/dashboard')
      .query({ range: '7d' })
      .set(await authCookie(user))
      .expect(200);

    const { financials } = response.body.data as DashboardAdminDto;

    // The shared schema counts these two separately, so the UI can say "sold 4,
    // returned 1" rather than only the net.
    expect(financials.unitsSold).toBeGreaterThanOrEqual(4);
    expect(financials.unitsReturned).toBeGreaterThanOrEqual(1);
    expect(Number(financials.realizedProfit)).toBeGreaterThan(0);
  });

  it('ranks the best sellers for an ADMIN', async () => {
    const user = await admin();
    const seller = await makeVariant(20, '699.00', '400.00');

    await api()
      .post(`/api/inventory/variants/${seller.variantId}/sales`)
      .set(await authCookie(user))
      .send({ quantity: 3 })
      .expect(201);

    const response = await api()
      .get('/api/dashboard')
      .query({ range: '7d' })
      .set(await authCookie(user))
      .expect(200);

    const top = response.body.data.topProfitableVariants as Array<{
      variantId: string;
      unitsSold: number;
      profit: string;
    }>;

    expect(Array.isArray(top)).toBe(true);
    expect(top.length).toBeLessThanOrEqual(5);

    // Only a variant that actually sold can appear, so this list cannot be
    // populated by rows with no movement behind them.
    for (const row of top) {
      expect(row.unitsSold).toBeGreaterThan(0);
      expect(row.profit).toMatch(/^-?\d+\.\d{2}$/);
    }
  });
});

describe('the dashboard and the inventory screen agree', () => {
  it('reports the same low-stock total the stock filter would return', async () => {
    const user = await admin();

    const dashboard = await api()
      .get('/api/dashboard')
      .set(await authCookie(user))
      .expect(200);

    const inventory = await api()
      .get('/api/inventory')
      // `status=active` is the default, and is what makes this comparable: the
      // dashboard counts active variants only, so asking the stock screen for
      // `status=all` would add deactivated lines the dashboard deliberately ignores
      // — a retired variant is not restocked, so counting it as "low" is noise.
      .query({ stockStatus: 'LOW_STOCK', pageSize: 1 })
      .set(await authCookie(user))
      .expect(200);

    const counted = (dashboard.body.data.counts as DashboardCountDto).lowStockVariants;
    const filtered = inventory.body.data.total as number;

    // Two screens deriving "low stock" separately is exactly how an owner ends up
    // chasing a discrepancy: the dashboard says eleven variants are low, the stock
    // screen finds ten. Compared as totals because both queries cover the whole
    // catalogue, which is unaffected by the ten-row cap on the dashboard's feed.
    expect(counted).toBe(filtered);
  });
});