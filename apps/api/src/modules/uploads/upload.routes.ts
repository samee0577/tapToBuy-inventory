import { Router } from 'express';

import { requireAuth } from '../../middleware/auth.js';
import * as controller from './upload.controller.js';

export const uploadRouter: Router = Router();

// Both Admin and Staff can add a product photo (§7).
uploadRouter.use(requireAuth);

uploadRouter.post('/presign', controller.presign);
uploadRouter.post('/complete', controller.complete);

// Deliberately no DELETE route. destroyAsset() is reachable only from the
// product service, so replacing a photo is not something a client can point at
// an arbitrary asset in the Cloudinary account.
