import { Router } from 'express';

import { UserRole } from '@inventory/shared';

import { requireAuth, requireRole } from '../../middleware/auth.js';
import { authRateLimiter } from '../../middleware/rateLimit.js';
import * as controller from './user.controller.js';

export const userRouter: Router = Router();

/**
 * Every route in this module is administrator-only (§7, §28). The guard is on
 * the router rather than repeated per route so a new endpoint cannot be added
 * without inheriting the restriction.
 */
userRouter.use(requireAuth, requireRole(UserRole.ADMIN));

userRouter.get('/', controller.list);
userRouter.post('/', authRateLimiter, controller.create);
userRouter.patch('/:id', controller.update);
userRouter.post('/:id/reset-password', authRateLimiter, controller.resetPassword);

// Deliberately no DELETE. Users are deactivated, never deleted: an inventory
// movement references the user who performed it and those rows are append-only,
// so removing the user would either orphan history or destroy the audit trail.
// DELETE /api/users/:id therefore falls through to the 404 handler.
