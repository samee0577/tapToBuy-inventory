import { z } from 'zod';

import { paginationSchema, searchTermSchema } from './common.js';

export const categoryNameSchema = z
  .string()
  .trim()
  .min(2, 'Category name must be at least 2 characters')
  .max(60, 'Category name must be at most 60 characters');

export const categoryDescriptionSchema = z
  .string()
  .trim()
  .max(280, 'Description must be at most 280 characters')
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

export const createCategorySchema = z.object({
  name: categoryNameSchema,
  description: categoryDescriptionSchema,
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z
  .object({
    name: categoryNameSchema.optional(),
    description: categoryDescriptionSchema,
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export const listCategoriesQuerySchema = paginationSchema.extend({
  search: searchTermSchema,
  status: z.enum(['all', 'active', 'inactive']).default('active'),
});

export type ListCategoriesQuery = z.infer<typeof listCategoriesQuerySchema>;
