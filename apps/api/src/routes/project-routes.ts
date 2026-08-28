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
  patchEmbedPolicy,
  preview,
  publicationHistory,
  publish,
  unpublish,
  validateDraft
} from '../controllers/experience-controller';
import {
  interactions as analyticsInteractions,
  reliability as analyticsReliability,
  scenes as analyticsScenes,
  summary as analyticsSummary,
  timeseries as analyticsTimeseries,
  video as analyticsVideo
} from '../controllers/analytics-controller';
import {
  grantAccess,
  listAccess,
  myProjectRole,
  projectAuditLog,
  revokeAccess
} from '../controllers/collaboration-controller';
import {
  create as createOverlay,
  list as listOverlays,
  patch as patchOverlay,
  remove as removeOverlay
} from '../controllers/overlay-controller';
import {
  create as createPlan,
  list as listPlans,
  patch as patchPlan,
  remove as removePlan,
  reorder as reorderPlans
} from '../controllers/plan-controller';
import {
  create as createShareToken,
  list as listShareTokens,
  revoke as revokeShareToken
} from '../controllers/sharing-controller';
import {
  addInteraction,
  duplicateInteraction,
  patchInteraction,
  patchTimeline,
  readTimeline,
  removeInteraction
} from '../controllers/timeline-controller';
import {
  bootstrap as editorBootstrapHandler,
  events as projectEvents,
  patchHotspots
} from '../controllers/editor-controller';
import { requireAuth } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import {
  bulkUpdateHotspotsSchema,
  bulkUpdateTimelineSchema,
  createHotspotSchema,
  createOverlaySchema,
  createPlanSchema,
  createProjectSchema,
  createSceneSchema,
  createTimelineInteractionSchema,
  duplicateTimelineInteractionSchema,
  hotspotParams,
  overlayParams,
  planParams,
  projectAccessParams,
  projectIdParams,
  projectMutationRevisionSchema,
  projectRevisionSchema,
  publishSchema,
  reorderPlansSchema,
  reorderScenesSchema,
  sceneParams,
  shareTokenParams,
  timelineInteractionParams,
  updateEmbedPolicySchema,
  updateHotspotSchema,
  updateOverlaySchema,
  updatePlanSchema,
  updateProjectSchema,
  updateSceneSchema,
  updateTimelineInteractionSchema
} from '../validators/request-schemas';

export const projectRouter = Router();

/**
 * The event stream authenticates itself: a browser `EventSource` cannot send an
 * Authorization header, so it carries a short-lived project-scoped session
 * token instead. It is registered before the bearer guard for that reason.
 */
projectRouter.get(
  '/:projectId/events',
  validate('params', projectIdParams),
  asyncHandler(projectEvents)
);

projectRouter.use(requireAuth);
projectRouter.get(
  '/:projectId/editor-bootstrap',
  validate('params', projectIdParams),
  asyncHandler(editorBootstrapHandler)
);
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

projectRouter.patch(
  '/:projectId/scenes/:sceneId/hotspots',
  validate('params', sceneParams),
  validate('body', bulkUpdateHotspotsSchema),
  asyncHandler(patchHotspots)
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

/* --------------------------------------------------------------------- */
/* Sprint 04: plans, overlays, analytics, access, sharing and audit        */
/* --------------------------------------------------------------------- */

projectRouter.get('/:projectId/plans', validate('params', projectIdParams), asyncHandler(listPlans));
projectRouter.post(
  '/:projectId/plans',
  validate('params', projectIdParams),
  validate('body', createPlanSchema),
  asyncHandler(createPlan)
);
projectRouter.post(
  '/:projectId/plans/reorder',
  validate('params', projectIdParams),
  validate('body', reorderPlansSchema),
  asyncHandler(reorderPlans)
);
projectRouter.patch(
  '/:projectId/plans/:planId',
  validate('params', planParams),
  validate('body', updatePlanSchema),
  asyncHandler(patchPlan)
);
projectRouter.delete(
  '/:projectId/plans/:planId',
  validate('params', planParams),
  validate('body', projectMutationRevisionSchema),
  asyncHandler(removePlan)
);

projectRouter.get(
  '/:projectId/scenes/:sceneId/overlays',
  validate('params', sceneParams),
  asyncHandler(listOverlays)
);
projectRouter.post(
  '/:projectId/scenes/:sceneId/overlays',
  validate('params', sceneParams),
  validate('body', createOverlaySchema),
  asyncHandler(createOverlay)
);
projectRouter.patch(
  '/:projectId/scenes/:sceneId/overlays/:overlayId',
  validate('params', overlayParams),
  validate('body', updateOverlaySchema),
  asyncHandler(patchOverlay)
);
projectRouter.delete(
  '/:projectId/scenes/:sceneId/overlays/:overlayId',
  validate('params', overlayParams),
  validate('body', projectMutationRevisionSchema),
  asyncHandler(removeOverlay)
);

projectRouter.get(
  '/:projectId/analytics/summary',
  validate('params', projectIdParams),
  asyncHandler(analyticsSummary)
);
projectRouter.get(
  '/:projectId/analytics/timeseries',
  validate('params', projectIdParams),
  asyncHandler(analyticsTimeseries)
);
projectRouter.get(
  '/:projectId/analytics/scenes',
  validate('params', projectIdParams),
  asyncHandler(analyticsScenes)
);
projectRouter.get(
  '/:projectId/analytics/interactions',
  validate('params', projectIdParams),
  asyncHandler(analyticsInteractions)
);
projectRouter.get(
  '/:projectId/analytics/video',
  validate('params', projectIdParams),
  asyncHandler(analyticsVideo)
);
projectRouter.get(
  '/:projectId/analytics/reliability',
  validate('params', projectIdParams),
  asyncHandler(analyticsReliability)
);

projectRouter.get('/:projectId/access', validate('params', projectIdParams), asyncHandler(listAccess));
projectRouter.get(
  '/:projectId/access/me',
  validate('params', projectIdParams),
  asyncHandler(myProjectRole)
);
projectRouter.post(
  '/:projectId/access',
  validate('params', projectIdParams),
  asyncHandler(grantAccess)
);
projectRouter.delete(
  '/:projectId/access/:grantId',
  validate('params', projectAccessParams),
  asyncHandler(revokeAccess)
);
projectRouter.get(
  '/:projectId/audit-log',
  validate('params', projectIdParams),
  asyncHandler(projectAuditLog)
);

projectRouter.get(
  '/:projectId/share-tokens',
  validate('params', projectIdParams),
  asyncHandler(listShareTokens)
);
projectRouter.post(
  '/:projectId/share-tokens',
  validate('params', projectIdParams),
  asyncHandler(createShareToken)
);
projectRouter.delete(
  '/:projectId/share-tokens/:shareTokenId',
  validate('params', shareTokenParams),
  asyncHandler(revokeShareToken)
);

projectRouter.put(
  '/:projectId/embed-policy',
  validate('params', projectIdParams),
  validate('body', updateEmbedPolicySchema),
  asyncHandler(patchEmbedPolicy)
);
projectRouter.post(
  '/:projectId/unpublish',
  validate('params', projectIdParams),
  asyncHandler(unpublish)
);
