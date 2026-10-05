import {
  ApiErrorCode,
  type CategoryDto,
  type CreateCategoryInput,
  type ListCategoriesQuery,
  type UpdateCategoryInput,
} from '@inventory/shared';

import { AppError, conflict, notFound } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { isNotFoundError, isUniqueViolationOn } from '../../lib/prisma-errors.js';
import { logger } from '../../lib/logger.js';
import { CATEGORY_SELECT, serializeCategory, type CategoryRow } from '../../serializers/category.js';

export async function listCategories(query: ListCategoriesQuery): Promise<{
  items: CategoryDto[];
  total: number;
}> {
  const where = {
    ...(query.status === 'all' ? {} : { isActive: query.status === 'active' }),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' as const } },
            { description: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [categories, total] = await Promise.all([
    prisma.category.findMany({
      where,
      select: CATEGORY_SELECT,
      orderBy: { name: 'asc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.category.count({ where }),
  ]);

  return { items: categories.map(serializeCategory), total };
}

/**
 * Active categories only, for the product form and the filter drawer. Small
 * payload and no pagination: a shop has tens of categories, not thousands, and
 * the filter drawer must not need a second request to populate.
 */
export async function listCategoryOptions(): Promise<Array<{ id: string; name: string }>> {
  return prisma.category.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}

export async function createCategory(input: CreateCategoryInput): Promise<CategoryDto> {
  try {
    const category = await prisma.category.create({
      data: { name: input.name, description: input.description ?? null },
      select: CATEGORY_SELECT,
    });

    logger.info({ categoryId: category.id }, 'category created');
    return serializeCategory(category);
  } catch (error) {
    if (isUniqueViolationOn(error, ['name'])) {
      throw conflict(ApiErrorCode.DUPLICATE_CATEGORY, 'A category with that name already exists.');
    }
    throw error;
  }
}

export async function updateCategory(
  categoryId: string,
  input: UpdateCategoryInput,
): Promise<CategoryDto> {
  try {
    const category = await prisma.category.update({
      where: { id: categoryId },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...('description' in input ? { description: input.description ?? null } : {}),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      },
      select: CATEGORY_SELECT,
    });

    logger.info({ categoryId, isActive: category.isActive }, 'category updated');
    return serializeCategory(category);
  } catch (error) {
    if (isNotFoundError(error)) throw notFound('Category');
    if (isUniqueViolationOn(error, ['name'])) {
      throw conflict(ApiErrorCode.DUPLICATE_CATEGORY, 'A category with that name already exists.');
    }
    throw error;
  }
}

export async function assertCategoryIsUsable(categoryId: string): Promise<void> {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { id: true, isActive: true },
  });

  if (!category) {
    throw notFound('Category');
  }

  if (!category.isActive) {
    throw new AppError(
      ApiErrorCode.VALIDATION_ERROR,
      'That category is deactivated. Reactivate it before using it.',
      400,
    );
  }
}

export type { CategoryRow };