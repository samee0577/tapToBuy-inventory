import { z } from 'zod';

import { paginationSchema, searchTermSchema } from './common.js';
import { nameSchema, roleSchema } from './auth.js';

export const createUserSchema = z.object({
  name: nameSchema,
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(10).max(128),
  role: roleSchema,
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    name: nameSchema.optional(),
    role: roleSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const listUsersQuerySchema = paginationSchema.extend({
  search: searchTermSchema,
  role: roleSchema.optional(),
  status: z.enum(['all', 'active', 'inactive']).default('active'),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
