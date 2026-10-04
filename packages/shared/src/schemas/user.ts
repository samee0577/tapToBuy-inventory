import { z } from 'zod';

import { paginationSchema, searchTermSchema } from './common.js';
import { emailSchema, nameSchema, roleSchema } from './auth.js';

export const createUserSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: z.string().min(10).max(128),
  role: roleSchema,
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

/**
 * Reuses the login email schema so an address set here is normalised exactly the
 * way it is on sign-in. Without that, an Admin could store "Staff@Example.com"
 * and the CHECK constraint would reject the write at the database level.
 */
export const updateUserSchema = z
  .object({
    name: nameSchema.optional(),
    email: emailSchema.optional(),
    role: roleSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/**
 * An Admin resetting someone's password does not choose the new value: the server
 * generates a strong one and returns it exactly once, so a weak or reused
 * password can never be assigned by accident.
 */
export const resetPasswordResponseSchema = z.object({
  temporaryPassword: z.string().min(1),
  mustChangePassword: z.literal(true),
});

export type ResetPasswordResponse = z.infer<typeof resetPasswordResponseSchema>;

export const listUsersQuerySchema = paginationSchema.extend({
  search: searchTermSchema,
  role: roleSchema.optional(),
  status: z.enum(['all', 'active', 'inactive']).default('active'),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
