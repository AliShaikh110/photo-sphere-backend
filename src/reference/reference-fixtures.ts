import { createHash } from 'node:crypto';

import type {
  AssetDerivative,
  CanonicalAsset,
  CanonicalPlan,
  CanonicalProject,
  CanonicalScene,
  JsonObject
} from '../domain/types';

/**
 * Canonical fixtures for the reference experience suite.
 *
 * They are ordinary product data — no renderer configuration appears anywhere —
 * so a renderer or integration upgrade is exercised through exactly the path a
 * customer project takes.
 */

const OWNER_ID = '00000000-0000-4000-8000-000000000001';

function checksum(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

export function referenceDerivative(
  assetId: string,
  kind: AssetDerivative['kind'],
  overrides: Partial<AssetDerivative> = {}
): AssetDerivative {
  const width = kind === 'lowResolutionBase' ? 1_024 : 4_096;
  return {
    id: `${assetId}-${kind}`,
    assetId,
    kind,
    version: 1,
    storageKey: `reference/${assetId}/${kind}.jpg`,
    mimeType: 'image/jpeg',
    width,
    height: width / 2,
    sizeBytes: 512_000,
    readiness: 'ready',
    metadata: { checksumSha256: checksum(`${assetId}:${kind}`) },
    ...overrides
  };
}

/** A tiled derivative whose metadata satisfies the compiler's integrity rules. */
export function referenceTiledDerivative(assetId: string): AssetDerivative {
  const tileSize = 512;
  const levels = [
    { level: 0, width: 2_048, height: 1_024, columns: 4, rows: 2 },
    { level: 1, width: 4_096, height: 2_048, columns: 8, rows: 4 }
  ];
  const tiles = levels.flatMap((level) =>
    Array.from({ length: level.columns * level.rows }, (_unused, index) => {
      const x = index % level.columns;
      const y = Math.floor(index / level.columns);
      return {
        level: level.level,
        x,
        y,
        width: Math.min(tileSize, level.width - x * tileSize),
        height: Math.min(tileSize, level.height - y * tileSize),
        levelWidth: level.width,
        levelHeight: level.height,
        storageKey: `reference/${assetId}/tiles/${level.level}/${x}/${y}.jpg`,
        mimeType: 'image/jpeg',
        sizeBytes: 24_000,
        checksumSha256: checksum(`${assetId}:${level.level}:${x}:${y}`)
      };
    })
  );
  return {
    id: `${assetId}-tiledLevels`,
    assetId,
    kind: 'tiledLevels',
    version: 1,
    storageKey: `reference/${assetId}/tiles/manifest.json`,
    mimeType: 'application/json',
    width: 4_096,
    height: 2_048,
    sizeBytes: 4_096,
    readiness: 'ready',
    metadata: {
      tileSize,
      levels: levels.map((level) => ({ ...level, tileCount: level.columns * level.rows })),
      tileCount: tiles.length,
      tiles
    } as unknown as JsonObject
  };
}

export function referencePanoramaAsset(
  id: string,
  overrides: Partial<CanonicalAsset> = {}
): CanonicalAsset {
  return {
    id,
    ownerId: OWNER_ID,
    projectId: null,
    mediaType: 'panorama_image',
    projection: 'equirectangular',
    processingStatus: 'ready',
    metadata: { width: 4_096, height: 2_048, is360: true, isFullSphere: true },
    derivatives: [
      referenceDerivative(id, 'thumbnail'),
      referenceDerivative(id, 'lowResolutionBase'),
      referenceDerivative(id, 'standardWeb')
    ],
    ...overrides
  };
}

export function referenceCroppedPanoramaAsset(id: string): CanonicalAsset {
  return referencePanoramaAsset(id, {
    projection: 'cropped_equirectangular',
    metadata: {
      width: 4_096,
      height: 1_024,
      is360: true,
      isFullSphere: false,
      xmp: {
        fullPanoWidthPixels: 4_096,
        fullPanoHeightPixels: 2_048,
        croppedAreaImageWidthPixels: 4_096,
        croppedAreaImageHeightPixels: 1_024,
        croppedAreaLeftPixels: 0,
        croppedAreaTopPixels: 512
      }
    }
  });
}

export function referenceHighResolutionPanoramaAsset(id: string): CanonicalAsset {
  const asset = referencePanoramaAsset(id);
  return {
    ...asset,
    metadata: { width: 12_288, height: 6_144, is360: true, isFullSphere: true },
    derivatives: [...asset.derivatives, referenceTiledDerivative(id)]
  };
}

export function referenceImageAsset(id: string): CanonicalAsset {
  return {
    id,
    ownerId: OWNER_ID,
    projectId: null,
    mediaType: 'image',
    projection: 'unknown',
    processingStatus: 'ready',
    metadata: { width: 1_600, height: 900 },
    derivatives: [
      referenceDerivative(id, 'thumbnail'),
      referenceDerivative(id, 'standardWeb', { width: 1_600, height: 900 })
    ]
  };
}

export function referencePlanAsset(id: string): CanonicalAsset {
  return {
    id,
    ownerId: OWNER_ID,
    projectId: null,
    mediaType: 'plan_image',
    projection: 'unknown',
    processingStatus: 'ready',
    metadata: { width: 2_000, height: 1_400 },
    derivatives: [
      referenceDerivative(id, 'thumbnail'),
      referenceDerivative(id, 'planImage', {
        mimeType: 'image/webp',
        width: 2_000,
        height: 1_400
      })
    ]
  };
}

export function referenceVideoAsset(id: string): CanonicalAsset {
  const profile = (
    kind: 'desktopVideoProfile' | 'mobileVideoProfile',
    width: number,
    handheldSafe: boolean
  ): AssetDerivative => ({
    id: `${id}-${kind}`,
    assetId: id,
    kind,
    version: 1,
    storageKey: `reference/${id}/${kind}.mp4`,
    mimeType: 'video/mp4',
    width,
    height: width / 2,
    sizeBytes: 24_000_000,
    readiness: 'ready',
    metadata: { handheldSafe, checksumSha256: checksum(`${id}:${kind}`) }
  });
  return {
    id,
    ownerId: OWNER_ID,
    projectId: null,
    mediaType: 'video360',
    projection: 'equirectangular',
    processingStatus: 'ready',
    metadata: {
      width: 7_680,
      height: 3_840,
      durationMs: 154_000,
      frameRate: 30,
      audioPresent: true,
      stereoMode: 'mono',
      is360: true
    },
    derivatives: [
      {
        id: `${id}-videoPoster`,
        assetId: id,
        kind: 'videoPoster',
        version: 1,
        storageKey: `reference/${id}/poster.jpg`,
        mimeType: 'image/jpeg',
        width: 1_920,
        height: 960,
        sizeBytes: 180_000,
        readiness: 'ready',
        metadata: { checksumSha256: checksum(`${id}:poster`) }
      },
      profile('desktopVideoProfile', 7_680, false),
      profile('mobileVideoProfile', 4_096, true)
    ]
  };
}

export function referenceScene(
  projectId: string,
  overrides: Partial<CanonicalScene> & { id: string; name: string; panoramaAssetId: string }
): CanonicalScene {
  return {
    projectId,
    sortOrder: 0,
    isPrimary: false,
    initialView: { headingDegrees: 0, pitchDegrees: 0, horizontalFovDegrees: 70 },
    viewLimits: {},
    hotspots: [],
    overlays: [],
    connections: [],
    spatialData: {},
    runtimeHints: {},
    ...overrides
  };
}

export function referencePlan(
  projectId: string,
  id: string,
  assetId: string | null,
  sortOrder = 0
): CanonicalPlan {
  return {
    id,
    projectId,
    name: 'Ground floor',
    assetId,
    coordinateSystem: 'plan_normalized',
    metadata: {},
    sortOrder
  };
}

export function referenceProject(
  id: string,
  overrides: Partial<CanonicalProject> = {}
): CanonicalProject {
  return {
    id,
    ownerId: OWNER_ID,
    type: 'image360',
    name: 'Reference experience',
    schemaVersion: 1,
    revision: 1,
    settings: {},
    branding: {},
    scenes: [],
    publication: { slug: 'reference-experience', visibility: 'public' },
    ...overrides
  };
}

export const REFERENCE_OWNER_ID = OWNER_ID;
