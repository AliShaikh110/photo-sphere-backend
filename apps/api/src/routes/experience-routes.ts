import { Router } from 'express';
import {
  manifest,
  media,
  mediaTile,
  playbackProfile,
  publicationMedia,
  publicationMediaTile,
  publishedScene,
  publishedSceneIndex,
  revisionedPublishedScene
} from '../controllers/experience-controller';
import { refreshMediaTokens } from '../controllers/editor-controller';
import { optionalAuth, requireAuth } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import {
  derivativeParams,
  mediaTokenRefreshSchema,
  mediaTileParams,
  publicationMediaParams,
  publicationMediaTileParams,
  publishedSceneIndexParams,
  publishedSceneParams,
  revisionedPublishedSceneParams,
  slugParams
} from '../validators/request-schemas';

export const viewRouter = Router();
export const mediaRouter = Router();
export const publicationMediaRouter = Router();

viewRouter.get('/:slug/manifest', optionalAuth, validate('params', slugParams), asyncHandler(manifest));
viewRouter.post(
  '/:slug/playback-profile',
  optionalAuth,
  validate('params', slugParams),
  asyncHandler(playbackProfile)
);
viewRouter.get(
  '/:slug/revisions/:publicationRevision/scene-index',
  optionalAuth,
  validate('params', publishedSceneIndexParams),
  asyncHandler(publishedSceneIndex)
);
viewRouter.get(
  '/:slug/revisions/:publicationRevision/scenes/:sceneId',
  optionalAuth,
  validate('params', revisionedPublishedSceneParams),
  asyncHandler(revisionedPublishedScene)
);
viewRouter.get(
  '/:slug/scenes/:sceneId',
  optionalAuth,
  validate('params', publishedSceneParams),
  asyncHandler(publishedScene)
);
/**
 * Reissues expiring media URLs. Registered before the derivative routes so
 * "tokens" is never read as a derivative id.
 */
mediaRouter.post(
  '/tokens',
  requireAuth,
  validate('body', mediaTokenRefreshSchema),
  asyncHandler(refreshMediaTokens)
);
mediaRouter.get(
  '/:derivativeId/tiles/:level/:x/:y',
  optionalAuth,
  validate('params', mediaTileParams),
  asyncHandler(mediaTile)
);
mediaRouter.get('/:derivativeId', optionalAuth, validate('params', derivativeParams), asyncHandler(media));
publicationMediaRouter.get(
  '/:projectId/:publicationRevision/media/:derivativeId/tiles/:level/:x/:y',
  validate('params', publicationMediaTileParams),
  asyncHandler(publicationMediaTile)
);
publicationMediaRouter.get(
  '/:projectId/:publicationRevision/media/:derivativeId',
  validate('params', publicationMediaParams),
  asyncHandler(publicationMedia)
);
