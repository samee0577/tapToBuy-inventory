import { z } from 'zod';

import { StockStatus } from '../constants/stock.js';
import { paginationSchema, searchTermSchema, uuidSchema } from './common.js';
import { createVariantSchema, sizeSchema, colorSchema } from './variant.js';

export const productNameSchema = z
  .string()
  .trim()
  .min(2, 'Product name must be at least 2 characters')
  .max(120, 'Product name must be at most 120 characters');

/**
 * Uppercased on write so uniqueness can be enforced by a plain unique index.
 * Prisma cannot express a case-insensitive expression index declaratively, and a
 * hand-written raw index is not worth the drift risk (§ C8).
 */
export const productCodeSchema = z
  .string()
  .trim()
  .min(2, 'Product code must be at least 2 characters')
  .max(40, 'Product code must be at most 40 characters')
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._\-/ ]*$/,
    'Product code may only contain letters, numbers, spaces and . - _ /',
  )
  .transform((value) => value.toUpperCase());

/**
 * Matches a Cloudinary public_id in the shape this application mints:
 * `<folder>/<uuid>`. The UUID is what makes the identifier unguessable, so a
 * client cannot name an asset it was not granted.
 *
 * Validating this on write is what stops a caller attaching an arbitrary
 * Cloudinary public_id to a product.
 */
export const IMAGE_PUBLIC_ID_PATTERN = /^products\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const imagePublicIdSchema = z
  .string()
  .regex(IMAGE_PUBLIC_ID_PATTERN, 'Invalid image reference');

export const productImageSchema = z.object({
  imageKey: imagePublicIdSchema,
  imageUrl: z.string().url('Invalid image URL'),
});

export type ProductImageInput = z.infer<typeof productImageSchema>;

export const createProductSchema = z.object({
  name: productNameSchema,
  productCode: productCodeSchema,
  categoryId: uuidSchema,
  description: z.string().trim().max(500).optional(),
  imageKey: productImageSchema.shape.imageKey.optional(),
  imageUrl: productImageSchema.shape.imageUrl.optional(),
  isActive: z.boolean().default(true),
  variants: z
    .array(createVariantSchema)
    .min(1, 'Add at least one variant')
    .max(60, 'A product cannot have more than 60 variants'),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z
  .object({
    name: productNameSchema.optional(),
    productCode: productCodeSchema.optional(),
    categoryId: uuidSchema.optional(),
    description: z.string().trim().max(500).nullable().optional(),
    imageKey: productImageSchema.shape.imageKey.nullable().optional(),
    imageUrl: productImageSchema.shape.imageUrl.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

export type UpdateProductInput = z.infer<typeof updateProductSchema>;

/**
 * The product list renders grouped variant cards (§19), so it can only sort by
 * columns that live on Product itself. Sorting by stock quantity or price is a
 * variant-level concern and lives on GET /api/inventory (§21, § C-note).
 */
export const productSortSchema = z.enum(['name', 'productCode', 'createdAt', 'updatedAt']);

export const sortOrderSchema = z.enum(['asc', 'desc']).default('asc');

export const listProductsQuerySchema = paginationSchema.extend({
  search: searchTermSchema,
  categoryId: uuidSchema.optional(),
  size: sizeSchema.optional(),
  color: colorSchema.optional(),
  status: z.enum(['all', 'active', 'inactive']).default('active'),
  stockStatus: z.nativeEnum(StockStatus).optional(),
  sortBy: productSortSchema.default('updatedAt'),
  sortOrder: sortOrderSchema.default('desc'),
});

export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

export const stockStatusSchema = z.nativeEnum(StockStatus);
