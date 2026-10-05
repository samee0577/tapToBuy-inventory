import { Router } from 'express';
import { UserRole } from '@inventory/shared';

import { requireAuth, requireRole } from '../../middleware/auth.js';
import * as controller from './variant.controller.js';

export const variantRouter: Router = Router();

/**
 * requireAuth is applied per route rather than with a blanket `use()`.
 *
 * This router is mounted at /api so it can carry both /variants/:id and
 * /products/:id/variants. A path-less `use(requireAuth)` would run for every
 * request that reaches /api, including paths no route here matches, and would turn
 * a genuine 404 into a misleading 401.
 */

/**
 * Adding a variant introduces a buying price, so it is Admin-only for the same
 * reason product creation is: Staff work from products that already exist.
 */
variantRouter.post(
  '/products/:id/variants',
  requireAuth,
  requireRole(UserRole.ADMIN),
  controller.addToProduct,
);

/**
 * Editing an existing variant is open to Staff, since correcting a selling price
 * or retiring a line is day-to-day work. The service refuses a buying-price
 * change from a Staff caller, because that field is never sent to them in the
 * first place.
 */
variantRouter.patch('/variants/:id', requireAuth, controller.update);

/**
 * Price history exposes buying prices, so it is Admin-only (§7, §27).
 * Mounted under the product because a variant id alone is not meaningful to a
 * caller without its product.
 */
variantRouter.get(
  '/products/:id/price-history/:variantId',
  requireAuth,
  requireRole(UserRole.ADMIN),
  controller.priceHistory,
);

// No DELETE. A variant with history cannot be deleted (the database refuses, and
// the trigger says so); deactivate it instead.