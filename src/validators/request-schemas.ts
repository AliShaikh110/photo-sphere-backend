import { z } from 'zod';
import { SCENE_TRANSITION_FAILURE_CATEGORIES } from '../runtime';
import { VIDEO_PLAYBACK_FAILURE_CATEGORIES } from '../models/model.types';

const id = z.string().uuid();
const databaseRevision = z.number().int().positive().max(2_147_483_647);
const jsonRecord = z.record(z.string(), z.unknown());
const forbiddenCanonicalKeys = new Set([
  'adapter',
  'plugin',
  'plugins',
  'psv',
  'psvconfig',
  'photosphereviewer',
  'rendererconfig',
  'viewerconfig',
  'viewerintegration'
]);

function rendererSpecificPath(value: unknown, path = ''): string | undefined {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const found = rendererSpecificPath(entry, `${path}[${index}]`);
      if (found) return found;
    }
    return undefined;
  }
  if (value === null || typeof value !== 'object') return undefined;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const nestedPath = path ? `${path}.${key}` : key;
    if (forbiddenCanonicalKeys.has(key.toLowerCase())) return nestedPath;
    const found = rendererSpecificPath(nested, nestedPath);
    if (found) return found;
  }
  return undefined;
}

const canonicalJsonRecord = jsonRecord.superRefine((value, context) => {
  const path = rendererSpecificPath(value);
  if (path) {
    context.addIssue({
      code: 'custom',
      path: path.split('.'),
      message: 'Renderer-specific configuration is not allowed in canonical project data.'
    });
  }
});
const safeName = z.string().trim().min(1).max(160);
const richText = z.string().max(20_000);

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(12).max(200),
  displayName: z.string().trim().min(1).max(120)
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(200)
});

const appearanceSchema = z
  .object({
    theme: z.enum(['light', 'dark', 'custom']).optional(),
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    backgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    hotspotStyle: z.string().trim().max(80).optional(),
    typography: z.string().trim().max(120).optional()
  })
  .strict();

const navigationSchema = z
  .object({
    mouse: z.boolean().optional(),
    touch: z.boolean().optional(),
    zoom: z.boolean().optional(),
    keyboard: z.boolean().optional(),
    fullscreen: z.boolean().optional(),
    navigationButtons: z.boolean().optional(),
    sceneNavigation: z.boolean().optional()
  })
  .strict();

const gallerySchema = z
  .object({
    enabled: z.boolean().optional(),
    showSceneNames: z.boolean().optional(),
    showThumbnails: z.boolean().optional()
  })
  .strict();

const autorotationSchema = z
  .object({
    enabled: z.boolean().optional(),
    speedDegreesPerSecond: z.number().min(0.1).max(30).optional(),
    direction: z.enum(['clockwise', 'counterclockwise']).optional(),
    startAutomatically: z.boolean().optional()
  })
  .strict();

const compassSchema = z.object({ enabled: z.boolean().optional() }).strict();
const qualitySchema = z
  .object({ preference: z.enum(['automatic', 'standard', 'high']).optional() })
  .strict();

const videoSettingsSchema = z
  .object({
    autoplay: z.boolean().optional(),
    loop: z.boolean().optional(),
    muted: z.boolean().optional(),
    showControls: z.boolean().optional(),
    showTimeline: z.boolean().optional(),
    startAtMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional(),
    qualityPreference: z.enum(['automatic', 'dataSaver', 'high']).optional()
  })
  .strict();

export const projectSettingsSchema = z
  .object({
    appearance: appearanceSchema.optional(),
    navigation: navigationSchema.optional(),
    gallery: gallerySchema.optional(),
    autorotation: autorotationSchema.optional(),
    compass: compassSchema.optional(),
    quality: qualitySchema.optional(),
    video: videoSettingsSchema.optional(),
    information: z
      .object({
        title: z.string().trim().max(240).optional(),
        description: richText.optional(),
        bodyHtml: richText.optional(),
        externalUrl: z.string().trim().max(2048).optional()
      })
      .strict()
      .optional()
  })
  .strict();

export const brandingSchema = z
  .object({
    companyName: z.string().trim().max(160).optional(),
    logoAssetId: id.optional(),
    faviconAssetId: id.optional(),
    watermarkAssetId: id.optional(),
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    welcomeMessage: richText.optional(),
    loadingMessage: richText.optional()
  })
  .strict();

export const createProjectSchema = z
  .object({
    type: z.enum(['image360', 'video360']).default('image360'),
    name: safeName,
    settings: projectSettingsSchema.optional(),
    branding: brandingSchema.optional(),
    videoSettings: videoSettingsSchema.optional()
  })
  .strict();

export const updateProjectSchema = z
  .object({
    revision: databaseRevision,
    name: safeName.optional(),
    settings: projectSettingsSchema.optional(),
    branding: brandingSchema.optional(),
    videoAssetId: id.nullable().optional(),
    videoSettings: videoSettingsSchema.optional()
  })
  .strict()
  .refine(
    (value) => value.name !== undefined
      || value.settings !== undefined
      || value.branding !== undefined
      || value.videoAssetId !== undefined
      || value.videoSettings !== undefined,
    { message: 'At least one editable field is required.' }
  );

export const projectRevisionSchema = z.object({ revision: databaseRevision }).strict();
export const projectMutationRevisionSchema = z
  .object({ projectRevision: databaseRevision })
  .strict();

const initialViewSchema = z
  .object({
    headingDegrees: z.number().min(-180).max(180).optional(),
    pitchDegrees: z.number().min(-90).max(90).optional(),
    horizontalFovDegrees: z.number().min(30).max(120).optional()
  })
  .strict();

const viewLimitsSchema = z
  .object({
    minHeadingDegrees: z.number().min(-180).max(180).optional(),
    maxHeadingDegrees: z.number().min(-180).max(180).optional(),
    minPitchDegrees: z.number().min(-90).max(90).optional(),
    maxPitchDegrees: z.number().min(-90).max(90).optional()
  })
  .strict();

const sceneConnectionContentSchema = z
  .object({
    title: z.string().trim().max(240).optional(),
    description: richText.optional()
  })
  .strict();

const sceneConnectionSchema = z
  .object({
    id: id.optional(),
    sourceSceneId: id.optional(),
    targetSceneId: id,
    triggerHotspotId: id.nullable().optional(),
    label: z.string().trim().max(240).nullable().optional(),
    content: sceneConnectionContentSchema.optional(),
    importance: z.number().int().min(0).max(100).nullable().optional(),
    preloadHint: z.enum(['none', 'normal', 'high']).nullable().optional()
  })
  .strict();

const sceneConnectionsSchema = z.array(sceneConnectionSchema).max(100).superRefine((connections, context) => {
  const ids = new Set<string>();
  for (const [index, connection] of connections.entries()) {
    if (connection.id === undefined) continue;
    if (ids.has(connection.id)) {
      context.addIssue({
        code: 'custom',
        path: [index, 'id'],
        message: 'Connection IDs must be unique within a scene.'
      });
    }
    ids.add(connection.id);
  }
});

const sceneRuntimeHintsSchema = z
  .object({
    preloadPriority: z.number().min(0).max(100).optional(),
    likelyNextSceneIds: z.array(id).max(100).optional(),
    qualityPreference: z.enum(['automatic', 'standard', 'high']).optional()
  })
  .strict();

export const createSceneSchema = z
  .object({
    projectRevision: databaseRevision,
    name: safeName,
    panoramaAssetId: id.nullable().optional(),
    initialView: initialViewSchema.optional(),
    viewLimits: viewLimitsSchema.optional(),
    connections: sceneConnectionsSchema.optional(),
    spatialData: canonicalJsonRecord.optional(),
    runtimeHints: sceneRuntimeHintsSchema.optional()
  })
  .strict();

export const updateSceneSchema = z
  .object({
    projectRevision: databaseRevision,
    name: safeName.optional(),
    panoramaAssetId: id.nullable().optional(),
    initialView: initialViewSchema.optional(),
    viewLimits: viewLimitsSchema.optional(),
    connections: sceneConnectionsSchema.optional(),
    spatialData: canonicalJsonRecord.optional(),
    runtimeHints: sceneRuntimeHintsSchema.optional()
  })
  .strict();

export const reorderScenesSchema = z
  .object({
    projectRevision: databaseRevision,
    sceneIds: z.array(id).min(1).max(5_000)
  })
  .strict()
  .refine((value) => new Set(value.sceneIds).size === value.sceneIds.length, {
    path: ['sceneIds'],
    message: 'Scene IDs must not contain duplicates.'
  });

const pointPositionSchema = z
  .object({
    coordinateSystem: z.literal('spherical_degrees').default('spherical_degrees'),
    longitudeDegrees: z.number().min(-180).max(180),
    latitudeDegrees: z.number().min(-90).max(90)
  })
  .strict();

const hotspotContentSchema = z
  .object({
    title: z.string().trim().max(240).optional(),
    description: richText.optional(),
    bodyHtml: richText.optional(),
    tooltip: z.string().trim().max(500).optional(),
    buttonLabel: z.string().trim().max(120).optional(),
    externalUrl: z.string().trim().max(2048).optional(),
    imageAssetId: id.optional(),
    videoAssetId: id.optional()
  })
  .strict();

const hotspotActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({ kind: z.literal('showInformation') }).strict(),
  z.object({ kind: z.literal('openUrl'), url: z.string().trim().max(2048) }).strict(),
  z.object({ kind: z.literal('openAsset'), assetId: id }).strict(),
  z.object({ kind: z.literal('goToScene'), sceneId: id }).strict()
]);

const hotspotAppearanceSchema = z
  .object({
    label: z.string().trim().max(240).optional(),
    iconAssetId: id.optional(),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    emphasis: z.enum(['normal', 'prominent', 'subtle']).optional()
  })
  .strict();

const visibilityRulesSchema = z.object({ enabled: z.boolean().optional() }).strict();

export const createHotspotSchema = z
  .object({
    projectRevision: databaseRevision,
    geometry: z.object({ kind: z.literal('point') }).strict(),
    position: pointPositionSchema,
    appearance: hotspotAppearanceSchema.default({}),
    content: hotspotContentSchema.default({}),
    action: hotspotActionSchema.default({ kind: 'none' }),
    visibilityRules: visibilityRulesSchema.default({})
  })
  .strict();

export const updateHotspotSchema = z
  .object({
    projectRevision: databaseRevision,
    position: pointPositionSchema.optional(),
    appearance: hotspotAppearanceSchema.optional(),
    content: hotspotContentSchema.optional(),
    action: hotspotActionSchema.optional(),
    visibilityRules: visibilityRulesSchema.optional()
  })
  .strict();

const timelineTimeMs = z.number().int().min(0).max(24 * 60 * 60 * 1000);

const viewpointSchema = z
  .object({
    headingDegrees: z.number().min(-180).max(180),
    pitchDegrees: z.number().min(-90).max(90),
    horizontalFovDegrees: z.number().min(30).max(120).optional(),
    transition: z.enum(['cut', 'smooth']).optional(),
    transitionMs: z.number().int().min(0).max(10_000).optional()
  })
  .strict();

const timelineContentSchema = hotspotContentSchema.extend({
  ctaLabel: z.string().trim().max(120).optional(),
  ctaUrl: z.string().trim().max(2048).optional()
}).strict();

const timelineActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({ kind: z.literal('showInformation') }).strict(),
  z.object({ kind: z.literal('openUrl'), url: z.string().trim().max(2048) }).strict(),
  z.object({ kind: z.literal('openAsset'), assetId: id }).strict(),
  z.object({ kind: z.literal('setViewpoint') }).strict()
]);

const timelineVisibilityRulesSchema = z
  .object({
    enabled: z.boolean().optional(),
    persistUntilDismissed: z.boolean().optional(),
    pauseVideoWhenShown: z.boolean().optional()
  })
  .strict();

const timelineInteractionKindSchema = z.enum([
  'information',
  'hotspot',
  'viewpoint',
  'image',
  'video',
  'link',
  'cta'
]);

export const createTimelineInteractionSchema = z
  .object({
    projectRevision: databaseRevision,
    kind: timelineInteractionKindSchema,
    timeMs: timelineTimeMs,
    endTimeMs: timelineTimeMs.nullable().optional(),
    geometry: z.object({ kind: z.literal('point') }).strict().optional(),
    position: pointPositionSchema.optional(),
    viewpoint: viewpointSchema.optional(),
    appearance: hotspotAppearanceSchema.optional(),
    content: timelineContentSchema.optional(),
    action: timelineActionSchema.optional(),
    visibilityRules: timelineVisibilityRulesSchema.optional()
  })
  .strict()
  .refine(
    (value) => value.endTimeMs === undefined
      || value.endTimeMs === null
      || value.endTimeMs >= value.timeMs,
    { path: ['endTimeMs'], message: 'endTimeMs must not precede timeMs.' }
  );

export const updateTimelineInteractionSchema = z
  .object({
    projectRevision: databaseRevision,
    kind: timelineInteractionKindSchema.optional(),
    timeMs: timelineTimeMs.optional(),
    endTimeMs: timelineTimeMs.nullable().optional(),
    geometry: z.object({ kind: z.literal('point') }).strict().optional(),
    position: pointPositionSchema.optional(),
    viewpoint: viewpointSchema.optional(),
    appearance: hotspotAppearanceSchema.optional(),
    content: timelineContentSchema.optional(),
    action: timelineActionSchema.optional(),
    visibilityRules: timelineVisibilityRulesSchema.optional()
  })
  .strict()
  .refine(
    (value) => value.timeMs === undefined
      || value.endTimeMs === undefined
      || value.endTimeMs === null
      || value.endTimeMs >= value.timeMs,
    { path: ['endTimeMs'], message: 'endTimeMs must not precede timeMs.' }
  );

export const duplicateTimelineInteractionSchema = z
  .object({
    projectRevision: databaseRevision,
    timeMs: timelineTimeMs.optional()
  })
  .strict();

export const bulkUpdateTimelineSchema = z
  .object({
    projectRevision: databaseRevision,
    interactions: z
      .array(
        z
          .object({
            id,
            timeMs: timelineTimeMs,
            endTimeMs: timelineTimeMs.nullable().optional()
          })
          .strict()
      )
      .min(1)
      .max(500)
  })
  .strict()
  .refine(
    (value) => new Set(value.interactions.map((entry) => entry.id)).size
      === value.interactions.length,
    { path: ['interactions'], message: 'Interaction IDs must not repeat in one update.' }
  );

export const uploadSessionSchema = z
  .object({
    projectId: id.optional(),
    mediaType: z
      .enum(['panorama_image', 'image', 'logo', 'video360', 'video'])
      .default('panorama_image'),
    filename: z.string().trim().min(1).max(255),
    mimeType: z.enum([
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'video/mp4',
      'video/webm'
    ]),
    sizeBytes: z.number().int().positive(),
    checksumSha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional()
  })
  .strict()
  .refine(
    (value) => (value.mediaType === 'video360' || value.mediaType === 'video')
      === value.mimeType.startsWith('video/'),
    { path: ['mimeType'], message: 'The media type and file type must match.' }
  );

export const reprocessAssetSchema = z
  .object({
    profiles: z.array(z.enum(['poster', 'desktop', 'mobile'])).min(1).max(3).optional()
  })
  .strict();

export const completeUploadSchema = z.object({ uploadSessionId: id }).strict();

export const publishSchema = z
  .object({
    revision: databaseRevision,
    slug: z
      .string()
      .trim()
      .min(3)
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    visibility: z.enum(['public', 'private'])
  })
  .strict();

export const runtimeEventNameSchema = z.enum([
  'experience_load_started',
  'first_panorama_visible',
  'time_to_interactive',
  'scene_changed',
  'hotspot_clicked',
  'asset_failed',
  'scene_transition_failed',
  'viewer_error',
  'experience_exited',
  'video_started',
  'video_paused',
  'video_resumed',
  'video_seeked',
  'video_stalled',
  'video_ended',
  'video_profile_selected',
  'video_playback_failed',
  'timeline_interaction_shown',
  'timeline_interaction_clicked'
]);

const runtimeEventBaseSchema = z
  .object({
    eventId: id,
    experienceId: id,
    publicationRevision: databaseRevision,
    viewerIntegrationVersion: z.string().trim().min(1).max(64),
    sessionId: z.string().trim().min(8).max(128),
    deviceContext: jsonRecord.default({}),
    runtimeContext: jsonRecord.default({}),
    occurredAt: z.iso.datetime({ offset: true })
  });

const existingRuntimeEventSchema = runtimeEventBaseSchema
  .extend({
    eventName: z.enum([
      'experience_load_started',
      'first_panorama_visible',
      'time_to_interactive',
      'scene_changed',
      'hotspot_clicked',
      'asset_failed',
      'viewer_error',
      'experience_exited'
    ]),
    payload: jsonRecord.default({})
  })
  .strict();

const videoPlaybackPayloadSchema = z
  .object({
    assetId: id.optional(),
    derivativeId: id.optional(),
    profileId: z.enum(['desktop', 'mobile']).optional(),
    currentTimeMs: z.number().int().min(0).optional(),
    durationMs: z.number().int().min(0).optional()
  })
  .passthrough();

const videoPlaybackEventSchema = runtimeEventBaseSchema
  .extend({
    eventName: z.enum([
      'video_started',
      'video_paused',
      'video_resumed',
      'video_seeked',
      'video_stalled',
      'video_ended'
    ]),
    payload: videoPlaybackPayloadSchema
  })
  .strict();

export const videoProfileSelectedPayloadSchema = z
  .object({
    assetId: id,
    derivativeId: id,
    profileId: z.enum(['desktop', 'mobile']),
    reason: z.string().trim().max(120).optional(),
    candidateProfileIds: z.array(z.enum(['desktop', 'mobile'])).max(4).optional()
  })
  .passthrough();

const videoProfileSelectedEventSchema = runtimeEventBaseSchema
  .extend({
    eventName: z.literal('video_profile_selected'),
    payload: videoProfileSelectedPayloadSchema
  })
  .strict();

export const videoPlaybackFailurePayloadSchema = z
  .object({
    assetId: id,
    derivativeId: id.optional(),
    profileId: z.enum(['desktop', 'mobile']).optional(),
    failureCategory: z.enum(VIDEO_PLAYBACK_FAILURE_CATEGORIES),
    currentTimeMs: z.number().int().min(0).optional()
  })
  .passthrough();

const videoPlaybackFailedEventSchema = runtimeEventBaseSchema
  .extend({
    eventName: z.literal('video_playback_failed'),
    payload: videoPlaybackFailurePayloadSchema
  })
  .strict();

const timelineInteractionEventSchema = runtimeEventBaseSchema
  .extend({
    eventName: z.enum(['timeline_interaction_shown', 'timeline_interaction_clicked']),
    payload: z
      .object({
        interactionId: id,
        kind: z.enum(['information', 'hotspot', 'viewpoint', 'image', 'video', 'link', 'cta']),
        timeMs: z.number().int().min(0).optional()
      })
      .passthrough()
  })
  .strict();

export const sceneTransitionFailurePayloadSchema = z
  .object({
    sourceSceneId: id,
    targetSceneId: id,
    failureCategory: z.enum(SCENE_TRANSITION_FAILURE_CATEGORIES),
    assetId: id.optional()
  })
  .passthrough();

const sceneTransitionFailureEventSchema = runtimeEventBaseSchema
  .extend({
    eventName: z.literal('scene_transition_failed'),
    payload: sceneTransitionFailurePayloadSchema
  })
  .strict();

export const runtimeEventSchema = z.discriminatedUnion('eventName', [
  existingRuntimeEventSchema,
  sceneTransitionFailureEventSchema,
  videoPlaybackEventSchema,
  videoProfileSelectedEventSchema,
  videoPlaybackFailedEventSchema,
  timelineInteractionEventSchema
]);

export const runtimeEventsSchema = z.union([
  runtimeEventSchema.transform((event) => ({ events: [event] })),
  z.object({ events: z.array(runtimeEventSchema).min(1).max(100) }).strict()
]);

export const projectIdParams = z.object({ projectId: id });
export const assetIdParams = z.object({ assetId: id });
export const uploadSessionParams = z.object({ uploadSessionId: id });
export const sceneParams = z.object({ projectId: id, sceneId: id });
export const hotspotParams = z.object({ projectId: id, sceneId: id, hotspotId: id });
export const timelineInteractionParams = z.object({ projectId: id, interactionId: id });
export const derivativeParams = z.object({ derivativeId: id });
const nonNegativePathInteger = z.string().regex(/^(0|[1-9][0-9]*)$/).refine(
  (value) => Number.isSafeInteger(Number(value)),
  { message: 'Path integer exceeds the supported range.' }
);
const publicationRevisionParam = z.string().regex(/^[1-9][0-9]*$/).refine(
  (value) => Number(value) <= 2_147_483_647,
  { message: 'Publication revision exceeds the supported range.' }
);

export const mediaTileParams = z.object({
  derivativeId: id,
  level: nonNegativePathInteger,
  x: nonNegativePathInteger,
  y: nonNegativePathInteger
});
export const publicationMediaParams = z.object({
  projectId: id,
  publicationRevision: publicationRevisionParam,
  derivativeId: id
});
export const publicationMediaTileParams = publicationMediaParams.extend({
  level: nonNegativePathInteger,
  x: nonNegativePathInteger,
  y: nonNegativePathInteger
});
export const slugParams = z.object({ slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100) });
export const publishedSceneParams = slugParams.extend({ sceneId: id });
export const playbackProfileRequestSchema = z
  .object({
    viewportClass: z.enum(['constrained', 'standard', 'capable']).optional(),
    handheld: z.boolean().optional(),
    touch: z.boolean().optional(),
    maxTextureSize: z.number().int().min(0).max(65_536).optional(),
    networkClass: z.enum(['offline', 'constrained', 'standard', 'fast']).optional(),
    supportedMimeTypes: z.array(z.string().trim().max(120)).max(20).optional(),
    dataSaver: z.boolean().optional()
  })
  .strict();
export const revisionedPublishedSceneParams = publishedSceneParams.extend({
  publicationRevision: publicationRevisionParam
});
