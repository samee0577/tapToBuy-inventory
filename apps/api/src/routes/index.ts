import { Router } from 'express';

import { authRouter } from '../modules/auth/auth.routes.js';
import { healthRouter } from '../modules/health/health.routes.js';
import { uploadRouter } from '../modules/uploads/upload.routes.js';
import { userRouter } from '../modules/users/user.routes.js';

export const apiRouter: Router = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/uploads', uploadRouter);
