import type { CategoryDto } from '@inventory/shared';
import type { Prisma } from '@prisma/client';

/**
 * `productCount` is a count of products in the category, active or not. Shown so
 * a category can be judged before it is deactivated — a category with fifty
 * products under it is a decision, not a typo.
 */
export const CATEGORY_SELECT = {
  id: true,
  name: true,
  description: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { products: true } },
} as const;

export type CategoryRow = Prisma.CategoryGetPayload<{ select: typeof CATEGORY_SELECT }>;

export function serializeCategory(category: CategoryRow): CategoryDto {
  return {
    id: category.id,
    name: category.name,
    description: category.description,
    isActive: category.isActive,
    productCount: category._count.products,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  };
}

/** The minimum a filter dropdown needs; avoids shipping counts to every option. */
export interface CategoryOptionDto {
  id: string;
  name: string;
}

export function serializeCategoryOption(category: CategoryOptionDto): CategoryOptionDto {
  return { id: category.id, name: category.name };
}