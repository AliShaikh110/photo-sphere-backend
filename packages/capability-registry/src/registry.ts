import {
  CAPABILITY_IDS,
  type CapabilityDefinition,
  type CapabilityId,
  type CapabilityRegistry,
} from './types';

function definition<Id extends CapabilityId>(
  value: CapabilityDefinition<Id>,
): CapabilityDefinition<Id> {
  return Object.freeze({
    ...value,
    dependencies: Object.freeze([...value.dependencies]),
    incompatibilities: Object.freeze([...value.incompatibilities]),
    deviceRequirements: Object.freeze([...value.deviceRequirements]),
    mediaRequirements: Object.freeze([...value.mediaRequirements]),
    fallback: value.fallback === null
      ? null
      : Object.freeze({
        ...value.fallback,
        alternatives: Object.freeze([...value.fallback.alternatives]),
      }),
  });
}

export const CAPABILITY_REGISTRY = Object.freeze({
  basicPanorama: definition({
    id: 'basicPanorama',
    productFeature: 'Panorama viewing',
    availability: 'available',
    rendererModule: 'core-panorama',
    dependencies: [],
    incompatibilities: [],
    deviceRequirements: [],
    deviceRequirementResolution: 'compile-time',
    mediaRequirements: ['ready-panorama'],
    lazyLoadModule: null,
    fallback: null,
  }),
  hotspots: definition({
    id: 'hotspots',
    productFeature: 'Hotspots',
    availability: 'available',
    rendererModule: 'hotspots',
    dependencies: ['basicPanorama'],
    incompatibilities: [],
    deviceRequirements: [],
    deviceRequirementResolution: 'compile-time',
    mediaRequirements: [],
    lazyLoadModule: null,
    fallback: null,
  }),
  sceneNavigation: definition({
    id: 'sceneNavigation',
    productFeature: 'Scene navigation',
    availability: 'available',
    rendererModule: 'virtual-tour',
    dependencies: ['basicPanorama'],
    incompatibilities: [],
    deviceRequirements: [],
    deviceRequirementResolution: 'compile-time',
    mediaRequirements: [],
    lazyLoadModule: null,
    fallback: null,
  }),
  gallery: definition({
    id: 'gallery',
    productFeature: 'Gallery',
    availability: 'available',
    rendererModule: 'gallery',
    dependencies: ['sceneNavigation'],
    incompatibilities: ['highResolution'],
    deviceRequirements: [],
    deviceRequirementResolution: 'compile-time',
    mediaRequirements: [],
    lazyLoadModule: 'gallery',
    fallback: null,
  }),
  autorotation: definition({
    id: 'autorotation',
    productFeature: 'Automatic rotation',
    availability: 'available',
    rendererModule: 'core-panorama',
    dependencies: ['basicPanorama'],
    incompatibilities: [],
    deviceRequirements: [],
    deviceRequirementResolution: 'compile-time',
    mediaRequirements: [],
    lazyLoadModule: null,
    fallback: null,
  }),
  compass: definition({
    id: 'compass',
    productFeature: 'Compass',
    availability: 'available',
    rendererModule: 'compass',
    dependencies: ['basicPanorama'],
    incompatibilities: [],
    deviceRequirements: [],
    deviceRequirementResolution: 'compile-time',
    mediaRequirements: [],
    lazyLoadModule: 'compass',
    fallback: null,
  }),
  viewLimits: definition({
    id: 'viewLimits',
    productFeature: 'Allowed viewing area',
    availability: 'available',
    rendererModule: 'core-panorama',
    dependencies: ['basicPanorama'],
    incompatibilities: [],
    deviceRequirements: [],
    deviceRequirementResolution: 'compile-time',
    mediaRequirements: [],
    lazyLoadModule: null,
    fallback: null,
  }),
  tiledPanorama: definition({
    id: 'tiledPanorama',
    productFeature: 'Optimized high-quality panorama',
    availability: 'available',
    rendererModule: 'equirectangular-tiles',
    dependencies: ['basicPanorama'],
    incompatibilities: [],
    deviceRequirements: [],
    deviceRequirementResolution: 'compile-time',
    mediaRequirements: ['tiled-panorama-derivatives'],
    lazyLoadModule: 'equirectangular-tiles',
    fallback: {
      behavior: 'disable-capability',
      message: 'The experience will use the standard panorama quality.',
      alternatives: ['Generate optimized panorama detail', 'Use standard panorama quality'],
    },
  }),
  highResolution: definition({
    id: 'highResolution',
    productFeature: 'Fixed high-resolution selection',
    availability: 'available',
    rendererModule: 'resolution-selection',
    dependencies: ['basicPanorama'],
    incompatibilities: ['gallery'],
    deviceRequirements: [],
    deviceRequirementResolution: 'compile-time',
    mediaRequirements: ['high-resolution-derivative'],
    lazyLoadModule: 'resolution-selection',
    fallback: {
      behavior: 'disable-capability',
      message: 'Automatic quality selection will be used.',
      alternatives: ['Use automatic quality selection'],
    },
  }),
  imageContent: definition({
    id: 'imageContent',
    productFeature: 'Image content',
    availability: 'available',
    rendererModule: 'image-content',
    dependencies: [],
    incompatibilities: [],
    deviceRequirements: [],
    deviceRequirementResolution: 'compile-time',
    mediaRequirements: ['ready-image-content'],
    lazyLoadModule: 'image-content',
    fallback: null,
  }),
  videoContent: definition({
    id: 'videoContent',
    productFeature: 'Video content',
    availability: 'available',
    rendererModule: 'video-content',
    dependencies: [],
    incompatibilities: [],
    deviceRequirements: ['video-playback'],
    deviceRequirementResolution: 'compile-time',
    mediaRequirements: ['ready-video-content'],
    lazyLoadModule: 'video-content',
    fallback: null,
  }),
  externalLink: definition({
    id: 'externalLink',
    productFeature: 'External links',
    availability: 'available',
    rendererModule: 'content-actions',
    dependencies: [],
    incompatibilities: [],
    deviceRequirements: [],
    deviceRequirementResolution: 'compile-time',
    mediaRequirements: [],
    lazyLoadModule: null,
    fallback: null,
  }),
  video360: definition({
    id: 'video360',
    productFeature: '360 video',
    availability: 'available',
    rendererModule: 'video-panorama',
    dependencies: [],
    incompatibilities: [],
    deviceRequirements: ['video-playback'],
    deviceRequirementResolution: 'compile-time',
    mediaRequirements: ['ready-video360-source', 'ready-video360-playback-profile'],
    lazyLoadModule: 'video-panorama',
    // 360 video is the whole experience for a video360 project, so there is no
    // in-experience alternative: a missing playback profile is a hard error.
    fallback: null,
  }),
  videoTimeline: definition({
    id: 'videoTimeline',
    productFeature: 'Video timeline',
    availability: 'available',
    rendererModule: 'video-timeline',
    dependencies: ['video360'],
    incompatibilities: [],
    deviceRequirements: [],
    deviceRequirementResolution: 'compile-time',
    mediaRequirements: ['known-video-duration'],
    lazyLoadModule: 'video-timeline',
    fallback: {
      behavior: 'disable-capability',
      message: 'The video will play without timed interactions.',
      alternatives: ['Play the video without timed interactions'],
    },
  }),
  timedHotspots: definition({
    id: 'timedHotspots',
    productFeature: 'Timed hotspots',
    availability: 'available',
    rendererModule: 'hotspots',
    dependencies: ['videoTimeline'],
    incompatibilities: [],
    deviceRequirements: [],
    deviceRequirementResolution: 'compile-time',
    mediaRequirements: [],
    lazyLoadModule: null,
    fallback: {
      behavior: 'disable-capability',
      message: 'The video will play without timed hotspots.',
      alternatives: ['Use timed information panels'],
    },
  }),
  timedViewpoint: definition({
    id: 'timedViewpoint',
    productFeature: 'Timed viewpoint changes',
    availability: 'available',
    rendererModule: 'video-timeline',
    dependencies: ['videoTimeline'],
    incompatibilities: [],
    deviceRequirements: [],
    deviceRequirementResolution: 'compile-time',
    mediaRequirements: [],
    lazyLoadModule: 'video-timeline',
    fallback: {
      behavior: 'disable-capability',
      message: 'Visitors will keep control of the viewing direction.',
      alternatives: ['Let visitors choose the viewing direction'],
    },
  }),
  cta: definition({
    id: 'cta',
    productFeature: 'Calls to action',
    availability: 'available',
    rendererModule: 'content-actions',
    dependencies: [],
    incompatibilities: [],
    deviceRequirements: [],
    deviceRequirementResolution: 'compile-time',
    mediaRequirements: [],
    lazyLoadModule: null,
    fallback: {
      behavior: 'disable-capability',
      message: 'The experience will continue without calls to action.',
      alternatives: ['Use an information panel'],
    },
  }),
  map: definition({
    id: 'map',
    productFeature: 'Map navigation',
    availability: 'available',
    rendererModule: 'map',
    dependencies: ['sceneNavigation'],
    incompatibilities: [],
    deviceRequirements: [],
    deviceRequirementResolution: 'compile-time',
    mediaRequirements: ['map-spatial-data'],
    lazyLoadModule: 'map',
    fallback: {
      behavior: 'disable-capability',
      message: 'Scene navigation will remain available without a map.',
      alternatives: ['Add location data to your scenes', 'Use scene navigation'],
    },
  }),
  plan: definition({
    id: 'plan',
    productFeature: 'Plan navigation',
    availability: 'available',
    rendererModule: 'plan',
    dependencies: ['sceneNavigation'],
    incompatibilities: [],
    deviceRequirements: [],
    deviceRequirementResolution: 'compile-time',
    mediaRequirements: ['plan-spatial-data', 'ready-plan-asset'],
    lazyLoadModule: 'plan',
    fallback: {
      behavior: 'disable-capability',
      message: 'Scene navigation will remain available without a plan.',
      alternatives: ['Place your scenes on a plan', 'Use scene navigation'],
    },
  }),
  gyroscope: definition({
    id: 'gyroscope',
    productFeature: 'Motion navigation',
    availability: 'available',
    rendererModule: 'gyroscope',
    dependencies: ['basicPanorama'],
    incompatibilities: [],
    deviceRequirements: ['device-orientation'],
    // Sensor availability and permission are browser decisions. Declaring the
    // requirement keeps a publication valid while the player degrades safely.
    deviceRequirementResolution: 'runtime',
    mediaRequirements: [],
    lazyLoadModule: 'gyroscope',
    fallback: {
      behavior: 'disable-capability',
      message: 'Standard touch and pointer navigation will be used.',
      alternatives: ['Use standard navigation'],
    },
  }),
  stereo: definition({
    id: 'stereo',
    productFeature: 'Stereo viewing',
    availability: 'available',
    rendererModule: 'stereo',
    dependencies: ['basicPanorama'],
    incompatibilities: [],
    deviceRequirements: ['stereo-rendering'],
    deviceRequirementResolution: 'runtime',
    mediaRequirements: [],
    lazyLoadModule: 'stereo',
    fallback: {
      behavior: 'disable-capability',
      message: 'Normal panorama viewing will be used.',
      alternatives: ['Use normal panorama viewing'],
    },
  }),
  vr: definition({
    id: 'vr',
    productFeature: 'Immersive viewing',
    availability: 'available',
    rendererModule: 'immersive-viewing',
    dependencies: ['gyroscope', 'stereo'],
    incompatibilities: [],
    deviceRequirements: ['immersive-runtime'],
    deviceRequirementResolution: 'runtime',
    mediaRequirements: [],
    lazyLoadModule: 'immersive-viewing',
    fallback: {
      behavior: 'disable-capability',
      message: 'Normal panorama viewing will be used.',
      alternatives: ['Use normal panorama viewing'],
    },
  }),
  advancedOverlay: definition({
    id: 'advancedOverlay',
    productFeature: 'Advanced overlays',
    availability: 'available',
    rendererModule: 'advanced-overlays',
    dependencies: ['basicPanorama'],
    incompatibilities: [],
    deviceRequirements: [],
    deviceRequirementResolution: 'compile-time',
    mediaRequirements: [],
    lazyLoadModule: 'advanced-overlays',
    fallback: {
      behavior: 'disable-capability',
      message: 'The experience will continue without advanced overlays.',
      alternatives: ['Use standard hotspot content'],
    },
  }),
  advancedGeometry: definition({
    id: 'advancedGeometry',
    productFeature: 'Advanced hotspot geometry',
    availability: 'available',
    rendererModule: 'advanced-geometry',
    dependencies: ['hotspots'],
    incompatibilities: [],
    deviceRequirements: [],
    deviceRequirementResolution: 'compile-time',
    mediaRequirements: [],
    lazyLoadModule: 'advanced-geometry',
    fallback: {
      behavior: 'disable-capability',
      message: 'Point hotspots will remain available.',
      alternatives: ['Use point hotspots'],
    },
  }),
  cubemapPanorama: definition({
    id: 'cubemapPanorama',
    productFeature: 'Advanced panorama format',
    availability: 'available',
    rendererModule: 'cubemap',
    dependencies: ['basicPanorama'],
    incompatibilities: [],
    deviceRequirements: [],
    deviceRequirementResolution: 'compile-time',
    mediaRequirements: ['cubemap-derivatives'],
    lazyLoadModule: 'cubemap',
    fallback: {
      behavior: 'disable-capability',
      message: 'The experience will use the standard panorama format.',
      alternatives: ['Use the standard panorama format'],
    },
  }),
  customInteraction: definition({
    id: 'customInteraction',
    productFeature: 'Custom interactions',
    availability: 'available',
    rendererModule: 'extensions',
    dependencies: ['hotspots'],
    incompatibilities: [],
    deviceRequirements: [],
    deviceRequirementResolution: 'compile-time',
    mediaRequirements: ['registered-extension'],
    lazyLoadModule: 'extensions',
    fallback: {
      behavior: 'disable-capability',
      message: 'The experience will continue without the custom interaction.',
      alternatives: ['Use a standard hotspot or overlay'],
    },
  }),
} satisfies CapabilityRegistry);

export const CAPABILITY_DEFINITIONS = Object.freeze(
  CAPABILITY_IDS.map((id) => CAPABILITY_REGISTRY[id]),
);

export function getCapabilityDefinition<Id extends CapabilityId>(
  id: Id,
): CapabilityRegistry[Id] {
  return CAPABILITY_REGISTRY[id];
}

export function validateCapabilityRegistry(
  registry: CapabilityRegistry = CAPABILITY_REGISTRY,
): readonly string[] {
  const errors: string[] = [];

  for (const id of CAPABILITY_IDS) {
    const capability = registry[id];
    if (capability.id !== id) {
      errors.push(`Registry key ${id} does not match its capability id.`);
    }
    if (capability.lazyLoadModule !== null
      && capability.lazyLoadModule !== capability.rendererModule) {
      errors.push(`Capability ${id} declares inconsistent runtime module metadata.`);
    }
    if (capability.deviceRequirementResolution === 'runtime' && capability.fallback === null) {
      errors.push(`Capability ${id} defers device support without declaring a fallback.`);
    }
    for (const dependency of capability.dependencies) {
      if (dependency === id) {
        errors.push(`Capability ${id} cannot depend on itself.`);
      }
    }
    for (const incompatibleId of capability.incompatibilities) {
      if (!registry[incompatibleId].incompatibilities.includes(id)) {
        errors.push(`Capability incompatibility ${id}/${incompatibleId} must be symmetric.`);
      }
    }
  }

  return Object.freeze(errors);
}
