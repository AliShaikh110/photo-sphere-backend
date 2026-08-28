import { Router } from 'express';

import {
  create,
  instantiate,
  list,
  patchStatus,
  read
} from '../controllers/template-controller';
import { requireAuth } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import { templateParams } from '../validators/request-schemas';

export const templateRouter = Router();

templateRouter.use(requireAuth);
templateRouter.get('/', asyncHandler(list));
templateRouter.post('/', asyncHandler(create));
templateRouter.get('/:templateId', validate('params', templateParams), asyncHandler(read));
templateRouter.patch(
  '/:templateId/status',
  validate('params', templateParams),
  asyncHandler(patchStatus)
);
templateRouter.post(
  '/:templateId/instantiate',
  validate('params', templateParams),
  asyncHandler(instantiate)
);
