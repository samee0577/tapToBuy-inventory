import { Router } from 'express';

import { authRateLimiter, authReadRateLimiter } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/auth.js';
import * as controller from './auth.controller.js';

export const authRouter: Router = Router();

authRouter.post('/login', authRateLimiter, controller.login);
authRouter.post('/register', authRateLimiter, controller.register);
authRouter.post('/logout', authReadRateLimiter, controller.logout);
authRouter.get('/me', authReadRateLimiter, requireAuth, controller.me);
authRouter.post('/change-password', authRateLimiter, requireAuth, controller.changePassword);

// Redirect-based flows. These are entry points, not authenticated APIs, so they
// sit outside requireAuth; the signed state cookie is what protects them.
authRouter.get('/google', controller.startGoogleSignIn);
authRouter.get('/google/callback', controller.handleGoogleCallback);
