import { Router } from 'express';
import { manifest, media, publicationMedia } from '../controllers/experience-controller';
import { optionalAuth } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import { derivativeParams, publicationMediaParams, slugParams } from '../validators/request-schemas';

export const viewRouter = Router();
export const mediaRouter = Router();
export const publicationMediaRouter = Router();

viewRouter.get('/:slug/manifest', optionalAuth, validate('params', slugParams), asyncHandler(manifest));
mediaRouter.get('/:derivativeId', optionalAuth, validate('params', derivativeParams), asyncHandler(media));
publicationMediaRouter.get(
  '/:projectId/:publicationRevision/media/:derivativeId',
  validate('params', publicationMediaParams),
  asyncHandler(publicationMedia)
);
