import { Router } from 'express';
import { UserRole } from '@inventory/shared';

import { requireAuth, requireRole } from '../../middleware/auth.js';
import { authRateLimiter } from '../../middleware/rateLimit.js';
import * as controller from './product.controller.js';

export const productRouter: Router = Router();

productRouter.use(requireAuth);

/**
 * Staff browse and correct existing products, but creating one is an Admin action.
 * A product is an inventory-bearing financial record — it introduces buying
 * prices — so it is created by whoever owns pricing, and Staff work from what
 * already exists.
 */
productRouter.post('/', requireRole(UserRole.ADMIN), authRateLimiter, controller.create);

productRouter.get('/', controller.list);
productRouter.get('/:id', controller.detail);
productRouter.patch('/:id', controller.update);

// No DELETE (§46 invariant 13). Deactivate with { "isActive": false }; the product
// stops appearing in lists but its variants, stock and history stay intact.