import type { Request, Response } from 'express';

import {
  createUserSchema,
  listUsersQuerySchema,
  paginate,
  updateUserSchema,
} from '@inventory/shared';

import { asyncHandler } from '../../lib/asyncHandler.js';
import { notFound } from '../../lib/errors.js';
import { sendData } from '../../lib/http.js';
import { isNotFoundError } from '../../lib/prisma-errors.js';
import { authUser } from '../../middleware/auth.js';
import * as userService from './user.service.js';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = listUsersQuerySchema.parse(req.query);
  const { items, total } = await userService.listUsers(query);

  sendData(res, paginate(items, total, query));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const actor = authUser(req);
  const input = createUserSchema.parse(req.body);
  const user = await userService.createUser(input, actor.id);

  sendData(res, user, 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const actor = authUser(req);
  const targetUserId = req.params.id ?? '';
  const input = updateUserSchema.parse(req.body);

  try {
    const user = await userService.updateUser(targetUserId, input, actor.id);
    sendData(res, user);
  } catch (error) {
    if (isNotFoundError(error)) throw notFound('User');
    throw error;
  }
});
