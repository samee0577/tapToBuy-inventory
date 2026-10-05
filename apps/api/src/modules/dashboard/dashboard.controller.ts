import type { Request, Response } from 'express';

import { dashboardRangeSchema } from '@inventory/shared';

import { asyncHandler } from '../../lib/asyncHandler.js';
import { sendData } from '../../lib/http.js';
import { authUser } from '../../middleware/auth.js';
import * as dashboardService from './dashboard.service.js';

export const summary = asyncHandler(async (req: Request, res: Response) => {
  const actor = authUser(req);
  // Defaults to 30d, so the first load needs no range and the dashboard opens on a
  // useful window rather than a day that may look empty.
  const range = dashboardRangeSchema.parse(req.query.range ?? '30d');

  sendData(res, await dashboardService.getDashboard(range, actor.role));
});