import { Router } from 'express';

import { requireAuth } from '../../middleware/auth.js';
import * as controller from './category.controller.js';

export const categoryRouter: Router = Router();

// Categories are manageable by both Admin and Staff (§9): the taxonomy is cheap
// to maintain and does not carry financial data.
categoryRouter.use(requireAuth);

categoryRouter.get('/', controller.list);
categoryRouter.get('/options', controller.options);
categoryRouter.post('/', controller.create);
categoryRouter.patch('/:id', controller.update);

// No DELETE. A category holding products cannot be removed without orphaning
// them, and the FK is RESTRICT so the database would refuse anyway. Set
// isActive: false instead.