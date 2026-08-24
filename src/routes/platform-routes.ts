import { Router } from 'express';

import {
  list as listExtensionsHandler,
  patchStatus as patchExtensionStatus,
  read as readExtension,
  register as registerExtensionHandler
} from '../controllers/extension-controller';
import {
  capabilities,
  listChecks,
  metrics,
  promote,
  referenceSuite,
  rollback,
  runCheck,
  setRollout,
  viewerIntegrations
} from '../controllers/platform-controller';
import { requireAuth, requirePlatformAdmin } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import { extensionParams } from '../validators/request-schemas';

export const extensionRouter = Router();

extensionRouter.use(requireAuth);
// The catalog is readable by any creator: it is what the editor offers.
extensionRouter.get('/', asyncHandler(listExtensionsHandler));
extensionRouter.get(
  '/:extensionId/:version',
  validate('params', extensionParams),
  asyncHandler(readExtension)
);
// Registering and enabling code the player will load is an operator action.
extensionRouter.post('/', requirePlatformAdmin, asyncHandler(registerExtensionHandler));
extensionRouter.patch(
  '/:extensionId/:version/status',
  validate('params', extensionParams),
  requirePlatformAdmin,
  asyncHandler(patchExtensionStatus)
);

export const platformRouter = Router();

platformRouter.use(requireAuth);
platformRouter.get('/capabilities', asyncHandler(capabilities));
platformRouter.get('/viewer-integrations', asyncHandler(viewerIntegrations));
platformRouter.get('/reference-suite', asyncHandler(referenceSuite));
platformRouter.get('/viewer-integrations/checks', requirePlatformAdmin, asyncHandler(listChecks));
platformRouter.post('/viewer-integrations/checks', requirePlatformAdmin, asyncHandler(runCheck));
platformRouter.put('/viewer-integrations/rollout', requirePlatformAdmin, asyncHandler(setRollout));
platformRouter.post('/viewer-integrations/promote', requirePlatformAdmin, asyncHandler(promote));
platformRouter.post('/viewer-integrations/rollback', requirePlatformAdmin, asyncHandler(rollback));
platformRouter.get('/metrics', requirePlatformAdmin, asyncHandler(metrics));
