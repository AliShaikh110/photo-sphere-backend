import { Router } from 'express';
import {
  addHotspot,
  addScene,
  create,
  list,
  patchHotspot,
  patchScene,
  read,
  readScene,
  reorderProjectScenes,
  removeHotspot,
  removeScene,
  scenes,
  update
} from '../controllers/project-controller';
import {
  preview,
  publicationHistory,
  publish,
  validateDraft
} from '../controllers/experience-controller';
import {
  addInteraction,
  duplicateInteraction,
  patchInteraction,
  patchTimeline,
  readTimeline,
  removeInteraction
} from '../controllers/timeline-controller';
import { requireAuth } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import {
  bulkUpdateTimelineSchema,
  createHotspotSchema,
  createProjectSchema,
  createSceneSchema,
  createTimelineInteractionSchema,
  duplicateTimelineInteractionSchema,
  hotspotParams,
  projectIdParams,
  projectMutationRevisionSchema,
  projectRevisionSchema,
  publishSchema,
  reorderScenesSchema,
  sceneParams,
  timelineInteractionParams,
  updateHotspotSchema,
  updateProjectSchema,
  updateSceneSchema,
  updateTimelineInteractionSchema
} from '../validators/request-schemas';

export const projectRouter = Router();

projectRouter.use(requireAuth);
projectRouter.get('/', asyncHandler(list));
projectRouter.post('/', validate('body', createProjectSchema), asyncHandler(create));
projectRouter.get('/:projectId', validate('params', projectIdParams), asyncHandler(read));
projectRouter.patch(
  '/:projectId',
  validate('params', projectIdParams),
  validate('body', updateProjectSchema),
  asyncHandler(update)
);
projectRouter.post(
  '/:projectId/validate',
  validate('params', projectIdParams),
  validate('body', projectRevisionSchema),
  asyncHandler(validateDraft)
);
projectRouter.post(
  '/:projectId/preview-manifest',
  validate('params', projectIdParams),
  validate('body', projectRevisionSchema),
  asyncHandler(preview)
);
projectRouter.post(
  '/:projectId/publish',
  validate('params', projectIdParams),
  validate('body', publishSchema),
  asyncHandler(publish)
);
projectRouter.get(
  '/:projectId/publications',
  validate('params', projectIdParams),
  asyncHandler(publicationHistory)
);

projectRouter.get('/:projectId/scenes', validate('params', projectIdParams), asyncHandler(scenes));
projectRouter.post(
  '/:projectId/scenes',
  validate('params', projectIdParams),
  validate('body', createSceneSchema),
  asyncHandler(addScene)
);
projectRouter.post(
  '/:projectId/scenes/reorder',
  validate('params', projectIdParams),
  validate('body', reorderScenesSchema),
  asyncHandler(reorderProjectScenes)
);
projectRouter.get('/:projectId/scenes/:sceneId', validate('params', sceneParams), asyncHandler(readScene));
projectRouter.patch(
  '/:projectId/scenes/:sceneId',
  validate('params', sceneParams),
  validate('body', updateSceneSchema),
  asyncHandler(patchScene)
);
projectRouter.delete(
  '/:projectId/scenes/:sceneId',
  validate('params', sceneParams),
  validate('body', projectMutationRevisionSchema),
  asyncHandler(removeScene)
);

projectRouter.get(
  '/:projectId/timeline',
  validate('params', projectIdParams),
  asyncHandler(readTimeline)
);
projectRouter.patch(
  '/:projectId/timeline',
  validate('params', projectIdParams),
  validate('body', bulkUpdateTimelineSchema),
  asyncHandler(patchTimeline)
);
projectRouter.post(
  '/:projectId/timeline/interactions',
  validate('params', projectIdParams),
  validate('body', createTimelineInteractionSchema),
  asyncHandler(addInteraction)
);
projectRouter.post(
  '/:projectId/timeline/interactions/:interactionId/duplicate',
  validate('params', timelineInteractionParams),
  validate('body', duplicateTimelineInteractionSchema),
  asyncHandler(duplicateInteraction)
);
projectRouter.patch(
  '/:projectId/timeline/interactions/:interactionId',
  validate('params', timelineInteractionParams),
  validate('body', updateTimelineInteractionSchema),
  asyncHandler(patchInteraction)
);
projectRouter.delete(
  '/:projectId/timeline/interactions/:interactionId',
  validate('params', timelineInteractionParams),
  validate('body', projectMutationRevisionSchema),
  asyncHandler(removeInteraction)
);

projectRouter.post(
  '/:projectId/scenes/:sceneId/hotspots',
  validate('params', sceneParams),
  validate('body', createHotspotSchema),
  asyncHandler(addHotspot)
);
projectRouter.patch(
  '/:projectId/scenes/:sceneId/hotspots/:hotspotId',
  validate('params', hotspotParams),
  validate('body', updateHotspotSchema),
  asyncHandler(patchHotspot)
);
projectRouter.delete(
  '/:projectId/scenes/:sceneId/hotspots/:hotspotId',
  validate('params', hotspotParams),
  validate('body', projectMutationRevisionSchema),
  asyncHandler(removeHotspot)
);
