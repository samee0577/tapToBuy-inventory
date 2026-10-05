import { Router } from 'express';

import { requireAuth } from '../../middleware/auth.js';
import * as controller from './dashboard.controller.js';

export const dashboardRouter: Router = Router();

/**
 * The dashboard is readable by both roles. What each one sees is decided by the
 * serialiser in the service, not by separate routes: Staff get counts, activity and
 * low-stock lines, and the financial keys are absent from their payload entirely.
 */
dashboardRouter.use(requireAuth);

dashboardRouter.get('/', controller.summary);