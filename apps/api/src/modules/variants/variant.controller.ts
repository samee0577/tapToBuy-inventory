import type { Request, Response } from 'express';

import {
  createVariantSchema,
  updateVariantSchema,
} from '@inventory/shared';

import { asyncHandler } from '../../lib/asyncHandler.js';
import { sendData } from '../../lib/http.js';
import { authUser } from '../../middleware/auth.js';
import * as variantService from './variant.service.js';

export const addToProduct = asyncHandler(async (req: Request, res: Response) => {
  const actor = authUser(req);
  const productId = req.params.id ?? '';
  const input = createVariantSchema.parse(req.body);

  sendData(res, await variantService.createVariant(productId, input, actor.id, actor.role), 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const actor = authUser(req);
  const variantId = req.params.id ?? '';
  const input = updateVariantSchema.parse(req.body);

  sendData(res, await variantService.updateVariant(variantId, input, actor.id, actor.role));
});

export const priceHistory = asyncHandler(async (req: Request, res: Response) => {
  const productId = req.params.id ?? '';
  const variantId = req.params.variantId ?? '';

  sendData(res, await variantService.getPriceHistory(productId, variantId));
});