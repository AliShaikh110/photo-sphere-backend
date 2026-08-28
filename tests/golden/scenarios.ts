import type {
  CanonicalAsset,
  CanonicalProject,
  JsonObject
} from '../../src/domain/types';
import type { CompileTarget, PublicationVisibility } from '../../src/compiler/types';
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
} from '../../src/reference/reference-fixtures';

/**
 * The behaviour freeze for the compiler extraction.
 *
 * Each scenario is ordinary canonical product data. The recorded output of
 * compiling it is committed under `expected/`, and the extraction is only
 * correct when every byte of every recorded artifact is reproduced.
 *
 * Scenario ids are stable file names; renaming one loses the freeze.
 */
export interface GoldenScenario {
  readonly id: string;
  readonly description: string;
  readonly target: CompileTarget;
  readonly visibility: PublicationVisibility;
  readonly publicationRevision?: number;
  readonly publicationSlug?: string;
  readonly project: CanonicalProject;
  readonly assets: readonly CanonicalAsset[];
  /** Set when the scenario exists to freeze a rejection, not a manifest. */
  readonly expectRejection?: true;
}

const PUBLICATION = {
  target: 'publication',
  visibility: 'public',
  publicationRevision: 1
} as const;

function position(longitudeDegrees: number, latitudeDegrees: number) {
  return { coordinateSystem: 'spherical_degrees' as const, longitudeDegrees, latitudeDegrees };
}

function singleScene(): GoldenScenario {
  const asset = referencePanoramaAsset('22222222-0000-4000-8000-000000000001');
  const projectId = '22222222-1111-4000-8000-000000000001';
  return {
    id: 'image360-single-scene',
    description: 'image360 single scene, no hotspots.',
    ...PUBLICATION,
    publicationSlug: 'golden-single-scene',
    project: referenceProject(projectId, {
      name: 'Single scene',
      publication: { slug: 'golden-single-scene', visibility: 'public' },
      scenes: [
        referenceScene(projectId, {
          id: '22222222-2222-4000-8000-000000000001',
          name: 'Lobby',
          panoramaAssetId: asset.id,
          isPrimary: true
        })
      ]
    }),
    assets: [asset]
  };
}

function singleScenePreview(): GoldenScenario {
  const base = singleScene();
  return {
    ...base,
    id: 'image360-single-scene-preview',
    description: 'image360 single scene compiled for a draft preview.',
    target: 'preview',
    visibility: 'private'
  };
}

function multiSceneTour(): GoldenScenario {
  const asset = referencePanoramaAsset('22222222-0000-4000-8000-000000000002');
  const projectId = '22222222-1111-4000-8000-000000000002';
  const sceneIds = Array.from(
    { length: 4 },
    (_unused, index) => `22222222-2222-4000-9000-${String(index).padStart(12, '0')}`
  );
  return {
    id: 'image360-multi-scene-tour',
    description: 'image360 multi-scene tour with connections.',
    ...PUBLICATION,
    publicationSlug: 'golden-multi-scene-tour',
    project: referenceProject(projectId, {
      name: 'Multi-scene tour',
      publication: { slug: 'golden-multi-scene-tour', visibility: 'public' },
      scenes: sceneIds.map((sceneId, index) =>
        referenceScene(projectId, {
          id: sceneId,
          name: `Room ${index + 1}`,
          panoramaAssetId: asset.id,
          sortOrder: index,
          isPrimary: index === 0,
          connections:
            index + 1 < sceneIds.length
              ? [
                {
                  id: `22222222-3333-4000-9000-${String(index).padStart(12, '0')}`,
                  sourceSceneId: sceneId,
                  targetSceneId: sceneIds[index + 1]!,
                  importance: 80,
                  preloadHint: 'high' as const
                }
              ]
              : []
        })
      )
    }),
    assets: [asset]
  };
}

function croppedWithPoseCorrection(): GoldenScenario {
  const base = referenceCroppedPanoramaAsset('22222222-0000-4000-8000-000000000003');
  const metadata = base.metadata as unknown as Record<string, unknown>;
  const xmp = metadata.xmp as Record<string, unknown>;
  const asset: CanonicalAsset = {
    ...base,
    metadata: {
      ...metadata,
      xmp: {
        ...xmp,
        poseHeadingDegrees: 42.5,
        posePitchDegrees: -3.25,
        poseRollDegrees: 1.75,
        initialViewHeadingDegrees: 120,
        initialViewPitchDegrees: -10,
        initialViewFovDegrees: 85
      }
    } as unknown as JsonObject
  };
  const projectId = '22222222-1111-4000-8000-000000000003';
  return {
    id: 'image360-cropped-with-pose-correction',
    description: 'image360 with cropped panorama and pose correction.',
    ...PUBLICATION,
    publicationSlug: 'golden-cropped-pose',
    project: referenceProject(projectId, {
      name: 'Cropped and straightened',
      publication: { slug: 'golden-cropped-pose', visibility: 'public' },
      scenes: [
        referenceScene(projectId, {
          id: '22222222-2222-4000-8000-000000000003',
          name: 'Balcony',
          panoramaAssetId: asset.id,
          isPrimary: true,
          // Left unset so the capture pose seeds the framing.
          initialView: {}
        })
      ]
    }),
    assets: [asset]
  };
}

function gallery(): GoldenScenario {
  const asset = referencePanoramaAsset('22222222-0000-4000-8000-000000000004');
  const projectId = '22222222-1111-4000-8000-000000000004';
  return {
    id: 'image360-gallery',
    description: 'image360 with gallery enabled.',
    ...PUBLICATION,
    publicationSlug: 'golden-gallery',
    project: referenceProject(projectId, {
      name: 'Gallery',
      publication: { slug: 'golden-gallery', visibility: 'public' },
      settings: {
        gallery: { enabled: true, showSceneNames: true, showThumbnails: true },
        quality: { preference: 'high' }
      },
      scenes: ['Atrium', 'Hall', 'Terrace'].map((name, index) =>
        referenceScene(projectId, {
          id: `22222222-2222-4000-8000-00000000004${index}`,
          name,
          panoramaAssetId: asset.id,
          sortOrder: index,
          isPrimary: index === 0
        })
      )
    }),
    assets: [asset]
  };
}

function privatePublication(): GoldenScenario {
  const asset = referencePanoramaAsset('22222222-0000-4000-8000-000000000005');
  const projectId = '22222222-1111-4000-8000-000000000005';
  return {
    id: 'image360-private-publication',
    description: 'image360 private publication.',
    target: 'publication',
    visibility: 'private',
    publicationRevision: 3,
    publicationSlug: 'golden-private',
    project: referenceProject(projectId, {
      name: 'Private experience',
      publication: { slug: 'golden-private', visibility: 'private' },
      scenes: [
        referenceScene(projectId, {
          id: '22222222-2222-4000-8000-000000000005',
          name: 'Boardroom',
          panoramaAssetId: asset.id,
          isPrimary: true
        })
      ]
    }),
    assets: [asset]
  };
}

function tiledHighResolution(): GoldenScenario {
  const asset = referenceHighResolutionPanoramaAsset('22222222-0000-4000-8000-000000000006');
  const projectId = '22222222-1111-4000-8000-000000000006';
  return {
    id: 'image360-tiled-high-resolution',
    description: 'image360 with a tiled panorama and templated tile delivery.',
    ...PUBLICATION,
    publicationSlug: 'golden-tiled',
    project: referenceProject(projectId, {
      name: 'High resolution',
      publication: { slug: 'golden-tiled', visibility: 'public' },
      settings: { quality: { preference: 'high' } },
      scenes: [
        referenceScene(projectId, {
          id: '22222222-2222-4000-8000-000000000006',
          name: 'Atrium',
          panoramaAssetId: asset.id,
          isPrimary: true
        })
      ]
    }),
    assets: [asset]
  };
}

function hotspotsAndContent(): GoldenScenario {
  const panorama = referencePanoramaAsset('22222222-0000-4000-8000-000000000007');
  const image = referenceImageAsset('22222222-0000-4000-8000-000000000017');
  const projectId = '22222222-1111-4000-8000-000000000007';
  const sceneId = '22222222-2222-4000-8000-000000000007';
  return {
    id: 'image360-hotspots-and-content',
    description: 'image360 with rich hotspot content, asset actions and external links.',
    ...PUBLICATION,
    publicationSlug: 'golden-hotspots',
    project: referenceProject(projectId, {
      name: 'Hotspots',
      publication: { slug: 'golden-hotspots', visibility: 'public' },
      branding: {
        companyName: 'Museum',
        welcomeMessage: '<strong>Welcome</strong><img src=x onerror=alert(1)>'
      },
      settings: {
        information: {
          title: 'About',
          bodyHtml: '<p>Guided tour<script>steal()</script></p>',
          externalUrl: 'https://example.com/about'
        }
      },
      scenes: [
        referenceScene(projectId, {
          id: sceneId,
          name: 'Great hall',
          panoramaAssetId: panorama.id,
          isPrimary: true,
          hotspots: [
            {
              id: '22222222-4444-4000-8000-000000000001',
              sceneId,
              geometry: { kind: 'point' },
              position: position(35, 5),
              appearance: { label: 'Exhibit', color: '#224466', emphasis: 'prominent' },
              content: {
                title: 'About this hall',
                description: 'Built in 1890.',
                bodyHtml: '<p>Safe copy<script>bad()</script></p>',
                tooltip: 'Read more',
                externalUrl: 'https://example.com/hall'
              },
              action: { kind: 'showInformation' },
              visibilityRules: { enabled: true }
            },
            {
              id: '22222222-4444-4000-8000-000000000002',
              sceneId,
              geometry: { kind: 'point' },
              position: position(-40, -8),
              appearance: { label: 'Painting' },
              content: { title: 'Portrait', imageAssetId: image.id },
              action: { kind: 'openAsset', assetId: image.id },
              visibilityRules: { enabled: true }
            }
          ]
        })
      ]
    }),
    assets: [panorama, image]
  };
}

function mapAndPlan(): GoldenScenario {
  const panorama = referencePanoramaAsset('22222222-0000-4000-8000-000000000008');
  const planAsset = referencePlanAsset('22222222-0000-4000-8000-000000000018');
  const projectId = '22222222-1111-4000-8000-000000000008';
  const planId = '22222222-5555-4000-8000-000000000001';
  const sceneIds = [
    '22222222-2222-4000-8000-000000000081',
    '22222222-2222-4000-8000-000000000082'
  ];
  return {
    id: 'image360-map-and-plan',
    description: 'image360 with world coordinates, a floor plan and a spatial index.',
    ...PUBLICATION,
    publicationSlug: 'golden-map-plan',
    project: referenceProject(projectId, {
      name: 'Map and plan',
      publication: { slug: 'golden-map-plan', visibility: 'public' },
      settings: {
        map: { enabled: true, showSceneMarkers: true, showHeadingCone: true },
        plan: { enabled: true, defaultPlanId: planId, showSceneMarkers: true }
      },
      plans: [referencePlan(projectId, planId, planAsset.id)],
      scenes: [
        referenceScene(projectId, {
          id: sceneIds[0]!,
          name: 'Entrance',
          panoramaAssetId: panorama.id,
          sortOrder: 0,
          isPrimary: true,
          spatialData: {
            coordinateSystem: 'plan_normalized',
            latitude: 51.5007,
            longitude: -0.1246,
            headingDegrees: 90,
            planId,
            mapX: 0.25,
            mapY: 0.4
          }
        }),
        referenceScene(projectId, {
          id: sceneIds[1]!,
          name: 'Courtyard',
          panoramaAssetId: panorama.id,
          sortOrder: 1,
          spatialData: {
            coordinateSystem: 'plan_normalized',
            latitude: 51.5011,
            longitude: -0.1239,
            headingDegrees: 180,
            planId,
            mapX: 0.65,
            mapY: 0.55
          }
        })
      ]
    }),
    assets: [panorama, planAsset]
  };
}

function overlaysAndLayers(): GoldenScenario {
  const panorama = referencePanoramaAsset('22222222-0000-4000-8000-000000000009');
  const image = referenceImageAsset('22222222-0000-4000-8000-000000000019');
  const projectId = '22222222-1111-4000-8000-000000000009';
  const sceneId = '22222222-2222-4000-8000-000000000009';
  return {
    id: 'image360-overlays-and-layers',
    description: 'image360 with polygon, polyline and image-layer overlays.',
    ...PUBLICATION,
    publicationSlug: 'golden-overlays',
    project: referenceProject(projectId, {
      name: 'Overlays',
      publication: { slug: 'golden-overlays', visibility: 'public' },
      scenes: [
        referenceScene(projectId, {
          id: sceneId,
          name: 'Site',
          panoramaAssetId: panorama.id,
          isPrimary: true,
          overlays: [
            {
              id: '22222222-6666-4000-8000-000000000001',
              sceneId,
              name: 'Restricted area',
              geometry: {
                kind: 'polygon',
                vertices: [position(10, 5), position(30, 5), position(30, -10), position(10, -10)]
              },
              appearance: { label: 'Restricted', color: '#aa2222', fillOpacity: 0.3 },
              content: { title: 'Restricted floor', description: 'Authorized staff only.' },
              action: { kind: 'showInformation' },
              visibilityRules: { enabled: true }
            },
            {
              id: '22222222-6666-4000-8000-000000000002',
              sceneId,
              name: 'Walking route',
              geometry: {
                kind: 'polyline',
                vertices: [position(-20, 0), position(-5, 4), position(12, 2)]
              },
              appearance: { label: 'Route', strokeWidth: 3 },
              action: { kind: 'none' },
              visibilityRules: { enabled: true }
            },
            {
              id: '22222222-6666-4000-8000-000000000003',
              sceneId,
              name: 'Signage',
              geometry: {
                kind: 'imageLayer',
                assetId: image.id,
                anchor: {
                  longitudeDegrees: 60,
                  latitudeDegrees: 12,
                  widthDegrees: 24,
                  heightDegrees: 14
                }
              },
              action: { kind: 'openUrl', url: 'https://example.com/signage' },
              visibilityRules: { enabled: true }
            }
          ]
        })
      ]
    }),
    assets: [panorama, image]
  };
}

function capabilityFallback(): GoldenScenario {
  const panorama = referencePanoramaAsset('22222222-0000-4000-8000-00000000000a');
  const projectId = '22222222-1111-4000-8000-00000000000a';
  return {
    id: 'image360-capability-fallback',
    description: 'project with an unavailable optional capability and fallback.',
    ...PUBLICATION,
    publicationSlug: 'golden-capability-fallback',
    project: referenceProject(projectId, {
      name: 'Immersive fallback',
      publication: { slug: 'golden-capability-fallback', visibility: 'public' },
      settings: {
        motionNavigation: { enabled: true, requestPermissionOnStart: true },
        immersiveViewing: { stereoEnabled: true, immersiveEnabled: true }
      },
      scenes: [
        referenceScene(projectId, {
          id: '22222222-2222-4000-8000-00000000000a',
          name: 'Overlook',
          panoramaAssetId: panorama.id,
          isPrimary: true
        })
      ]
    }),
    assets: [panorama]
  };
}

function largeProgressiveTour(): GoldenScenario {
  const asset = referencePanoramaAsset('22222222-0000-4000-8000-00000000000b');
  const projectId = '22222222-1111-4000-8000-00000000000b';
  const sceneCount = 120;
  const sceneIds = Array.from(
    { length: sceneCount },
    (_unused, index) => `22222222-2222-4000-b000-${String(index).padStart(12, '0')}`
  );
  return {
    id: 'image360-large-progressive-tour',
    description: 'large tour using progressive scene index.',
    ...PUBLICATION,
    publicationSlug: 'golden-large-tour',
    project: referenceProject(projectId, {
      name: 'Large tour',
      publication: { slug: 'golden-large-tour', visibility: 'public' },
      scenes: sceneIds.map((sceneId, index) =>
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
                  id: `22222222-3333-4000-b000-${String(index).padStart(12, '0')}`,
                  sourceSceneId: sceneId,
                  targetSceneId: sceneIds[index + 1]!,
                  importance: 60,
                  preloadHint: 'normal' as const
                }
              ]
              : []
        })
      )
    }),
    assets: [asset]
  };
}

function videoTimeline(): GoldenScenario {
  const video = referenceVideoAsset('22222222-0000-4000-8000-00000000000c');
  const projectId = '22222222-1111-4000-8000-00000000000c';
  return {
    id: 'video360-timeline',
    description: 'video360 with timeline interactions.',
    ...PUBLICATION,
    publicationSlug: 'golden-video-timeline',
    project: referenceProject(projectId, {
      type: 'video360',
      name: '360 video',
      publication: { slug: 'golden-video-timeline', visibility: 'public' },
      videoAssetId: video.id,
      settings: { video: { autoplay: false, showControls: true, showTimeline: true } },
      scenes: [],
      timeline: [
        {
          id: '22222222-7777-4000-8000-000000000001',
          projectId,
          kind: 'information',
          timeMs: 12_000,
          endTimeMs: 18_000,
          content: {
            title: 'Engine room',
            description: 'Take a closer look.',
            ctaLabel: 'Learn more',
            ctaUrl: 'https://example.com/engine'
          },
          action: { kind: 'showInformation' },
          visibilityRules: { enabled: true, pauseVideoWhenShown: true },
          sortOrder: 0
        },
        {
          id: '22222222-7777-4000-8000-000000000002',
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
          sortOrder: 1
        }
      ]
    }),
    assets: [video]
  };
}

function videoMultipleProfiles(): GoldenScenario {
  const base = videoTimeline();
  return {
    ...base,
    id: 'video360-multiple-playback-profiles',
    description: 'video360 with multiple playback profiles compiled for a draft preview.',
    target: 'preview',
    visibility: 'private'
  };
}

function rejectedExperience(): GoldenScenario {
  const asset: CanonicalAsset = {
    ...referencePanoramaAsset('22222222-0000-4000-8000-00000000000e'),
    processingStatus: 'processing',
    derivatives: []
  };
  const projectId = '22222222-1111-4000-8000-00000000000e';
  return {
    id: 'image360-rejected-validation',
    description: 'project failing validation.',
    ...PUBLICATION,
    publicationSlug: 'golden-rejected',
    expectRejection: true,
    project: referenceProject(projectId, {
      name: 'Not ready yet',
      publication: { slug: 'golden-rejected', visibility: 'public' },
      scenes: [
        referenceScene(projectId, {
          id: '22222222-2222-4000-8000-00000000000e',
          name: 'Unprocessed',
          panoramaAssetId: asset.id,
          isPrimary: true
        })
      ]
    }),
    assets: [asset]
  };
}

/** The frozen scenario set, in a stable order. */
export function goldenScenarios(): readonly GoldenScenario[] {
  return [
    singleScene(),
    singleScenePreview(),
    multiSceneTour(),
    croppedWithPoseCorrection(),
    gallery(),
    privatePublication(),
    tiledHighResolution(),
    hotspotsAndContent(),
    mapAndPlan(),
    overlaysAndLayers(),
    capabilityFallback(),
    largeProgressiveTour(),
    videoTimeline(),
    videoMultipleProfiles(),
    rejectedExperience()
  ];
}
