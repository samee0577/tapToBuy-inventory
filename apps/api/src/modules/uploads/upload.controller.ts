import type { Request, Response } from 'express';

import { completeUploadSchema, presignUploadSchema } from '@inventory/shared';

import { asyncHandler } from '../../lib/asyncHandler.js';
import { sendData } from '../../lib/http.js';
import { authUser } from '../../middleware/auth.js';
import * as uploadService from './upload.service.js';

export const presign = asyncHandler(async (req: Request, res: Response) => {
  const actor = authUser(req);
  const input = presignUploadSchema.parse(req.body);
  const ticket = await uploadService.presignUpload(input, actor.id);

  sendData(res, ticket);
});

export const complete = asyncHandler(async (req: Request, res: Response) => {
  const actor = authUser(req);
  const input = completeUploadSchema.parse(req.body);
  const verified = await uploadService.completeUpload(input.publicId, input.uploadToken, actor.id);

  sendData(res, verified);
});
