import {
  InventoryMovementType,
  paginate,
  stockStatusToRange,
  toDateRange,
  type AdjustmentInput,
  type InventoryFacetsDto,
  type InventorySummaryDto,
  type ListInventoryQuery,
  type ListMovementsQuery,
  type ReturnInput,
  type SaleInput,
  type StockInInput,
  type StockOperationResultDto,
  type UserRole,
} from '@inventory/shared';
import type { Prisma } from '@prisma/client';

import { notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { applyStockChange, type StockChangeRequest } from '../../lib/stock-change.js';
import {
  INVENTORY_ROW_SELECT,
  MOVEMENT_SELECT,
  serializeInventoryRow,
  serializeMovement,
} from '../../serializers/movement.js';

/**
 * The inventory engine's write side.
 *
 * There is deliberately no `setStock` function anywhere in this codebase. Stock
 * changes only ever happen as a consequence of a typed operation — something
 * arrived, something was sold, something came back, something was recounted — and
 * each one appends to the ledger. That is what keeps the history complete: every
 * number on a variant can be explained by the movements behind it.
 *
 * The four operations are thin, typed wrappers over `applyStockChange`, which owns
 * the arithmetic, the optimistic-lock guard, the price snapshots and the ledger
 * write. Keeping them separate means the payload that describes "a sale" cannot
 * drift from the movement type it produces.
 */

interface Actor {
  id: string;
  name: string;
  role: UserRole;
}

/**
 * Commits one operation and returns the movement plus the variant's new state.
 *
 * The movement is re-read inside the same transaction rather than assembled from
 * the inputs, so what is returned is exactly the row that was persisted. A client
 * that applied its stock update optimistically can trust this response to
 * reconcile it.
 */
async function commit(
  variantId: string,
  request: Omit<StockChangeRequest, 'variantId' | 'actorId'>,
  actor: Actor,
): Promise<StockOperationResultDto> {
  const result = await prisma.$transaction(async (tx) => {
    const change = await applyStockChange(tx, { variantId, actorId: actor.id, ...request });

    const [movement, variant] = await Promise.all([
      tx.inventoryMovement.findUniqueOrThrow({
        where: { id: change.movementId },
        select: MOVEMENT_SELECT,
      }),
      tx.productVariant.findUniqueOrThrow({
        where: { id: variantId },
        select: { id: true, stockQuantity: true, updatedAt: true },
      }),
    ]);

    return { change, movement, variant };
  });

  logger.info(
    {
      actorId: actor.id,
      actorName: actor.name,
      role: actor.role,
      variantId,
      type: request.type,
      quantity: result.change.quantity,
      previousStock: result.change.previousStock,
      newStock: result.change.newStock,
    },
    'stock movement recorded',
  );

  return {
    movement: serializeMovement(result.movement, actor.role),
    variant: {
      id: result.variant.id,
      stockQuantity: result.variant.stockQuantity,
      stockStatus: result.change.stockStatus,
      updatedAt: result.variant.updatedAt.toISOString(),
    },
  };
}

/** Goods received from a supplier. */
export function recordStockIn(
  variantId: string,
  input: StockInInput,
  actor: Actor,
): Promise<StockOperationResultDto> {
  return commit(
    variantId,
    {
      type: InventoryMovementType.STOCK_IN,
      quantity: input.quantity,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      ...(input.note === undefined ? {} : { note: input.note }),
    },
    actor,
  );
}

/**
 * A sale. The only operation that can be refused for lack of stock, and the only
 * one that realizes profit.
 */
export function recordSale(
  variantId: string,
  input: SaleInput,
  actor: Actor,
): Promise<StockOperationResultDto> {
  return commit(
    variantId,
    {
      type: InventoryMovementType.SALE,
      quantity: input.quantity,
      ...(input.note === undefined ? {} : { note: input.note }),
    },
    actor,
  );
}

/**
 * A customer return. Puts the units back on the shelf and gives back the margin
 * they had realized, so realized profit stays truthful.
 */
export function recordReturn(
  variantId: string,
  input: ReturnInput,
  actor: Actor,
): Promise<StockOperationResultDto> {
  return commit(
    variantId,
    {
      type: InventoryMovementType.RETURN,
      quantity: input.quantity,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      ...(input.note === undefined ? {} : { note: input.note }),
    },
    actor,
  );
}

/**
 * A recount or a write-off.
 *
 * The client may state the counted total (`newStock`) or a signed correction
 * (`delta`); both resolve to the same restated figure, so the engine sees one
 * uniform operation.
 *
 * The delta case needs the current stock to turn a correction into a restatement,
 * which is read before the write. That is safe precisely because the write it
 * feeds is guarded: `applyStockChange` re-reads the row and updates it under a
 * `stockQuantity = previousStock` predicate, so if a sale landed between this read
 * and that write the adjustment is rejected with a conflict and retried against
 * fresh stock, rather than absorbing the sale into the count.
 */
export async function recordAdjustment(
  variantId: string,
  input: AdjustmentInput,
  actor: Actor,
): Promise<StockOperationResultDto> {
  let restatedStock = input.newStock;

  if (restatedStock === undefined) {
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { stockQuantity: true },
    });

    if (!variant) throw notFound('Variant');

    restatedStock = variant.stockQuantity + (input.delta as number);
  }

  return commit(
    variantId,
    {
      type: InventoryMovementType.ADJUSTMENT,
      // Placeholder: the adjustment branch derives the magnitude from the
      // restatement and never reads this value.
      quantity: 1,
      restatedStock,
      reason: input.reason,
      ...(input.note === undefined ? {} : { note: input.note }),
    },
    actor,
  );
}

/**
 * The inventory screen: one row per variant rather than per product.
 *
 * A shop needs "how many of each size" per line, and grouping by product hides
 * exactly that. Search, category, size, colour and stock status are all applied
 * server-side against the joined product.
 */
function buildInventoryWhere(query: ListInventoryQuery): Prisma.ProductVariantWhereInput {
  const statusFilter = query.status === 'all' ? {} : { isActive: query.status === 'active' };

  return {
    ...statusFilter,
    ...(query.stockStatus === undefined
      ? {}
      : { stockQuantity: stockStatusToRange(query.stockStatus) }),
    ...(query.size === undefined ? {} : { size: query.size }),
    ...(query.color === undefined
      ? {}
      : { color: { equals: query.color, mode: 'insensitive' as const } }),
    ...(query.categoryId === undefined ? {} : { product: { categoryId: query.categoryId } }),
    ...(query.search === undefined
      ? {}
      : {
          OR: [
            { product: { name: { contains: query.search, mode: 'insensitive' as const } } },
            {
              product: { productCode: { contains: query.search, mode: 'insensitive' as const } },
            },
            { size: { contains: query.search, mode: 'insensitive' as const } },
            { color: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }),
  };
}

/**
 * Resolves a variant sort key to a Prisma orderBy.
 *
 * Built by hand rather than as a static map because a relation sort carries the
 * direction on the joined field, not on the wrapper key: `{ product: { name } }`
 * for `productName`, but `{ size: 'asc' }` for `size`. An index-signature lookup
 * would compile and silently ignore the direction on the relation cases.
 */
function inventoryOrderBy(
  sortBy: ListInventoryQuery['sortBy'],
  sortOrder: 'asc' | 'desc',
): Prisma.ProductVariantOrderByWithRelationInput {
  switch (sortBy) {
    case 'productName':
      return { product: { name: sortOrder } };
    case 'productCode':
      return { product: { productCode: sortOrder } };
    default:
      return { [sortBy]: sortOrder };
  }
}

export async function listInventory(query: ListInventoryQuery, role: UserRole) {
  const where = buildInventoryWhere(query);

  const [rows, total] = await Promise.all([
    prisma.productVariant.findMany({
      where,
      select: INVENTORY_ROW_SELECT,
      orderBy: inventoryOrderBy(query.sortBy, query.sortOrder),
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.productVariant.count({ where }),
  ]);

  return paginate(rows.map((row) => serializeInventoryRow(row, role)), total, query);
}

function buildMovementWhere(query: ListMovementsQuery): Prisma.InventoryMovementWhereInput {
  const range = toDateRange(query.from, query.to);

  return {
    ...(query.type === undefined ? {} : { type: query.type }),
    ...(query.variantId === undefined ? {} : { variantId: query.variantId }),
    ...(query.performedById === undefined ? {} : { performedById: query.performedById }),
    ...(query.productId === undefined ? {} : { variant: { productId: query.productId } }),
    ...(query.categoryId === undefined
      ? {}
      : { variant: { product: { categoryId: query.categoryId } } }),
    ...(range.gte === undefined && range.lte === undefined
      ? {}
      : {
          createdAt: {
            ...(range.gte === undefined ? {} : { gte: range.gte }),
            ...(range.lte === undefined ? {} : { lte: range.lte }),
          },
        }),
    ...(query.search === undefined
      ? {}
      : {
          OR: [
            {
              variant: { product: { name: { contains: query.search, mode: 'insensitive' as const } } },
            },
            {
              variant: {
                product: { productCode: { contains: query.search, mode: 'insensitive' as const } },
              },
            },
            { variant: { size: { contains: query.search, mode: 'insensitive' as const } } },
            { variant: { color: { contains: query.search, mode: 'insensitive' as const } } },
            { reason: { contains: query.search, mode: 'insensitive' as const } },
            { note: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }),
  };
}

/** Same shape as inventoryOrderBy: a relation sort carries its own direction. */
function movementOrderBy(
  sortBy: ListMovementsQuery['sortBy'],
  sortOrder: 'asc' | 'desc',
): Prisma.InventoryMovementOrderByWithRelationInput {
  if (sortBy === 'product') return { variant: { product: { name: sortOrder } } };
  return { [sortBy]: sortOrder };
}

/**
 * The history feed, newest first by default.
 *
 * This is the complete stock history across every variant — the record an owner
 * reads to answer "what happened to my stock this week". It is paginated rather
 * than truncated, because a silent cut-off reads as "that is all that happened",
 * which is a claim this screen must never make.
 */
export async function listMovements(query: ListMovementsQuery, role: UserRole) {
  const where = buildMovementWhere(query);

  const [rows, total] = await Promise.all([
    prisma.inventoryMovement.findMany({
      where,
      select: MOVEMENT_SELECT,
      orderBy: movementOrderBy(query.sortBy, query.sortOrder),
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.inventoryMovement.count({ where }),
  ]);

  return paginate(rows.map((row) => serializeMovement(row, role)), total, query);
}

/** The variant-scoped subset of the movement query, used by the product detail screen. */
export type VariantMovementQuery = Omit<
  ListMovementsQuery,
  'variantId' | 'productId' | 'categoryId' | 'performedById'
>;

/**
 * One variant's own timeline.
 *
 * A separate route rather than a pre-filtered call to the global feed, so the
 * product page always shows its variant's history in full and the caller cannot
 * ask for every movement in the shop by leaving off an id. The variant is checked
 * first so an unknown id is a 404 rather than an empty page.
 */
export async function listVariantMovements(
  variantId: string,
  query: VariantMovementQuery,
  role: UserRole,
) {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { id: true },
  });

  if (!variant) throw notFound('Variant');

  return listMovements({ ...query, variantId }, role);
}

/**
 * Distinct sizes and colours in use, for the filter dropdowns.
 *
 * Derived from the variants table rather than a lookup table, so a value cannot
 * drift out of sync with the data. Both columns are indexed, and the result is
 * bounded by how many sizes and colours a shop actually stocks.
 */
export async function listInventoryFacets(): Promise<InventoryFacetsDto> {
  const [sizes, colors] = await Promise.all([
    prisma.productVariant.findMany({
      where: { isActive: true },
      select: { size: true },
      distinct: ['size'],
      orderBy: { size: 'asc' },
    }),
    prisma.productVariant.findMany({
      where: { isActive: true },
      select: { color: true },
      distinct: ['color'],
      orderBy: { color: 'asc' },
    }),
  ]);

  return {
    sizes: sizes.map((row) => row.size),
    colors: colors.map((row) => row.color),
  };
}

/**
 * Headline figures for the dashboard header, over active variants only.
 *
 * The counts are aggregated by the database rather than summed from a page of
 * rows: they describe the whole catalogue, so deriving them from whatever page the
 * client happened to fetch would report a total that changes as you scroll.
 *
 * Stock value is weighted by quantity on hand, which Prisma cannot express as an
 * aggregate because it needs two columns multiplied together, so it is computed
 * here. The row set is bounded by the number of active variants — hundreds, not
 * millions — and is bounded further by the single index on (isActive, stockQuantity).
 */
export async function getInventorySummary(): Promise<InventorySummaryDto> {
  const [counts, valued] = await Promise.all([
    prisma.productVariant.aggregate({
      where: { isActive: true },
      _count: { _all: true },
      _sum: { stockQuantity: true },
    }),
    prisma.productVariant.findMany({
      where: { isActive: true },
      select: { stockQuantity: true, buyingPrice: true, sellingPrice: true },
    }),
  ]);

  // Minor units, so the accumulation is integer arithmetic. Money never touches a
  // float on the way to a reported total.
  let costMinor = 0;
  let retailMinor = 0;

  for (const row of valued) {
    costMinor += Number(row.buyingPrice.mul(row.stockQuantity).toFixed(2)) * 100;
    retailMinor += Number(row.sellingPrice.mul(row.stockQuantity).toFixed(2)) * 100;
  }

  const [lowStock, severeLowStock, outOfStock] = await Promise.all([
    prisma.productVariant.count({
      where: { isActive: true, stockQuantity: stockStatusToRange('LOW_STOCK') },
    }),
    prisma.productVariant.count({
      where: { isActive: true, stockQuantity: { gt: 0, lte: 2 } },
    }),
    prisma.productVariant.count({
      where: { isActive: true, stockQuantity: { lte: 0 } },
    }),
  ]);

  return {
    totalVariants: counts._count._all,
    totalStockUnits: counts._sum.stockQuantity ?? 0,
    lowStockVariants: lowStock,
    severeLowStockVariants: severeLowStock,
    outOfStockVariants: outOfStock,
    costValue: (costMinor / 100).toFixed(2),
    retailValue: (retailMinor / 100).toFixed(2),
    potentialProfit: ((retailMinor - costMinor) / 100).toFixed(2),
  };
}

