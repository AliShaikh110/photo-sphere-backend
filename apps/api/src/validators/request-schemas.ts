import { z } from 'zod';
import { SCENE_TRANSITION_FAILURE_CATEGORIES } from '../runtime';
import {
  ACCESS_ROLES,
  CAPABILITY_FALLBACK_REASONS,
  EXTENSION_STATUSES,
  INTERACTION_GEOMETRY_KINDS,
  TEMPLATE_ASSET_POLICIES,
  TEMPLATE_STATUSES,
  TEMPLATE_VISIBILITIES,
  VIDEO_PLAYBACK_FAILURE_CATEGORIES
} from '../models/model.types';
import { CUSTOM_DOMAIN_STATUSES } from '../models/custom-domain.model';

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

const mapSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    showSceneMarkers: z.boolean().optional(),
    showHeadingCone: z.boolean().optional(),
    defaultZoom: z.number().min(0).max(24).optional()
  })
  .strict();

const planSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    defaultPlanId: id.optional(),
    showSceneMarkers: z.boolean().optional(),
    showHeadingCone: z.boolean().optional()
  })
  .strict();

const motionNavigationSchema = z
  .object({
    enabled: z.boolean().optional(),
    requestPermissionOnStart: z.boolean().optional()
  })
  .strict();

const immersiveViewingSchema = z
  .object({
    stereoEnabled: z.boolean().optional(),
    immersiveEnabled: z.boolean().optional()
  })
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
    map: mapSettingsSchema.optional(),
    plan: planSettingsSchema.optional(),
    motionNavigation: motionNavigationSchema.optional(),
    immersiveViewing: immersiveViewingSchema.optional(),
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

/**
 * World and plan placement are independent: a floor-plan experience never has
 * to invent GPS coordinates, and an outdoor tour never has to sit on a plan.
 */
const spatialDataSchema = z
  .object({
    coordinateSystem: z.enum(['wgs84', 'plan_normalized', 'plan_pixels']).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    altitudeMeters: z.number().min(-11_000).max(100_000).optional(),
    headingDegrees: z.number().min(0).max(360).optional(),
    planId: id.optional(),
    mapX: z.number().finite().optional(),
    mapY: z.number().finite().optional()
  })
  .strict()
  .superRefine((value, context) => {
    const hasLatitude = value.latitude !== undefined;
    const hasLongitude = value.longitude !== undefined;
    if (hasLatitude !== hasLongitude) {
      context.addIssue({
        code: 'custom',
        path: [hasLatitude ? 'longitude' : 'latitude'],
        message: 'Provide both a latitude and a longitude, or neither.'
      });
    }
    const hasMapX = value.mapX !== undefined;
    const hasMapY = value.mapY !== undefined;
    if (hasMapX !== hasMapY) {
      context.addIssue({
        code: 'custom',
        path: [hasMapX ? 'mapY' : 'mapX'],
        message: 'Provide both plan coordinates, or neither.'
      });
    }
    if ((hasMapX || hasMapY) && value.planId === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['planId'],
        message: 'Choose the plan this scene sits on.'
      });
    }
    if (value.planId !== undefined && (!hasMapX || !hasMapY)) {
      context.addIssue({
        code: 'custom',
        path: ['mapX'],
        message: 'Placing a scene on a plan needs both plan coordinates.'
      });
    }
    // `coordinateSystem` describes the plan reading when there is one, so a
    // scene placed on a plan cannot declare the world system for it.
    if (value.planId !== undefined && value.coordinateSystem === 'wgs84') {
      context.addIssue({
        code: 'custom',
        path: ['coordinateSystem'],
        message: 'A scene placed on a plan uses plan coordinates, not world coordinates.'
      });
    }
    if (value.coordinateSystem === 'plan_normalized') {
      for (const axis of ['mapX', 'mapY'] as const) {
        const coordinate = value[axis];
        if (coordinate !== undefined && (coordinate < 0 || coordinate > 1)) {
          context.addIssue({
            code: 'custom',
            path: [axis],
            message: 'Normalized plan coordinates run from 0 to 1.'
          });
        }
      }
    }
  });

const sphericalVertexSchema = z
  .object({
    coordinateSystem: z.literal('spherical_degrees').default('spherical_degrees'),
    longitudeDegrees: z.number().min(-180).max(180),
    latitudeDegrees: z.number().min(-90).max(90)
  })
  .strict();

const layerAnchorSchema = z
  .object({
    widthDegrees: z.number().gt(0).max(360),
    heightDegrees: z.number().gt(0).max(180),
    rotationDegrees: z.number().min(-360).max(360).optional(),
    opacity: z.number().min(0).max(1).optional(),
    chromaKeyColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional()
  })
  .strict();

/**
 * The canonical interaction geometry union shared by hotspots and overlays.
 * Minimum vertex counts are enforced here so an unusable area or route is
 * rejected at the edge rather than at publish time.
 */
export const interactionGeometrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('point') }).strict(),
  z
    .object({
      kind: z.literal('polygon'),
      vertices: z.array(sphericalVertexSchema).min(3).max(500)
    })
    .strict(),
  z
    .object({
      kind: z.literal('polyline'),
      vertices: z.array(sphericalVertexSchema).min(2).max(500)
    })
    .strict(),
  z
    .object({
      kind: z.literal('imageLayer'),
      assetId: id,
      anchor: layerAnchorSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal('videoLayer'),
      assetId: id,
      anchor: layerAnchorSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal('custom'),
      extensionId: z.string().trim().min(1).max(128),
      extensionVersion: z.string().trim().min(1).max(32),
      // Validated again against the registered extension schema on write; the
      // canonical guard here keeps renderer configuration out of the payload.
      payload: canonicalJsonRecord.default({})
    })
    .strict()
]);

/** Overlays are scene-layer elements, so a bare point is not a valid overlay. */
const overlayGeometrySchema = interactionGeometrySchema.refine(
  (geometry) => geometry.kind !== 'point',
  { message: 'An overlay needs an area, line or layer.' }
);

export const createSceneSchema = z
  .object({
    projectRevision: databaseRevision,
    name: safeName,
    panoramaAssetId: id.nullable().optional(),
    initialView: initialViewSchema.optional(),
    viewLimits: viewLimitsSchema.optional(),
    connections: sceneConnectionsSchema.optional(),
    spatialData: spatialDataSchema.optional(),
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
    spatialData: spatialDataSchema.optional(),
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
    geometry: interactionGeometrySchema.default({ kind: 'point' }),
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
    geometry: interactionGeometrySchema.optional(),
    position: pointPositionSchema.optional(),
    appearance: hotspotAppearanceSchema.optional(),
    content: hotspotContentSchema.optional(),
    action: hotspotActionSchema.optional(),
    visibilityRules: visibilityRulesSchema.optional()
  })
  .strict();

/* --------------------------------------------------------------------- */
/* Overlays                                                               */
/* --------------------------------------------------------------------- */

const overlayAppearanceSchema = z
  .object({
    label: z.string().trim().max(240).optional(),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    fillOpacity: z.number().min(0).max(1).optional(),
    strokeWidth: z.number().min(0).max(64).optional(),
    emphasis: z.enum(['normal', 'prominent', 'subtle']).optional()
  })
  .strict();

export const createOverlaySchema = z
  .object({
    projectRevision: databaseRevision,
    name: z.string().trim().max(160).nullable().optional(),
    geometry: overlayGeometrySchema,
    position: pointPositionSchema.optional(),
    appearance: overlayAppearanceSchema.default({}),
    content: hotspotContentSchema.default({}),
    action: hotspotActionSchema.default({ kind: 'none' }),
    visibilityRules: visibilityRulesSchema.default({})
  })
  .strict();

export const updateOverlaySchema = z
  .object({
    projectRevision: databaseRevision,
    name: z.string().trim().max(160).nullable().optional(),
    geometry: overlayGeometrySchema.optional(),
    position: pointPositionSchema.optional(),
    appearance: overlayAppearanceSchema.optional(),
    content: hotspotContentSchema.optional(),
    action: hotspotActionSchema.optional(),
    visibilityRules: visibilityRulesSchema.optional()
  })
  .strict();

/* --------------------------------------------------------------------- */
/* Floor and site plans                                                   */
/* --------------------------------------------------------------------- */

const planCoordinateSystemSchema = z.enum(['plan_normalized', 'plan_pixels']);

const planMetadataSchema = z
  .object({
    widthPixels: z.number().int().positive().max(100_000).optional(),
    heightPixels: z.number().int().positive().max(100_000).optional(),
    /** Real-world scale, so a plan view can show distances. */
    metersPerUnit: z.number().gt(0).max(10_000).optional(),
    /** Where north points on the plan image, in degrees clockwise. */
    northOffsetDegrees: z.number().min(0).max(360).optional(),
    floorLabel: z.string().trim().max(120).optional(),
    floorLevel: z.number().int().min(-100).max(500).optional()
  })
  .strict();

export const createPlanSchema = z
  .object({
    projectRevision: databaseRevision,
    name: safeName,
    assetId: id.nullable().optional(),
    coordinateSystem: planCoordinateSystemSchema.optional(),
    metadata: planMetadataSchema.optional()
  })
  .strict();

export const updatePlanSchema = z
  .object({
    projectRevision: databaseRevision,
    name: safeName.optional(),
    assetId: id.nullable().optional(),
    coordinateSystem: planCoordinateSystemSchema.optional(),
    metadata: planMetadataSchema.optional()
  })
  .strict();

export const reorderPlansSchema = z
  .object({
    projectRevision: databaseRevision,
    planIds: z.array(id).min(1).max(500)
  })
  .strict()
  .refine((value) => new Set(value.planIds).size === value.planIds.length, {
    path: ['planIds'],
    message: 'Plan IDs must not contain duplicates.'
  });

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

/** A site address: scheme, host and optional port, with no path or wildcard. */
const embedOrigin = z
  .string()
  .trim()
  .max(255)
  .regex(/^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i);

export const embedPolicySchema = z
  .object({
    mode: z.enum(['anywhere', 'allowlist', 'disabled']).default('anywhere'),
    allowedOrigins: z.array(embedOrigin).max(50).default([]),
    allowedApiOrigins: z.array(embedOrigin).max(50).default([])
  })
  .strict()
  .refine(
    (value) => value.mode !== 'allowlist' || value.allowedOrigins.length > 0,
    { path: ['allowedOrigins'], message: 'Add at least one site, or allow embedding anywhere.' }
  );

export const updateEmbedPolicySchema = z.object({ embedPolicy: embedPolicySchema }).strict();

export const publishSchema = z
  .object({
    revision: databaseRevision,
    slug: z
      .string()
      .trim()
      .min(3)
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    visibility: z.enum(['public', 'private']),
    embedPolicy: embedPolicySchema.optional()
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
  'timeline_interaction_clicked',
  'capability_fallback',
  'overlay_clicked',
  'map_interaction'
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
    // `durationMs` is the timing convention these events report against; it is
    // optional so an older player keeps reporting, and analytics aggregates the
    // samples that carry it.
    payload: jsonRecord
      .and(
        z
          .object({ durationMs: z.number().int().min(0).max(3_600_000).optional() })
          .passthrough()
      )
      .default({})
  })
  .strict();

const capabilityFallbackEventSchema = runtimeEventBaseSchema
  .extend({
    eventName: z.literal('capability_fallback'),
    payload: z
      .object({
        capabilityId: z.string().trim().min(1).max(64),
        reason: z.enum(CAPABILITY_FALLBACK_REASONS),
        fallbackApplied: z.string().trim().max(120).optional()
      })
      .passthrough()
  })
  .strict();

const overlayClickedEventSchema = runtimeEventBaseSchema
  .extend({
    eventName: z.literal('overlay_clicked'),
    payload: z
      .object({
        overlayId: id,
        sceneId: id.optional(),
        geometryKind: z.enum(INTERACTION_GEOMETRY_KINDS).optional()
      })
      .passthrough()
  })
  .strict();

const mapInteractionEventSchema = runtimeEventBaseSchema
  .extend({
    eventName: z.literal('map_interaction'),
    payload: z
      .object({
        surface: z.enum(['map', 'plan']),
        action: z.enum(['scene_selected', 'zoom', 'pan', 'opened', 'closed']),
        sceneId: id.optional(),
        planId: id.optional()
      })
      .passthrough()
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
  timelineInteractionEventSchema,
  capabilityFallbackEventSchema,
  overlayClickedEventSchema,
  mapInteractionEventSchema
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

/* --------------------------------------------------------------------- */
/* Sprint 04: templates, analytics, collaboration, sharing and operations  */
/* --------------------------------------------------------------------- */

export const planParams = z.object({ projectId: id, planId: id });
export const overlayParams = z.object({ projectId: id, sceneId: id, overlayId: id });
export const templateParams = z.object({ templateId: id });
export const workspaceParams = z.object({ workspaceId: id });
export const membershipParams = workspaceParams.extend({ membershipId: id });
export const customDomainParams = workspaceParams.extend({ customDomainId: id });
export const projectAccessParams = z.object({ projectId: id, grantId: id });
export const shareTokenParams = z.object({ projectId: id, shareTokenId: id });
export const extensionParams = z.object({
  extensionId: z.string().trim().min(1).max(128),
  version: z.string().trim().min(1).max(32)
});

/* Templates */

export const listTemplatesQuerySchema = z
  .object({ experienceType: z.enum(['image360', 'video360']).optional() })
  .strict();

export const createTemplateSchema = z
  .object({
    projectId: id,
    name: safeName,
    description: z.string().trim().max(2_000).optional(),
    visibility: z.enum(TEMPLATE_VISIBILITIES).optional(),
    assetPolicy: z.enum(TEMPLATE_ASSET_POLICIES).optional(),
    workspaceId: id.nullable().optional(),
    status: z.enum(TEMPLATE_STATUSES).optional()
  })
  .strict();

export const templateStatusSchema = z.object({ status: z.enum(TEMPLATE_STATUSES) }).strict();

export const instantiateTemplateSchema = z
  .object({
    name: safeName.optional(),
    workspaceId: id.nullable().optional()
  })
  .strict();

/* Creator analytics */

const isoDate = z.string().trim().datetime({ offset: true });

export const analyticsQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    publicationRevision: z.coerce.number().int().positive().max(2_147_483_647).optional(),
    interval: z.enum(['hour', 'day']).optional()
  })
  .strict();

/* Workspaces, membership and project access */

const assignableRole = z.enum(ACCESS_ROLES).exclude(['owner']);

export const createWorkspaceSchema = z
  .object({
    name: safeName,
    slug: z.string().trim().min(3).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  })
  .strict();

export const inviteMemberSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    role: assignableRole
  })
  .strict();

export const changeMemberRoleSchema = z.object({ role: assignableRole }).strict();

export const grantProjectAccessSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    role: assignableRole
  })
  .strict();

export const auditLogQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(500).optional() })
  .strict();

/* Share links */

export const createShareTokenSchema = z
  .object({
    label: z.string().trim().max(120).optional(),
    expiresInHours: z.number().int().min(1).max(24 * 365).optional(),
    publicationRevision: databaseRevision.optional()
  })
  .strict();

/* Extension registry */

const extensionFieldSchema = z
  .object({
    type: z.enum([
      'string',
      'richText',
      'number',
      'integer',
      'boolean',
      'assetId',
      'sceneId',
      'url',
      'color',
      'enum',
      'stringArray'
    ]),
    required: z.boolean().optional(),
    maxLength: z.number().int().min(1).max(20_000).optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    values: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
    maxItems: z.number().int().min(1).max(500).optional(),
    description: z.string().trim().max(500).optional()
  })
  .strict();

export const registerExtensionSchema = z
  .object({
    extensionId: z.string().trim().min(1).max(128).regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/i),
    version: z.string().trim().min(1).max(32).regex(/^\d+\.\d+\.\d+$/),
    name: safeName,
    description: z.string().trim().max(2_000).optional(),
    supportedExperienceTypes: z.array(z.enum(['image360', 'video360'])).min(1).max(2),
    schema: z
      .object({
        fields: z.record(z.string().trim().min(1).max(64), extensionFieldSchema),
        additionalFields: z.literal(false).optional()
      })
      .strict(),
    requiredCapabilities: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
    // Allow-listed client entry point; a publication pins the version it used.
    runtimeModule: z.string().trim().min(1).max(200).regex(/^[a-z0-9@/._-]+$/i),
    securityPolicy: z
      .object({
        allowedUrlHosts: z.array(z.string().trim().min(1).max(255)).max(50).optional(),
        allowRichText: z.boolean().optional(),
        maxPayloadBytes: z.number().int().min(64).max(1_048_576).optional()
      })
      .strict()
      .optional(),
    status: z.enum(EXTENSION_STATUSES).optional()
  })
  .strict();

export const extensionStatusSchema = z.object({ status: z.enum(EXTENSION_STATUSES) }).strict();

/* Custom domains */

export const registerCustomDomainSchema = z
  .object({ hostname: z.string().trim().min(4).max(253) })
  .strict();

export const customDomainStatusSchema = z
  .object({ status: z.enum(CUSTOM_DOMAIN_STATUSES) })
  .strict();

/* Viewer integration rollout */

const viewerIntegrationVersion = z.string().trim().min(1).max(64);

export const viewerIntegrationCheckSchema = z
  .object({ viewerIntegrationVersion })
  .strict();

export const viewerIntegrationRolloutSchema = z
  .object({
    candidateVersion: viewerIntegrationVersion.nullable(),
    rolloutPercent: z.number().int().min(0).max(100).default(0)
  })
  .strict();

export const viewerIntegrationPromotionSchema = z
  .object({ viewerIntegrationVersion })
  .strict();

export const viewerIntegrationCheckQuerySchema = z
  .object({ viewerIntegrationVersion: viewerIntegrationVersion.optional() })
  .strict();

/** Paged access to a large tour's compiled scene index. */
export const sceneIndexQuerySchema = z
  .object({
    offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
    limit: z.coerce.number().int().min(1).max(250).optional()
  })
  .strict();

export const publishedSceneIndexParams = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),
  publicationRevision: publicationRevisionParam
});
