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

