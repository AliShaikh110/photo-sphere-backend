import type { CanonicalAsset, CanonicalProject } from '../domain/types';
import type { CompileTarget, PublicationVisibility } from '../compiler/types';
import {
  referenceCroppedPanoramaAsset,
  referenceHighResolutionPanoramaAsset,
  referenceImageAsset,
  referencePanoramaAsset,
  referencePlan,
  referencePlanAsset,
  referenceProject,
  referenceScene,
  referenceVideoAsset
} from './reference-fixtures';

export interface ReferenceExperience {
  readonly id: string;
  readonly title: string;
  /** What a renderer/integration regression in this area would break. */
  readonly covers: string;
  readonly target: CompileTarget;
  readonly visibility: PublicationVisibility;
  readonly project: CanonicalProject;
  readonly assets: readonly CanonicalAsset[];
  /** Product-level expectations checked against the compiled manifest. */
  readonly expectations: readonly ReferenceExpectation[];
}

export interface ReferenceExpectation {
  readonly id: string;
  readonly description: string;
  check(manifest: Record<string, unknown>): boolean;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function capabilityIds(manifest: Record<string, unknown>): string[] {
  return list(manifest.capabilities)
    .map((entry) => record(entry)?.id)
    .filter((id): id is string => typeof id === 'string');
}

function scenes(manifest: Record<string, unknown>): Record<string, unknown>[] {
  return list(manifest.scenes)
    .map(record)
    .filter((scene): scene is Record<string, unknown> => scene !== undefined);
}

function expectation(
  id: string,
  description: string,
  check: (manifest: Record<string, unknown>) => boolean
): ReferenceExpectation {
  return { id, description, check };
}

const hasViewerIntegration = expectation(
  'viewer-integration-emitted',
  'The manifest carries renderer configuration produced by the integration adapter.',
  (manifest) => {
    const integration = record(manifest.viewerIntegration);
    return (
      integration !== undefined
      && typeof integration.rendererId === 'string'
      && record(integration.config) !== undefined
    );
  }
);

function basicPanorama(): ReferenceExperience {
  const asset = referencePanoramaAsset('11111111-0000-4000-8000-000000000001');
  const project = referenceProject('11111111-1111-4000-8000-000000000001', {
    name: 'Basic panorama',
    scenes: [
      referenceScene('11111111-1111-4000-8000-000000000001', {
        id: '11111111-2222-4000-8000-000000000001',
        name: 'Lobby',
        panoramaAssetId: asset.id,
        isPrimary: true
      })
    ]
  });
  return {
    id: 'basic-panorama',
    title: 'Basic panorama',
    covers: 'Single-scene equirectangular delivery and the standard web derivative.',
    target: 'publication',
    visibility: 'public',
    project,
    assets: [asset],
    expectations: [
      hasViewerIntegration,
      expectation('single-scene', 'One scene compiles with panorama media.', (manifest) => {
        const scene = scenes(manifest)[0];
        const panorama = record(scene?.panorama);
        return scene !== undefined && record(panorama?.primary) !== undefined;
      }),
      expectation('standard-family', 'The quality policy selects the standard family.', (manifest) => {
        const panorama = record(scenes(manifest)[0]?.panorama);
        return panorama?.family === 'standardEquirectangular';
      })
    ]
  };
}

function croppedPanorama(): ReferenceExperience {
  const asset = referenceCroppedPanoramaAsset('11111111-0000-4000-8000-000000000002');
  const project = referenceProject('11111111-1111-4000-8000-000000000002', {
    name: 'Cropped panorama',
    scenes: [
      referenceScene('11111111-1111-4000-8000-000000000002', {
        id: '11111111-2222-4000-8000-000000000002',
        name: 'Balcony',
        panoramaAssetId: asset.id,
        isPrimary: true
      })
    ]
  });
  return {
    id: 'cropped-panorama',
    title: 'Cropped panorama',
    covers: 'GPano crop geometry survives compilation without exposing raw coordinates to authoring.',
    target: 'publication',
    visibility: 'public',
    project,
    assets: [asset],
    expectations: [
      hasViewerIntegration,
      expectation('crop-present', 'Crop geometry reaches the player.', (manifest) => {
        const panorama = record(scenes(manifest)[0]?.panorama);
        const crop = record(panorama?.crop);
        return panorama?.projection === 'cropped_equirectangular' && crop !== undefined;
      })
    ]
  };
}

function highResolutionPanorama(): ReferenceExperience {
  const asset = referenceHighResolutionPanoramaAsset('11111111-0000-4000-8000-000000000003');
  const project = referenceProject('11111111-1111-4000-8000-000000000003', {
    name: 'High-resolution panorama',
    settings: { quality: { preference: 'high' } },
    scenes: [
      referenceScene('11111111-1111-4000-8000-000000000003', {
        id: '11111111-2222-4000-8000-000000000003',
        name: 'Atrium',
        panoramaAssetId: asset.id,
        isPrimary: true
      })
    ]
  });
  return {
    id: 'high-resolution-panorama',
    title: 'High-resolution panorama',
    covers: 'Tiled delivery, the low-resolution base, and tile URL templating.',
    target: 'publication',
    visibility: 'public',
    project,
    assets: [asset],
    expectations: [
      hasViewerIntegration,
      expectation('tiled-family', 'The tiled family is selected.', (manifest) => {
        const panorama = record(scenes(manifest)[0]?.panorama);
        return panorama?.family === 'tiledEquirectangular';
      }),
      expectation('tile-template', 'A tile URL template is emitted.', (manifest) => {
        const tiles = record(record(scenes(manifest)[0]?.panorama)?.tiles);
        return typeof tiles?.tileUrlTemplate === 'string'
          && tiles.tileUrlTemplate.includes('{level}');
      }),
      expectation('base-first', 'A low-resolution base precedes full detail.', (manifest) => {
        const panorama = record(scenes(manifest)[0]?.panorama);
        return record(panorama?.base)?.kind === 'lowResolutionBase';
      })
    ]
  };
}

function multiSceneTour(sceneCount: number, id: string, title: string): ReferenceExperience {
  const projectId = `11111111-1111-4000-8000-${String(sceneCount).padStart(12, '0')}`;
  const asset = referencePanoramaAsset(`11111111-0000-4000-8000-${String(sceneCount).padStart(12, '0')}`);
  const sceneIds = Array.from(
    { length: sceneCount },
    (_unused, index) => `11111111-2222-4000-9000-${String(index).padStart(12, '0')}`
  );
  const projectScenes = sceneIds.map((sceneId, index) =>
    referenceScene(projectId, {
      id: sceneId,
      name: `Room ${index + 1}`,
      panoramaAssetId: asset.id,
      sortOrder: index,
      isPrimary: index === 0,
      connections:
        index + 1 < sceneCount
          ? [
            {
              id: `11111111-3333-4000-9000-${String(index).padStart(12, '0')}`,
              sourceSceneId: sceneId,
              targetSceneId: sceneIds[index + 1]!,
              importance: 80,
              preloadHint: 'high' as const
            }
          ]
          : []
    })
  );
  return {
    id,
    title,
    covers:
      sceneCount > 32
        ? 'Progressive delivery: a lightweight scene index plus per-scene definitions.'
        : 'Embedded multi-scene delivery and adjacent-scene preloading.',
    target: 'publication',
    visibility: 'public',
    project: referenceProject(projectId, { name: title, scenes: projectScenes }),
    assets: [asset],
    expectations: [
      hasViewerIntegration,
      expectation('scene-index-complete', 'The scene index lists every scene.', (manifest) => {
        const tour = record(manifest.tour);
        return list(tour?.sceneIndex).length === sceneCount;
      }),
      expectation(
        'strategy-matches-size',
        'Delivery strategy matches the tour size policy.',
        (manifest) => {
          const tour = record(manifest.tour);
          return sceneCount > 32 ? tour?.strategy === 'progressive' : tour?.strategy === 'embedded';
        }
      ),
      expectation('preload-bounded', 'Preloading never names the whole tour.', (manifest) =>
        scenes(manifest).every((scene) => list(scene.preloadSceneIds).length <= 2))
    ]
  };
}

function galleryExperience(): ReferenceExperience {
  const projectId = '11111111-1111-4000-8000-000000000006';
  const asset = referencePanoramaAsset('11111111-0000-4000-8000-000000000006');
  const sceneIds = ['a', 'b', 'c'].map(
    (suffix, index) => `11111111-2222-4000-8000-00000000000${index}${suffix.charCodeAt(0) % 10}`
  );
  return {
    id: 'gallery',
    title: 'Gallery',
    covers: 'Gallery navigation coexisting with the resolution/quality policy.',
    target: 'publication',
    visibility: 'public',
    project: referenceProject(projectId, {
      name: 'Gallery',
      settings: { gallery: { enabled: true, showThumbnails: true }, quality: { preference: 'high' } },
      scenes: sceneIds.map((sceneId, index) =>
        referenceScene(projectId, {
          id: sceneId,
          name: `Gallery scene ${index + 1}`,
          panoramaAssetId: asset.id,
          sortOrder: index,
          isPrimary: index === 0
        })
      )
    }),
    assets: [asset],
    expectations: [
      hasViewerIntegration,
      expectation('gallery-enabled', 'The gallery capability resolves.', (manifest) =>
        capabilityIds(manifest).includes('gallery')),
      expectation(
        'gallery-thumbnails',
        'Each index entry carries a lightweight thumbnail.',
        (manifest) =>
          list(record(manifest.tour)?.sceneIndex).every(
            (entry) => record(record(entry)?.thumbnail) !== undefined
          )
      )
    ]
  };
}

function hotspotsExperience(): ReferenceExperience {
  const projectId = '11111111-1111-4000-8000-000000000007';
  const panorama = referencePanoramaAsset('11111111-0000-4000-8000-000000000007');
  const image = referenceImageAsset('11111111-0000-4000-8000-000000000017');
  const sceneId = '11111111-2222-4000-8000-000000000007';
  return {
    id: 'hotspots',
    title: 'Hotspots and rich content',
    covers: 'Point hotspots, sanitized rich content, asset actions and external links.',
    target: 'publication',
    visibility: 'public',
    project: referenceProject(projectId, {
      name: 'Hotspots',
      scenes: [
        referenceScene(projectId, {
          id: sceneId,
          name: 'Hall',
          panoramaAssetId: panorama.id,
          isPrimary: true,
          hotspots: [
            {
              id: '11111111-4444-4000-8000-000000000001',
              sceneId,
              geometry: { kind: 'point' },
              position: {
                coordinateSystem: 'spherical_degrees',
                longitudeDegrees: 30,
                latitudeDegrees: 5
              },
              appearance: { label: 'About', emphasis: 'prominent' },
              content: {
                title: 'About this hall',
                bodyHtml: '<p>Built in 1904.<script>steal()</script></p>'
              },
              action: { kind: 'showInformation' },
              visibilityRules: { enabled: true }
            },
            {
              id: '11111111-4444-4000-8000-000000000002',
              sceneId,
              geometry: { kind: 'point' },
              position: {
                coordinateSystem: 'spherical_degrees',
                longitudeDegrees: -40,
                latitudeDegrees: -10
              },
              content: { tooltip: 'Photograph' },
              action: { kind: 'openAsset', assetId: image.id },
              visibilityRules: { enabled: true }
            }
          ]
        })
      ]
    }),
    assets: [panorama, image],
    expectations: [
      hasViewerIntegration,
      expectation('hotspots-compiled', 'Both hotspots compile.', (manifest) =>
        list(scenes(manifest)[0]?.hotspots).length === 2),
      expectation('rich-content-sanitized', 'Authored HTML is sanitized.', (manifest) => {
        const hotspot = record(list(scenes(manifest)[0]?.hotspots)[0]);
        const body = record(hotspot?.content)?.bodyHtml;
        return typeof body === 'string' && !body.toLowerCase().includes('<script');
      }),
      expectation('asset-action-resolved', 'An asset action resolves to a media reference.', (manifest) => {
        const hotspot = record(list(scenes(manifest)[0]?.hotspots)[1]);
        const action = record(hotspot?.action);
        return action?.kind === 'openAsset' && record(action.media) !== undefined;
      })
    ]
  };
}

function mapAndPlanExperience(): ReferenceExperience {
  const projectId = '11111111-1111-4000-8000-000000000008';
  const panorama = referencePanoramaAsset('11111111-0000-4000-8000-000000000008');
  const planAsset = referencePlanAsset('11111111-0000-4000-8000-000000000018');
  const planId = '11111111-5555-4000-8000-000000000001';
  const sceneIds = [
    '11111111-2222-4000-8000-000000000081',
    '11111111-2222-4000-8000-000000000082'
  ];
  return {
    id: 'map-and-plan',
    title: 'Map and floor plan',
    covers: 'World coordinates, plan placement, the spatial index and plan media resolution.',
    target: 'publication',
    visibility: 'public',
    project: referenceProject(projectId, {
      name: 'Map and plan',
      settings: {
        map: { enabled: true, showSceneMarkers: true },
        plan: { enabled: true, defaultPlanId: planId }
      },
      plans: [referencePlan(projectId, planId, planAsset.id)],
      scenes: [
        referenceScene(projectId, {
          id: sceneIds[0]!,
          name: 'Entrance',
          panoramaAssetId: panorama.id,
          isPrimary: true,
          sortOrder: 0,
          // World coordinates and plan placement coexist; the coordinate system
          // names the plan family, because that is the one with two readings.
          spatialData: {
            coordinateSystem: 'plan_normalized',
            latitude: 48.8584,
            longitude: 2.2945,
            headingDegrees: 15,
            planId,
            mapX: 0.2,
            mapY: 0.35
          }
        }),
        referenceScene(projectId, {
          id: sceneIds[1]!,
          name: 'Courtyard',
          panoramaAssetId: panorama.id,
          sortOrder: 1,
          spatialData: {
            coordinateSystem: 'plan_normalized',
            latitude: 48.8586,
            longitude: 2.2949,
            planId,
            mapX: 0.6,
            mapY: 0.5
          }
        })
      ]
    }),
    assets: [panorama, planAsset],
    expectations: [
      hasViewerIntegration,
      expectation('map-and-plan-capabilities', 'Both spatial capabilities resolve.', (manifest) => {
        const ids = capabilityIds(manifest);
        return ids.includes('map') && ids.includes('plan');
      }),
      expectation('spatial-index', 'The spatial index covers both scenes.', (manifest) => {
        const index = record(manifest.spatialIndex);
        return index?.hasWorldCoordinates === true && list(index.entries).length === 2;
      }),
      expectation('plan-image-resolved', 'The plan image resolves to delivery media.', (manifest) => {
        const plan = record(list(manifest.plans)[0]);
        return record(plan?.image) !== undefined && list(plan?.sceneIds).length === 2;
      })
    ]
  };
}

function immersiveFallbackExperience(): ReferenceExperience {
  const projectId = '11111111-1111-4000-8000-000000000009';
  const panorama = referencePanoramaAsset('11111111-0000-4000-8000-000000000009');
  return {
    id: 'gyroscope-stereo-fallback',
    title: 'Gyroscope and stereo fallback',
    covers: 'Motion and stereo requests publish with runtime device requirements and a 360 fallback.',
    target: 'publication',
    visibility: 'public',
    project: referenceProject(projectId, {
      name: 'Immersive fallback',
      settings: {
        motionNavigation: { enabled: true, requestPermissionOnStart: true },
        immersiveViewing: { stereoEnabled: true, immersiveEnabled: true }
      },
      scenes: [
        referenceScene(projectId, {
          id: '11111111-2222-4000-8000-000000000091',
          name: 'Overlook',
          panoramaAssetId: panorama.id,
          isPrimary: true
        })
      ]
    }),
    assets: [panorama],
    expectations: [
      hasViewerIntegration,
      expectation('immersive-declared', 'Motion and stereo capabilities are declared.', (manifest) => {
        const ids = capabilityIds(manifest);
        return ids.includes('gyroscope') && ids.includes('stereo');
      }),
      expectation('device-decided-at-runtime', 'Device support is deferred to the player.', (manifest) => {
        const runtime = record(manifest.runtime);
        const deferred = list(runtime?.deferredDeviceCapabilities)
          .map((entry) => record(entry)?.capabilityId);
        return deferred.includes('gyroscope') && deferred.includes('stereo');
      }),
      expectation('normal-360-fallback', 'The fallback policy keeps normal 360 available.', (manifest) => {
        const policy = record(record(manifest.runtime)?.fallbackPolicy);
        return policy?.optionalCapabilities === 'continue-without-capability';
      })
    ]
  };
}

function advancedOverlayExperience(): ReferenceExperience {
  const projectId = '11111111-1111-4000-8000-00000000000a';
  const panorama = referencePanoramaAsset('11111111-0000-4000-8000-00000000000a');
  const sceneId = '11111111-2222-4000-8000-0000000000a1';
  const vertex = (longitudeDegrees: number, latitudeDegrees: number) => ({
    coordinateSystem: 'spherical_degrees' as const,
    longitudeDegrees,
    latitudeDegrees
  });
  return {
    id: 'advanced-overlay',
    title: 'Polygon and polyline overlays',
    covers: 'Area and route geometry compile without renderer-specific persistence.',
    target: 'publication',
    visibility: 'public',
    project: referenceProject(projectId, {
      name: 'Advanced overlay',
      scenes: [
        referenceScene(projectId, {
          id: sceneId,
          name: 'Workshop',
          panoramaAssetId: panorama.id,
          isPrimary: true,
          overlays: [
            {
              id: '11111111-6666-4000-8000-000000000001',
              sceneId,
              name: 'Restricted floor',
              geometry: {
                kind: 'polygon',
                vertices: [vertex(10, 0), vertex(30, 0), vertex(30, -20), vertex(10, -20)]
              },
              appearance: { label: 'Restricted', fillOpacity: 0.3 },
              action: { kind: 'showInformation' },
              content: { title: 'Restricted floor', description: 'Authorized staff only.' },
              visibilityRules: { enabled: true },
              sortOrder: 0
            },
            {
              id: '11111111-6666-4000-8000-000000000002',
              sceneId,
              name: 'Evacuation route',
              geometry: {
                kind: 'polyline',
                vertices: [vertex(-10, -5), vertex(-40, -5), vertex(-70, -12)]
              },
              appearance: { label: 'Route', strokeWidth: 4 },
              action: { kind: 'none' },
              visibilityRules: { enabled: true },
              sortOrder: 1
            }
          ]
        })
      ]
    }),
    assets: [panorama],
    expectations: [
      hasViewerIntegration,
      expectation('overlay-geometry', 'Both overlay geometries compile.', (manifest) => {
        const overlays = list(scenes(manifest)[0]?.overlays).map(record);
        const kinds = overlays.map((overlay) => record(overlay?.geometry)?.kind);
        return kinds.includes('polygon') && kinds.includes('polyline');
      }),
      expectation('advanced-capabilities', 'Advanced geometry capabilities resolve.', (manifest) => {
        const ids = capabilityIds(manifest);
        return ids.includes('advancedOverlay') && ids.includes('advancedGeometry');
      })
    ]
  };
}

function mediaLayerExperience(): ReferenceExperience {
  const projectId = '11111111-1111-4000-8000-00000000000b';
  const panorama = referencePanoramaAsset('11111111-0000-4000-8000-00000000000b');
  const image = referenceImageAsset('11111111-0000-4000-8000-00000000001b');
  const sceneId = '11111111-2222-4000-8000-0000000000b1';
  return {
    id: 'media-layer',
    title: 'Image and video layers',
    covers: 'Layer geometry resolves its media reference and angular anchor.',
    target: 'publication',
    visibility: 'public',
    project: referenceProject(projectId, {
      name: 'Media layer',
      scenes: [
        referenceScene(projectId, {
          id: sceneId,
          name: 'Showroom',
          panoramaAssetId: panorama.id,
          isPrimary: true,
          overlays: [
            {
              id: '11111111-6666-4000-8000-000000000011',
              sceneId,
              name: 'Signage',
              geometry: {
                kind: 'imageLayer',
                assetId: image.id,
                anchor: { widthDegrees: 40, heightDegrees: 22, rotationDegrees: 0, opacity: 0.95 }
              },
              position: {
                coordinateSystem: 'spherical_degrees',
                longitudeDegrees: 120,
                latitudeDegrees: 0
              },
              action: { kind: 'none' },
              visibilityRules: { enabled: true },
              sortOrder: 0
            }
          ]
        })
      ]
    }),
    assets: [panorama, image],
    expectations: [
      hasViewerIntegration,
      expectation('layer-media-resolved', 'The layer resolves delivery media.', (manifest) => {
        const overlay = record(list(scenes(manifest)[0]?.overlays)[0]);
        const geometry = record(overlay?.geometry);
        return geometry?.kind === 'imageLayer' && record(geometry.media) !== undefined;
      }),
      expectation('anchor-is-angular', 'Placement stays angular, not renderer mesh data.', (manifest) => {
        const geometry = record(record(list(scenes(manifest)[0]?.overlays)[0])?.geometry);
        const anchor = record(geometry?.anchor);
        return typeof anchor?.widthDegrees === 'number' && typeof anchor.heightDegrees === 'number';
      })
    ]
  };
}

function videoExperience(): ReferenceExperience {
  const projectId = '11111111-1111-4000-8000-00000000000c';
  const video = referenceVideoAsset('11111111-0000-4000-8000-00000000000c');
  return {
    id: 'video-360',
    title: '360 video with timed interactions',
    covers: 'Video profiles, poster, handheld safety ordering and timeline compilation.',
    target: 'publication',
    visibility: 'public',
    project: referenceProject(projectId, {
      type: 'video360',
      name: '360 video',
      videoAssetId: video.id,
      settings: { video: { autoplay: false, showControls: true, showTimeline: true } },
      timeline: [
        {
          id: '11111111-7777-4000-8000-000000000001',
          projectId,
          kind: 'information',
          timeMs: 12_000,
          endTimeMs: 18_000,
          content: { title: 'Engine room', description: 'Take a closer look.' },
          action: { kind: 'showInformation' },
          visibilityRules: { enabled: true },
          sortOrder: 0
        },
        {
          id: '11111111-7777-4000-8000-000000000002',
          projectId,
          kind: 'viewpoint',
          timeMs: 30_000,
          endTimeMs: null,
          viewpoint: {
            headingDegrees: 120,
            pitchDegrees: -5,
            transition: 'smooth',
            transitionMs: 800
          },
          action: { kind: 'setViewpoint' },
          visibilityRules: { enabled: true },
          sortOrder: 0
        }
      ]
    }),
    assets: [video],
    expectations: [
      hasViewerIntegration,
      expectation('video-profiles', 'Both playback profiles publish.', (manifest) =>
        list(record(manifest.video)?.profiles).length === 2),
      expectation('handheld-first', 'A handheld-safe profile leads the candidate order.', (manifest) => {
        const first = record(list(record(manifest.video)?.profiles)[0]);
        return record(first?.constraints)?.handheldSafe === true;
      }),
      expectation('poster-present', 'A poster is available before playback.', (manifest) =>
        record(record(manifest.video)?.poster) !== undefined),
      expectation('timeline-compiled', 'Both timed interactions compile in time order.', (manifest) => {
        const timeline = list(manifest.timeline).map(record);
        return (
          timeline.length === 2
          && Number(timeline[0]?.timeMs) === 12_000
          && Number(timeline[1]?.timeMs) === 30_000
        );
      })
    ]
  };
}

function privateEmbedExperience(): ReferenceExperience {
  const projectId = '11111111-1111-4000-8000-00000000000d';
  const panorama = referencePanoramaAsset('11111111-0000-4000-8000-00000000000d');
  return {
    id: 'private-embed',
    title: 'Private experience',
    covers: 'A private publication keeps every media reference behind protected access.',
    target: 'publication',
    visibility: 'private',
    project: referenceProject(projectId, {
      name: 'Private experience',
      publication: { slug: 'reference-private', visibility: 'private' },
      scenes: [
        referenceScene(projectId, {
          id: '11111111-2222-4000-8000-0000000000d1',
          name: 'Boardroom',
          panoramaAssetId: panorama.id,
          isPrimary: true
        })
      ]
    }),
    assets: [panorama],
    expectations: [
      hasViewerIntegration,
      expectation('visibility-private', 'The manifest is marked private.', (manifest) =>
        manifest.visibility === 'private'),
      expectation('media-protected', 'No media reference is publicly addressable.', (manifest) => {
        const found: string[] = [];
        const visit = (value: unknown): void => {
          if (Array.isArray(value)) {
            value.forEach(visit);
            return;
          }
          const object = record(value);
          if (object === undefined) return;
          if (typeof object.derivativeId === 'string' && typeof object.access === 'string') {
            found.push(object.access);
          }
          Object.values(object).forEach(visit);
        };
        visit(manifest);
        return found.length > 0 && found.every((access) => access === 'protected');
      })
    ]
  };
}

/**
 * The suite a viewer integration version must pass before it can be promoted.
 * Every family named by the architecture's reference test list is present.
 */
export function referenceExperiences(): readonly ReferenceExperience[] {
  return [
    basicPanorama(),
    croppedPanorama(),
    highResolutionPanorama(),
    multiSceneTour(4, 'multi-scene-tour', 'Multi-scene tour'),
    multiSceneTour(120, 'large-tour', 'Large tour'),
    galleryExperience(),
    hotspotsExperience(),
    mapAndPlanExperience(),
    immersiveFallbackExperience(),
    advancedOverlayExperience(),
    mediaLayerExperience(),
    videoExperience(),
    privateEmbedExperience()
  ];
}
