import type { Request, Response } from 'express';

import {
  createCategorySchema,
  listCategoriesQuerySchema,
  paginate,
  updateCategorySchema,
} from '@inventory/shared';

import { asyncHandler } from '../../lib/asyncHandler.js';
import { sendData } from '../../lib/http.js';
import * as categoryService from './category.service.js';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = listCategoriesQuerySchema.parse(req.query);
  const { items, total } = await categoryService.listCategories(query);

  sendData(res, paginate(items, total, query));
});

export const options = asyncHandler(async (_req: Request, res: Response) => {
  sendData(res, await categoryService.listCategoryOptions());
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const input = createCategorySchema.parse(req.body);
  sendData(res, await categoryService.createCategory(input), 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const categoryId = req.params.id ?? '';
  const input = updateCategorySchema.parse(req.body);

  sendData(res, await categoryService.updateCategory(categoryId, input));
});