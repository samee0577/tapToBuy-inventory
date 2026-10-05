import type { Request, Response } from 'express';

import {
  createProductSchema,
  listProductsQuerySchema,
  updateProductSchema,
} from '@inventory/shared';

import { asyncHandler } from '../../lib/asyncHandler.js';
import { sendData } from '../../lib/http.js';
import { authUser } from '../../middleware/auth.js';
import * as productService from './product.service.js';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const actor = authUser(req);
  const query = listProductsQuerySchema.parse(req.query);

  sendData(res, await productService.listProducts(query, actor.role));
});

export const detail = asyncHandler(async (req: Request, res: Response) => {
  const actor = authUser(req);
  const productId = req.params.id ?? '';

  sendData(res, await productService.getProduct(productId, actor.role));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const actor = authUser(req);
  const input = createProductSchema.parse(req.body);
  const product = await productService.createProduct(input, actor.id, actor.role);

  sendData(res, product, 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const actor = authUser(req);
  const productId = req.params.id ?? '';
  const input = updateProductSchema.parse(req.body);

  sendData(
    res,
    await productService.updateProduct(productId, input, actor.id, actor.role),
  );
});