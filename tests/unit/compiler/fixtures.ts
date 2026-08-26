import type {
  AssetDerivative,
  CanonicalAsset,
  CanonicalProject,
} from '../../../src/domain/types';

export function derivative(
  assetId: string,
  kind: AssetDerivative['kind'],
  version = 1,
  overrides: Partial<AssetDerivative> = {},
): AssetDerivative {
  return {
    id: `${assetId}-${kind}-${version}`,
    assetId,
    kind,
    version,
    storageKey: `private/${assetId}/${kind}/v${version}.jpg`,
    mimeType: 'image/jpeg',
    width: kind === 'lowResolutionBase' ? 1024 : 4096,
    height: kind === 'lowResolutionBase' ? 512 : 2048,
    sizeBytes: 1000 * version,
    metadata: {},
    ...overrides,
  };
}

export function panoramaAsset(overrides: Partial<CanonicalAsset> = {}): CanonicalAsset {
  const id = overrides.id ?? 'asset-panorama';
  return {
    id,
    ownerId: 'owner-1',
    projectId: 'project-1',
    mediaType: 'panorama_image',
    projection: 'equirectangular',
    processingStatus: 'ready',
    metadata: {},
    derivatives: [
      derivative(id, 'thumbnail'),
      derivative(id, 'lowResolutionBase'),
      derivative(id, 'standardWeb'),
    ],
    ...overrides,
  };
}

export function canonicalProject(overrides: Partial<CanonicalProject> = {}): CanonicalProject {
  return {
    id: 'project-1',
    ownerId: 'owner-1',
    type: 'image360',
    name: 'Museum Tour',
    schemaVersion: 1,
    revision: 7,
    settings: {
      appearance: { theme: 'dark', primaryColor: '#112233' },
      navigation: { zoom: true, fullscreen: true },
      information: { bodyHtml: '<p>Welcome <script>bad()</script></p>' },
    },
    branding: {
      companyName: 'Museum',
      welcomeMessage: '<strong>Welcome</strong><img src=x onerror=bad()>',
    },
    scenes: [{
      id: 'scene-1',
      projectId: 'project-1',
      name: 'Lobby',
      panoramaAssetId: 'asset-panorama',
      sortOrder: 0,
      isPrimary: true,
      initialView: {
        headingDegrees: 90,
        pitchDegrees: -15,
        horizontalFovDegrees: 80,
      },
      viewLimits: {},
      overlays: [],
      connections: [],
      spatialData: {},
      runtimeHints: {},
      hotspots: [{
        id: 'hotspot-1',
        sceneId: 'scene-1',
        geometry: { kind: 'point' },
        position: {
          coordinateSystem: 'spherical_degrees',
          longitudeDegrees: 45,
          latitudeDegrees: 10,
        },
        appearance: { label: 'Details', color: '#445566' },
        content: {
          title: 'About',
          bodyHtml: '<p>Safe<script>bad()</script></p>',
        },
        action: { kind: 'showInformation' },
        visibilityRules: { enabled: true },
      }],
    }],
    publication: { slug: 'museum-tour', visibility: 'public' },
    ...overrides,
  };
}


/**
 * A tile manifest derivative whose metadata satisfies the compiler's tiled
 * panorama contract, so a test can exercise tiled delivery end to end.
 */
export function tiledLevelsDerivative(
  assetId: string,
  version = 1,
): AssetDerivative {
  const tileSize = 512;
  const levels = [
    { level: 0, width: 1024, height: 512, columns: 2, rows: 1, tileCount: 2 },
    { level: 1, width: 2048, height: 1024, columns: 4, rows: 2, tileCount: 8 },
  ];
  const tiles = levels.flatMap((level) => (
    Array.from({ length: level.columns * level.rows }, (_, index) => {
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
        storageKey: `private/${assetId}/tiles/v${version}/${level.level}-${x}-${y}.jpg`,
        mimeType: 'image/jpeg',
        sizeBytes: 4096,
        checksumSha256: 'a'.repeat(64),
      };
    })
  ));

  return derivative(assetId, 'tiledLevels', version, {
    mimeType: 'application/json',
    storageKey: `private/${assetId}/tiles/v${version}/manifest.json`,
    metadata: {
      strategy: 'tiled-equirectangular',
      tileSize,
      levels,
      tiles,
      tileCount: tiles.length,
    },
  });
}

/** A panorama whose catalog also contains ready tiled levels. */
export function tiledPanoramaAsset(overrides: Partial<CanonicalAsset> = {}): CanonicalAsset {
  const asset = panoramaAsset(overrides);
  return {
    ...asset,
    derivatives: [...asset.derivatives, tiledLevelsDerivative(asset.id)],
  };
}

/** A multi-scene tour where every scene reuses one logical panorama asset. */
export function tourProject(
  sceneCount: number,
  overrides: Partial<CanonicalProject> = {},
): CanonicalProject {
  const base = canonicalProject();
  const sceneIds = Array.from({ length: sceneCount }, (_, index) => `scene-${index + 1}`);
  const scenes = sceneIds.map((id, index) => ({
    id,
    projectId: base.id,
    name: `Room ${index + 1}`,
    panoramaAssetId: 'asset-panorama',
    sortOrder: index,
    isPrimary: index === 0,
    initialView: { headingDegrees: 0, pitchDegrees: 0, horizontalFovDegrees: 90 },
    viewLimits: {},
    hotspots: [],
    overlays: [],
    // Each scene links to the next, so the graph stays sparse and traversable.
    connections: index + 1 < sceneCount
      ? [{
        id: `connection-${index + 1}`,
        sourceSceneId: id,
        targetSceneId: sceneIds[index + 1]!,
        importance: 80,
      }]
      : [],
    spatialData: {},
    runtimeHints: {},
  }));

  return { ...base, scenes, ...overrides };
}
