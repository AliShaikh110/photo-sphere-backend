import { z } from 'zod';

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
    navigationButtons: z.boolean().optional()
  })
  .strict();

export const projectSettingsSchema = z
  .object({
    appearance: appearanceSchema.optional(),
    navigation: navigationSchema.optional(),
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
    type: z.literal('image360').default('image360'),
    name: safeName,
    settings: projectSettingsSchema.optional(),
    branding: brandingSchema.optional()
  })
  .strict();

export const updateProjectSchema = z
  .object({
    revision: databaseRevision,
    name: safeName.optional(),
    settings: projectSettingsSchema.optional(),
    branding: brandingSchema.optional()
  })
  .strict()
  .refine((value) => value.name !== undefined || value.settings !== undefined || value.branding !== undefined, {
    message: 'At least one editable field is required.'
  });

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

export const createSceneSchema = z
  .object({
    projectRevision: databaseRevision,
    name: safeName,
    panoramaAssetId: id.nullable().optional(),
    initialView: initialViewSchema.optional(),
    viewLimits: viewLimitsSchema.optional(),
    overlays: z.array(canonicalJsonRecord).max(100).optional(),
    connections: z.array(canonicalJsonRecord).max(100).optional(),
    spatialData: canonicalJsonRecord.optional(),
    runtimeHints: canonicalJsonRecord.optional()
  })
  .strict();

export const updateSceneSchema = z
  .object({
    projectRevision: databaseRevision,
    name: safeName.optional(),
    panoramaAssetId: id.nullable().optional(),
    initialView: initialViewSchema.optional(),
    viewLimits: viewLimitsSchema.optional(),
    overlays: z.array(canonicalJsonRecord).max(100).optional(),
    connections: z.array(canonicalJsonRecord).max(100).optional(),
    spatialData: canonicalJsonRecord.optional(),
    runtimeHints: canonicalJsonRecord.optional()
  })
  .strict();

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
    imageAssetId: id.optional()
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

export const uploadSessionSchema = z
  .object({
    projectId: id.optional(),
    mediaType: z.enum(['panorama_image', 'image', 'logo']).default('panorama_image'),
    filename: z.string().trim().min(1).max(255),
    mimeType: z.enum(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']),
    sizeBytes: z.number().int().positive(),
    checksumSha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional()
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
  'hotspot_clicked',
  'asset_failed',
  'viewer_error',
  'experience_exited'
]);

export const runtimeEventSchema = z
  .object({
    eventId: id,
    eventName: runtimeEventNameSchema,
    experienceId: id,
    publicationRevision: databaseRevision,
    viewerIntegrationVersion: z.string().trim().min(1).max(64),
    sessionId: z.string().trim().min(8).max(128),
    deviceContext: jsonRecord.default({}),
    payload: jsonRecord.default({}),
    occurredAt: z.iso.datetime({ offset: true })
  })
  .strict();

export const runtimeEventsSchema = z.union([
  runtimeEventSchema.transform((event) => ({ events: [event] })),
  z.object({ events: z.array(runtimeEventSchema).min(1).max(100) }).strict()
]);

export const projectIdParams = z.object({ projectId: id });
export const assetIdParams = z.object({ assetId: id });
export const uploadSessionParams = z.object({ uploadSessionId: id });
export const sceneParams = z.object({ projectId: id, sceneId: id });
export const hotspotParams = z.object({ projectId: id, sceneId: id, hotspotId: id });
export const derivativeParams = z.object({ derivativeId: id });
export const publicationMediaParams = z.object({
  projectId: id,
  publicationRevision: z.string().regex(/^[1-9][0-9]*$/).refine(
    (value) => Number(value) <= 2_147_483_647,
    { message: 'Publication revision exceeds the supported range.' }
  ),
  derivativeId: id
});
export const slugParams = z.object({ slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100) });
