import type { Request, Response } from 'express';

import {
  adjustmentSchema,
  listInventoryQuerySchema,
  listMovementsQuerySchema,
  returnSchema,
  saleSchema,
  stockInSchema,
} from '@inventory/shared';

import { asyncHandler } from '../../lib/asyncHandler.js';
import { sendData } from '../../lib/http.js';
import { authUser } from '../../middleware/auth.js';
import * as inventoryService from './inventory.service.js';

/** The authenticated actor, as the inventory engine records it on every movement. */
function actor(req: Request) {
  const user = authUser(req);
  return { id: user.id, name: user.name, role: user.role };
}

export const stockIn = asyncHandler(async (req: Request, res: Response) => {
  const input = stockInSchema.parse(req.body);

  sendData(
    res,
    await inventoryService.recordStockIn(req.params.variantId ?? '', input, actor(req)),
    201,
  );
});

export const sale = asyncHandler(async (req: Request, res: Response) => {
  const input = saleSchema.parse(req.body);

  sendData(
    res,
    await inventoryService.recordSale(req.params.variantId ?? '', input, actor(req)),
    201,
  );
});

export const returnStock = asyncHandler(async (req: Request, res: Response) => {
  const input = returnSchema.parse(req.body);

  sendData(
    res,
    await inventoryService.recordReturn(req.params.variantId ?? '', input, actor(req)),
    201,
  );
});

export const adjustment = asyncHandler(async (req: Request, res: Response) => {
  const input = adjustmentSchema.parse(req.body);

  sendData(
    res,
    await inventoryService.recordAdjustment(req.params.variantId ?? '', input, actor(req)),
    201,
  );
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const user = authUser(req);
  const query = listInventoryQuerySchema.parse(req.query);

  sendData(res, await inventoryService.listInventory(query, user.role));
});

export const facets = asyncHandler(async (_req: Request, res: Response) => {
  sendData(res, await inventoryService.listInventoryFacets());
});

export const history = asyncHandler(async (req: Request, res: Response) => {
  const user = authUser(req);
  const query = listMovementsQuerySchema.parse(req.query);

  sendData(res, await inventoryService.listMovements(query, user.role));
});

export const variantHistory = asyncHandler(async (req: Request, res: Response) => {
  const user = authUser(req);
  const parsed = listMovementsQuerySchema.parse(req.query);

  // The variant comes from the path, so the scope filters are dropped rather than
  // honoured: a caller cannot widen this into a shop-wide history dump by putting
  // the wrong id in the query string.
  const { variantId, productId, categoryId, performedById, ...query } = parsed;
  void variantId;
  void productId;
  void categoryId;
  void performedById;

  sendData(
    res,
    await inventoryService.listVariantMovements(req.params.variantId ?? '', query, user.role),
  );
});

export const summary = asyncHandler(async (_req: Request, res: Response) => {
  sendData(res, await inventoryService.getInventorySummary());
});