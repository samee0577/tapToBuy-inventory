import {
  ApiErrorCode,
  InventoryMovementType,
  type CreateProductInput,
  type ListProductsQuery,
  type Paginated,
  type UpdateProductInput,
  type UserRole,
  stockStatusToRange,
} from '@inventory/shared';

import { conflict, notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma, toDecimal } from '../../lib/prisma.js';
import { isNotFoundError, isUniqueViolationOn } from '../../lib/prisma-errors.js';
import { applyStockChange } from '../../lib/stock-change.js';
import {
  PRODUCT_LIST_SELECT,
  serializeProduct,
  type SerializedProduct,
} from '../../serializers/product.js';
import { assertCategoryIsUsable } from '../categories/category.service.js';

/**
 * Builds the Prisma `where` for the product list.
 *
 * Search spans the product's own fields, its category name, and its variants'
 * size and colour — so typing "black" or "XL" finds the product without the user
 * having to open a filter (§20). Every clause is server-side; the browser never
 * receives the full catalogue to filter locally.
 */
function buildWhere(query: ListProductsQuery) {
  const statusFilter = query.status === 'all' ? {} : { isActive: query.status === 'active' };

  // Stock status is derived rather than stored, so it is restated as the numeric
  // range that produces it.
  const variantFilters = {
    ...(query.size === undefined ? {} : { size: query.size }),
    ...(query.color === undefined
      ? {}
      : { color: { equals: query.color, mode: 'insensitive' as const } }),
    ...(query.stockStatus === undefined ? {} : { stockQuantity: stockStatusToRange(query.stockStatus) }),
  };

  const hasVariantFilter = Object.keys(variantFilters).length > 0;

  return {
    ...statusFilter,
    ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
    ...(hasVariantFilter
      ? {
          variants: {
            some: {
              ...(query.status === 'all' ? {} : { isActive: true }),
              ...variantFilters,
            },
          },
        }
      : {}),
    ...(query.search === undefined
      ? {}
      : {
          AND: [
            {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' as const } },
                { productCode: { contains: query.search, mode: 'insensitive' as const } },
                { description: { contains: query.search, mode: 'insensitive' as const } },
                { category: { name: { contains: query.search, mode: 'insensitive' as const } } },
                { variants: { some: { size: { contains: query.search, mode: 'insensitive' as const } } } },
                {
                  variants: {
                    some: { color: { contains: query.search, mode: 'insensitive' as const } },
                  },
                },
              ],
            },
          ],
        }),
  };
}

export async function listProducts(
  query: ListProductsQuery,
  role: UserRole,
): Promise<Paginated<SerializedProduct>> {
  const where = buildWhere(query);

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      select: PRODUCT_LIST_SELECT,
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.product.count({ where }),
  ]);

  return {
    items: products.map((product) => serializeProduct(product, role)),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export async function getProduct(
  productId: string,
  role: UserRole,
): Promise<SerializedProduct> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: PRODUCT_LIST_SELECT,
  });

  if (!product) throw notFound('Product');

  return serializeProduct(product, role, { includeCreatedBy: true });
}

/**
 * Creates a product together with its variants, opening stock movements and
 * starting price history — all in one transaction.
 *
 * The variant rows are inserted at zero stock and opening stock is applied
 * through `applyStockChange`, exactly as a later STOCK_IN would be. Setting
 * `stockQuantity` directly here would create a second, divergent path for
 * changing stock and is precisely the inconsistency the inventory ledger exists
 * to prevent.
 */
export async function createProduct(
  input: CreateProductInput,
  actorId: string,
  role: UserRole,
): Promise<SerializedProduct> {
  await assertCategoryIsUsable(input.categoryId);

  // Duplicate size/colour inside a single request is caught here rather than by
  // the database, so the user gets a message naming the offending combination
  // instead of a raw unique-violation.
  assertVariantsAreDistinct(input.variants);

  const productId = await prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        name: input.name,
        productCode: input.productCode,
        categoryId: input.categoryId,
        description: input.description ?? null,
        imageKey: input.imageKey ?? null,
        imageUrl: input.imageUrl ?? null,
        isActive: input.isActive,
        createdById: actorId,
      },
      select: { id: true },
    });

    for (const variant of input.variants) {
      const created = await tx.productVariant.create({
        data: {
          productId: product.id,
          size: variant.size,
          color: variant.color,
          buyingPrice: toDecimal(variant.buyingPrice),
          sellingPrice: toDecimal(variant.sellingPrice),
          // Always zero. Opening stock arrives via the movement below.
          stockQuantity: 0,
        },
        select: { id: true },
      });

      // The starting price is recorded so the timeline reads "created at X" and
      // then every subsequent change, rather than starting from a blank slate.
      await tx.priceHistory.create({
        data: {
          variantId: created.id,
          oldBuyingPrice: null,
          newBuyingPrice: toDecimal(variant.buyingPrice),
          oldSellingPrice: null,
          newSellingPrice: toDecimal(variant.sellingPrice),
          changedById: actorId,
        },
      });

      if (variant.initialStock > 0) {
        await applyStockChange(tx, {
          variantId: created.id,
          type: InventoryMovementType.STOCK_IN,
          quantity: variant.initialStock,
          actorId,
          reason: 'Opening stock',
        });
      }
    }

    return product.id;
  }).catch((error: unknown) => {
    if (isUniqueViolationOn(error, ['productCode'])) {
      throw conflict(
        ApiErrorCode.DUPLICATE_PRODUCT_CODE,
        `Product code ${input.productCode} is already in use.`,
      );
    }
    if (isUniqueViolationOn(error, ['productId', 'size', 'color'])) {
      throw conflict(
        ApiErrorCode.DUPLICATE_VARIANT,
        'Two variants share the same size and colour.',
      );
    }
    throw error;
  });

  logger.info({ actorId, role, productId }, 'product created');

  return getProduct(productId, role);
}

function assertVariantsAreDistinct(
  variants: ReadonlyArray<{ size: string; color: string }>,
): void {
  const seen = new Set<string>();

  for (const variant of variants) {
    const key = `${variant.size.toUpperCase()}::${variant.color.toLowerCase()}`;
    if (seen.has(key)) {
      throw conflict(
        ApiErrorCode.DUPLICATE_VARIANT,
        `Size ${variant.size} in ${variant.color} is listed more than once.`,
      );
    }
    seen.add(key);
  }
}

export async function updateProduct(
  productId: string,
  input: UpdateProductInput,
  actorId: string,
  role: UserRole,
): Promise<SerializedProduct> {
  const previous = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, imageKey: true },
  });

  if (!previous) throw notFound('Product');

  if (input.categoryId !== undefined) {
    await assertCategoryIsUsable(input.categoryId);
  }

  try {
    await prisma.product.update({
      where: { id: productId },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.productCode === undefined ? {} : { productCode: input.productCode }),
        ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
        ...('description' in input ? { description: input.description ?? null } : {}),
        ...('imageKey' in input ? { imageKey: input.imageKey ?? null } : {}),
        ...('imageUrl' in input ? { imageUrl: input.imageUrl ?? null } : {}),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      },
    });
  } catch (error) {
    if (isNotFoundError(error)) throw notFound('Product');
    if (isUniqueViolationOn(error, ['productCode'])) {
      throw conflict(
        ApiErrorCode.DUPLICATE_PRODUCT_CODE,
        `Product code ${input.productCode} is already in use.`,
      );
    }
    throw error;
  }

  logger.info(
    {
      actorId,
      productId,
      imageReplaced: input.imageKey !== undefined && input.imageKey !== previous.imageKey,
      isActive: input.isActive,
    },
    'product updated',
  );

  return getProduct(productId, role);
}