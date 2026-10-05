import { Router } from 'express';

import { authRouter } from '../modules/auth/auth.routes.js';
import { categoryRouter } from '../modules/categories/category.routes.js';
import { dashboardRouter } from '../modules/dashboard/dashboard.routes.js';
import { healthRouter } from '../modules/health/health.routes.js';
import { inventoryRouter } from '../modules/inventory/inventory.routes.js';
import { productRouter } from '../modules/products/product.routes.js';
import { uploadRouter } from '../modules/uploads/upload.routes.js';
import { userRouter } from '../modules/users/user.routes.js';
import { variantRouter } from '../modules/variants/variant.routes.js';

export const apiRouter: Router = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/categories', categoryRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/products', productRouter);
apiRouter.use('/uploads', uploadRouter);

// Mounted before the root variant router: this one declares literal /facets,
// /summary and /movements paths, and the variant router's :id parameter would
// otherwise swallow them as variant ids.
apiRouter.use('/inventory', inventoryRouter);

// Variant routes are mounted at the root so they can carry both /variants/:id and
// /products/:id/variants without duplicating the product prefix.
apiRouter.use('/', variantRouter);