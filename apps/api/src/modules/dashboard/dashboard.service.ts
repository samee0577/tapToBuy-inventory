import {
  LOW_STOCK_MAX_UNITS,
  RANGE_TO_DAYS,
  deriveStockStatus,
  isAdmin,
  PROFIT_BEARING_MOVEMENT_TYPES,
  profitDirection,
  type DashboardAdminDto,
  type DashboardBaseDto,
  type DashboardCountDto,
  type DashboardDto,
  type DashboardFinancialsDto,
  type DashboardRange,
  type LowStockItemDto,
  type RecentActivityDto,
  type UserRole,
} from '@inventory/shared';
import { prisma } from '../../lib/prisma.js';

/**
 * The dashboard read model.
 *
 * Everything here answers a question the owner asks on opening the app: how much
 * stock is there, what is nearly gone, what moved today, and what did the selected
 * range actually make. All of it is derived from the same ledger the inventory
 * screen reads, so the two can never disagree about what happened.
 *
 * Kept separate from the inventory service because these are aggregates rather
 * than records, and because the ledger's financial snapshots must be read once,
 * here, rather than re-derived per endpoint.
 */

/** How many rows the activity feed shows. A feed, not a report. */
const RECENT_ACTIVITY_LIMIT = 10;

/** How many low-stock items to surface. Ten is enough to act on in one sitting. */
const LOW_STOCK_LIMIT = 10;

/** How many top-earning variants to name. */
const TOP_VARIANTS_LIMIT = 5;

/**
 * The start of the reporting window.
 *
 * Half-open: `gte since, lt now`. Including both ends would double-count a movement
 * sitting exactly on the boundary when two adjacent windows are read together, and
 * `now` is captured once here so every aggregate in the payload agrees on the
 * window rather than each computing its own.
 */
function windowStart(range: DashboardRange, now: number): Date {
  return new Date(now - RANGE_TO_DAYS[range] * 86_400_000);
}

async function countVariants(): Promise<DashboardCountDto> {
  const [totals, activeProducts, allProducts, lowStock, severeLow, outOfStock] =
    await Promise.all([
      prisma.productVariant.aggregate({
        where: { isActive: true },
        _count: { _all: true },
        _sum: { stockQuantity: true },
      }),
      prisma.product.count({ where: { isActive: true } }),
      prisma.product.count(),
      // These two are the queries the (isActive, stockQuantity) index exists for.
      prisma.productVariant.count({
        where: { isActive: true, stockQuantity: { gt: 0, lte: LOW_STOCK_MAX_UNITS } },
      }),
      prisma.productVariant.count({
        where: { isActive: true, stockQuantity: { gt: 0, lte: 2 } },
      }),
      prisma.productVariant.count({
        where: { isActive: true, stockQuantity: { lte: 0 } },
      }),
    ]);

  return {
    totalProducts: allProducts,
    activeProducts,
    totalVariants: totals._count._all,
    totalStockUnits: totals._sum.stockQuantity ?? 0,
    lowStockVariants: lowStock,
    severeLowStockVariants: severeLow,
    outOfStockVariants: outOfStock,
  };
}

/**
 * The most recent movements, newest first.
 *
 * Deliberately not built with the movement serialiser: that shape includes the
 * financial snapshots, and this feed is read by Staff. Selecting the fields the
 * feed actually renders means the cost data is never fetched for a viewer who may
 * not see it, rather than being fetched and stripped.
 */
async function recentActivity(): Promise<RecentActivityDto[]> {
  const rows = await prisma.inventoryMovement.findMany({
    orderBy: { createdAt: 'desc' },
    take: RECENT_ACTIVITY_LIMIT,
    select: {
      id: true,
      variantId: true,
      type: true,
      quantity: true,
      newStock: true,
      createdAt: true,
      variant: {
        select: {
          size: true,
          color: true,
          product: { select: { id: true, name: true } },
        },
      },
      performedBy: { select: { id: true, name: true, role: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    variantId: row.variantId,
    productId: row.variant.product.id,
    productName: row.variant.product.name,
    size: row.variant.size,
    color: row.variant.color,
    type: row.type,
    quantity: row.quantity,
    newStock: row.newStock,
    performedBy: row.performedBy,
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * The variants most in need of restocking.
 *
 * Ordered so empty shelves come first and ties break by name, so the list does not
 * reshuffle between two loads of the same data. `stockStatus` comes from the shared
 * helper the filters use, so a badge can never claim LOW_STOCK for a quantity the
 * stock-status filter would exclude.
 */
async function lowStockItems(): Promise<LowStockItemDto[]> {
  const rows = await prisma.productVariant.findMany({
    where: { isActive: true, stockQuantity: { lte: LOW_STOCK_MAX_UNITS } },
    orderBy: [{ stockQuantity: 'asc' }, { product: { name: 'asc' } }],
    take: LOW_STOCK_LIMIT,
    select: {
      id: true,
      size: true,
      color: true,
      stockQuantity: true,
      product: { select: { id: true, name: true, productCode: true, imageUrl: true } },
    },
  });

  return rows.map((row) => ({
    variantId: row.id,
    productId: row.product.id,
    productName: row.product.name,
    productCode: row.product.productCode,
    imageUrl: row.product.imageUrl,
    size: row.size,
    color: row.color,
    stockQuantity: row.stockQuantity,
    stockStatus: deriveStockStatus(row.stockQuantity),
  }));
}

/**
 * Stock value on hand, at both buying and selling price.
 *
 * Weighted by quantity, which Prisma cannot express as an aggregate because it
 * needs two columns multiplied, so the rows are summed here. Accumulated in minor
 * units (paise) as integers: summing a few hundred decimal currency values must not
 * pick up float error on the way to a figure that gets read as profit.
 */
async function stockValue(): Promise<{ costMinor: number; retailMinor: number }> {
  const rows = await prisma.productVariant.findMany({
    where: { isActive: true },
    select: { stockQuantity: true, buyingPrice: true, sellingPrice: true },
  });

  let costMinor = 0;
  let retailMinor = 0;

  for (const row of rows) {
    costMinor += row.buyingPrice.mul(row.stockQuantity).mul(100).toDecimalPlaces(0).toNumber();
    retailMinor += row.sellingPrice.mul(row.stockQuantity).mul(100).toDecimalPlaces(0).toNumber();
  }

  return { costMinor, retailMinor };
}

/**
 * Realized profit over the window, from the movements themselves.
 *
 * This is the one figure that cannot be recomputed from current state: a sale made
 * last month must still report the margin that applied then, which is exactly why
 * `applyStockChange` freezes price snapshots onto every movement. Summing
 * `unitProfit x quantity` from those snapshots is what leaves a repriced product's
 * historical profit intact.
 *
 * A RETURN subtracts, because the unit goes back on the shelf and its margin is
 * given up — the same direction `profitDirection` states for the single-movement
 * case, reused here so the two cannot disagree.
 */
async function realizedProfit(
  since: Date,
  now: Date,
): Promise<Pick<DashboardFinancialsDto, 'unitsSold' | 'unitsReturned' | 'realizedProfit'>> {
  const movements = await prisma.inventoryMovement.findMany({
    where: { type: { in: [...PROFIT_BEARING_MOVEMENT_TYPES] }, createdAt: { gte: since, lt: now } },
    select: { type: true, quantity: true, unitProfit: true },
  });

  let unitsSold = 0;
  let unitsReturned = 0;
  let profitMinor = 0;

  for (const movement of movements) {
    if (movement.type === 'SALE') unitsSold += movement.quantity;
    else unitsReturned += movement.quantity;

    if (movement.unitProfit !== null) {
      const unitMinor = movement.unitProfit.mul(100).toDecimalPlaces(0).toNumber();
      profitMinor += unitMinor * movement.quantity * profitDirection(movement.type);
    }
  }

  return {
    unitsSold,
    unitsReturned,
    realizedProfit: (profitMinor / 100).toFixed(2),
  };
}

/**
 * The variants that earned the most over the window.
 *
 * Ranked from the same frozen snapshots the realized-profit figure uses, for the
 * same reason: a product repriced today must not rewrite what it made last month.
 * Sales only — a return's negative contribution is already reflected in the
 * realized total, and including it here would rank a variant by a number the owner
 * has no way to reconcile with the feed above.
 */
async function topProfitableVariants(
  since: Date,
  now: Date,
): Promise<DashboardAdminDto['topProfitableVariants']> {
  const movements = await prisma.inventoryMovement.findMany({
    where: { type: 'SALE', createdAt: { gte: since, lt: now } },
    select: { variantId: true, quantity: true, unitProfit: true },
  });

  const byVariant = new Map<string, { units: number; profitMinor: number }>();

  for (const movement of movements) {
    if (movement.unitProfit === null) continue;

    const entry = byVariant.get(movement.variantId) ?? { units: 0, profitMinor: 0 };
    entry.units += movement.quantity;
    entry.profitMinor += movement.unitProfit.mul(100).toDecimalPlaces(0).toNumber() * movement.quantity;
    byVariant.set(movement.variantId, entry);
  }

  const ranked = [...byVariant.entries()]
    .sort((a, b) => b[1].profitMinor - a[1].profitMinor)
    .slice(0, TOP_VARIANTS_LIMIT);

  if (ranked.length === 0) return [];

  // One query for the whole top five, rather than five point lookups.
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: ranked.map(([variantId]) => variantId) } },
    select: {
      id: true,
      productId: true,
      size: true,
      color: true,
      sellingPrice: true,
      stockQuantity: true,
      product: { select: { name: true, productCode: true, imageUrl: true } },
    },
  });

  const byId = new Map(variants.map((variant) => [variant.id, variant]));

  return ranked.flatMap(([variantId, totals]) => {
    const variant = byId.get(variantId);
    if (!variant) return [];

    return [
      {
        variantId: variant.id,
        productId: variant.productId,
        productName: variant.product.name,
        productCode: variant.product.productCode,
        imageUrl: variant.product.imageUrl,
        size: variant.size,
        color: variant.color,
        sellingPrice: variant.sellingPrice.toFixed(2),
        stockQuantity: variant.stockQuantity,
        unitsSold: totals.units,
        profit: (totals.profitMinor / 100).toFixed(2),
      },
    ];
  });
}

/**
 * The dashboard payload.
 *
 * `financials` and `topProfitableVariants` are attached for an Admin only. A Staff
 * client receives counts, the activity feed and the low-stock list — enough to run
 * the shop, with nothing about what things cost or what they made. The financials
 * are not a key on the Staff object at all, so there is nothing to redact later and
 * no controller that can forget to strip a field.
 *
 * The profit aggregates are computed for every role and simply discarded for
 * Staff. One code path means the figures cannot drift apart by role; the alternative
 * — two shapes of the same arithmetic — is exactly the kind of duplication that
 * quietly reports different numbers to an Admin and a Staff member.
 */
export async function getDashboard(range: DashboardRange, role: UserRole): Promise<DashboardDto> {
  const now = new Date();
  const since = windowStart(range, now.getTime());

  const [counts, activity, low, valued, realized, top] = await Promise.all([
    countVariants(),
    recentActivity(),
    lowStockItems(),
    stockValue(),
    realizedProfit(since, now),
    isAdmin(role) ? topProfitableVariants(since, now) : Promise.resolve([]),
  ]);

  const base: DashboardBaseDto = {
    counts,
    recentActivity: activity,
    lowStockItems: low,
    rangeDays: RANGE_TO_DAYS[range],
    generatedAt: now.toISOString(),
  };

  if (!isAdmin(role)) return base;

  return {
    ...base,
    financials: {
      costValue: (valued.costMinor / 100).toFixed(2),
      retailValue: (valued.retailMinor / 100).toFixed(2),
      potentialProfit: ((valued.retailMinor - valued.costMinor) / 100).toFixed(2),
      ...realized,
    },
    topProfitableVariants: top,
  };
}

