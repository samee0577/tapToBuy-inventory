import { Router } from 'express';

import { UserRole } from '@inventory/shared';

import { requireAuth, requireRole } from '../../middleware/auth.js';
import * as controller from './inventory.controller.js';

export const inventoryRouter: Router = Router();

inventoryRouter.use(requireAuth);

/**
 * Who may record what.
 *
 * Selling and receiving stock is the counter's day-to-day work, so STAFF can do
 * both — a shop where only an administrator may ring up a sale is a shop that
 * cannot trade. That trust is deliberately limited to the two operations that are
 * backed by a customer or a supplier.
 *
 * ADJUSTMENT is Admin-only. It is the one operation with no external counterpart:
 * nothing arrives and no customer takes anything, it just rewrites the number the
 * system believes is on the shelf. Allowing any user to do that silently is how
 * stock shrinkage becomes invisible, so the write-off path stays with whoever owns
 * the numbers. Staff who find a discrepancy report it and an Admin records it.
 */

/** Receiving a delivery. Priced by the variant, so no buying price is accepted here. */
inventoryRouter.post('/variants/:variantId/stock-in', controller.stockIn);

inventoryRouter.post('/variants/:variantId/sales', controller.sale);

inventoryRouter.post('/variants/:variantId/returns', controller.returnStock);

inventoryRouter.post(
  '/variants/:variantId/adjustments',
  requireRole(UserRole.ADMIN),
  controller.adjustment,
);

/**
 * The stock screen. Open to STAFF because knowing what is on the shelf is not
 * privileged; the buying price is absent from a Staff row at the serialiser, so
 * the guard here is about the write, not this read.
 */
inventoryRouter.get('/', controller.list);

/** Distinct sizes and colours, so the filter drawer needs no second request. */
inventoryRouter.get('/facets', controller.facets);

/** Headline counts and stock value for the dashboard header. */
inventoryRouter.get('/summary', controller.summary);

/** The complete movement history across every variant. */
inventoryRouter.get('/movements', controller.history);

/** One variant's own timeline, for the product detail screen. */
inventoryRouter.get('/variants/:variantId/movements', controller.variantHistory);

// No PUT, PATCH or DELETE on a movement. The ledger is append-only: a mistake is
// corrected by recording a RETURN or an ADJUSTMENT, never by editing history.