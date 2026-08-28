import { describe, expect, it } from 'vitest';

import { resolveCapabilities, CapabilityResolver } from '../../../apps/api/src/capabilities';
import {
  CAPABILITY_REGISTRY,
  CAPABILITY_DEFINITIONS,
  validateCapabilityRegistry,
} from '../../../apps/api/src/capabilities/registry';
import { CAPABILITY_IDS } from '../../../apps/api/src/capabilities/types';
import type {
  CapabilityId,
  CapabilityResolutionInput,
} from '../../../apps/api/src/capabilities/types';

/** A resolvable baseline: a ready panorama and nothing else. */
function input(
  requestedCapabilities: readonly CapabilityId[],
  overrides: Partial<CapabilityResolutionInput> = {},
): CapabilityResolutionInput {
  return {
    projectId: 'project-1',
    requestedCapabilities,
    availableMediaRequirements: ['ready-panorama'],
    ...overrides,
  };
}

describe('capability registry', () => {
  it('is internally consistent', () => {
    expect(validateCapabilityRegistry()).toEqual([]);
  });

  it('covers every capability the sprint requires as a shared backend contract', () => {
    const required: readonly CapabilityId[] = [
      'basicPanorama',
      'hotspots',
      'sceneNavigation',
      'gallery',
      'autorotation',
      'compass',
      'viewLimits',
      'tiledPanorama',
      'highResolution',
      'imageContent',
      'videoContent',
      'externalLink',
      // Reserved for later phases, but declared now so the resolver can reason
      // about them instead of failing on an unknown feature.
      'video360',
      'map',
      'plan',
      'gyroscope',
      'stereo',
      'vr',
      'advancedOverlay',
      'advancedGeometry',
    ];
    for (const id of required) {
      expect(CAPABILITY_REGISTRY[id]?.id).toBe(id);
    }
  });

  it('keeps incompatibilities symmetric so resolution order cannot change the outcome', () => {
    for (const definition of CAPABILITY_DEFINITIONS) {
      for (const other of definition.incompatibilities) {
        expect(CAPABILITY_REGISTRY[other].incompatibilities).toContain(definition.id);
      }
    }
  });

  it('gives every runtime-resolved device capability a fallback', () => {
    for (const definition of CAPABILITY_DEFINITIONS) {
      if (definition.deviceRequirementResolution !== 'runtime') continue;
      expect(definition.fallback).not.toBeNull();
    }
  });
});

describe('capability resolver — dependencies', () => {
  it('admits a capability whose dependency is satisfied and pulls it in transitively', () => {
    const result = resolveCapabilities(input(['gallery'], {
      availableMediaRequirements: ['ready-panorama'],
    }));

    expect(result.valid).toBe(true);
    // gallery -> sceneNavigation -> basicPanorama were never requested directly.
    expect(result.capabilities).toEqual(['basicPanorama', 'sceneNavigation', 'gallery']);
  });

  it('drops a capability whose dependency became unavailable, applying its fallback', () => {
    // Immersive viewing depends on both motion and stereo; stereo is off.
    const result = resolveCapabilities(input(['vr'], {
      configuration: {
        immersiveRequested: true,
        motionNavigationRequested: true,
        stereoRequested: false,
      },
    }));

    expect(result.capabilities).not.toContain('vr');
    expect(result.capabilities).not.toContain('stereo');
    const dependencyIssue = result.issues.find(
      (issue) => issue.capabilityIds.includes('vr') && issue.capabilityIds.includes('stereo'),
    );
    expect(dependencyIssue?.severity).toBe('warning');
    expect(result.fallbacks.map((fallback) => fallback.capabilityId)).toContain('vr');
    // A safe downgrade is still a publishable experience.
    expect(result.valid).toBe(true);
  });

  it('rejects an unmet dependency outright when no fallback is allowed', () => {
    const result = resolveCapabilities(input(['vr'], {
      fallbackMode: 'reject',
      configuration: {
        immersiveRequested: true,
        motionNavigationRequested: true,
        stereoRequested: false,
      },
    }));

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('FEATURE_DEPENDENCY_UNAVAILABLE');
  });
});

describe('capability resolver — media requirements', () => {
  it('requires tiled derivatives before optimized high quality is compiled', () => {
    const result = resolveCapabilities(input(['basicPanorama', 'tiledPanorama']));

    expect(result.capabilities).toEqual(['basicPanorama']);
    expect(result.runtimeModules).not.toContain('equirectangular-tiles');
    expect(result.fallbacks).toEqual([{
      capabilityId: 'tiledPanorama',
      behavior: 'disable-capability',
      reason: 'FEATURE_MEDIA_REQUIRED',
      message: 'The experience will use the standard panorama quality.',
    }]);
    // Falling back to the standard derivative keeps the experience publishable.
    expect(result.valid).toBe(true);
  });

  it('compiles optimized high quality once the tiled derivatives exist', () => {
    const result = resolveCapabilities(input(['basicPanorama', 'tiledPanorama'], {
      availableMediaRequirements: ['ready-panorama', 'tiled-panorama-derivatives'],
    }));

    expect(result.valid).toBe(true);
    expect(result.capabilities).toContain('tiledPanorama');
    expect(result.runtimeModules).toContain('equirectangular-tiles');
    expect(result.fallbacks).toEqual([]);
  });

  it('fails closed when the experience itself has no ready panorama', () => {
    const result = resolveCapabilities({
      projectId: 'project-1',
      requestedCapabilities: ['basicPanorama'],
      availableMediaRequirements: [],
    });

    expect(result.valid).toBe(false);
    const issue = result.issues[0]!;
    expect(issue.code).toBe('FEATURE_MEDIA_REQUIRED');
    expect(issue.severity).toBe('error');
    expect(issue.path).toBe('scenes.panoramaAssetId');
  });

  it('reports a referenced content asset that is missing or still processing', () => {
    const notReady = resolveCapabilities(input(['basicPanorama', 'imageContent'], {
      assetReferences: [{
        assetId: 'asset-9',
        capabilityId: 'imageContent',
        requirement: 'ready-image-content',
        state: 'processing',
        entityId: 'hotspot-1',
        path: 'scenes[0].hotspots[0].content.imageAssetId',
      }],
    }));
    expect(notReady.valid).toBe(false);
    expect(notReady.issues[0]).toMatchObject({
      code: 'CONTENT_ASSET_NOT_READY',
      severity: 'error',
      entityId: 'hotspot-1',
      path: 'scenes[0].hotspots[0].content.imageAssetId',
    });

    const missing = resolveCapabilities(input(['basicPanorama', 'imageContent'], {
      assetReferences: [{
        assetId: 'asset-x',
        capabilityId: 'imageContent',
        requirement: 'ready-image-content',
        state: 'missing',
      }],
    }));
    expect(missing.valid).toBe(false);
    expect(missing.issues[0]?.code).toBe('CONTENT_ASSET_NOT_FOUND');
  });

  it('enforces a compile-time device requirement such as video playback', () => {
    const result = resolveCapabilities(input(['basicPanorama', 'videoContent'], {
      availableDeviceRequirements: [],
      assetReferences: [{
        assetId: 'asset-video',
        capabilityId: 'videoContent',
        requirement: 'ready-video-content',
        state: 'ready',
      }],
    }));

    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe('FEATURE_DEVICE_UNAVAILABLE');
    expect(result.capabilities).not.toContain('videoContent');
  });

  it('defers a browser-decided device requirement to the player with its fallback', () => {
    const result = resolveCapabilities(input(['basicPanorama', 'gyroscope'], {
      // No device requirements are declared available at compile time.
      availableDeviceRequirements: [],
      configuration: { motionNavigationRequested: true },
    }));

    expect(result.valid).toBe(true);
    expect(result.capabilities).toContain('gyroscope');
    expect(result.deferredDeviceCapabilities).toEqual([{
      capabilityId: 'gyroscope',
      deviceRequirements: ['device-orientation'],
      fallbackMessage: 'Standard touch and pointer navigation will be used.',
      alternatives: ['Use standard navigation'],
    }]);
  });
});

describe('capability resolver — incompatibilities', () => {
  it('resolves the gallery / fixed-quality combination instead of emitting it', () => {
    const result = resolveCapabilities(input(['sceneNavigation', 'gallery', 'highResolution'], {
      availableMediaRequirements: ['ready-panorama', 'high-resolution-derivative'],
    }));

    // The creator-facing feature is kept; the conflicting quality mode is not.
    expect(result.capabilities).toContain('gallery');
    expect(result.capabilities).not.toContain('highResolution');
    expect(result.runtimeModules).not.toContain('resolution-selection');
    expect(result.valid).toBe(true);

    const issue = result.issues[0]!;
    expect(issue.code).toBe('FEATURE_FALLBACK_APPLIED');
    expect(issue.severity).toBe('warning');
    expect(issue.capabilityIds).toEqual(['gallery', 'highResolution']);
    expect(issue.alternatives).toContain('Use automatic quality selection');
    expect(result.fallbacks[0]?.reason).toBe('FEATURE_COMBINATION_UNAVAILABLE');
  });

  it('reports the combination as an error when fallbacks are not allowed', () => {
    const result = resolveCapabilities(input(['sceneNavigation', 'gallery', 'highResolution'], {
      availableMediaRequirements: ['ready-panorama', 'high-resolution-derivative'],
      fallbackMode: 'reject',
    }));

    expect(result.valid).toBe(false);
    expect(result.issues[0]).toMatchObject({
      code: 'FEATURE_COMBINATION_UNAVAILABLE',
      severity: 'error',
      capabilityIds: ['gallery', 'highResolution'],
    });
  });

  it('keeps optimized tiled quality available alongside the gallery', () => {
    const result = resolveCapabilities(input(['sceneNavigation', 'gallery', 'tiledPanorama'], {
      availableMediaRequirements: ['ready-panorama', 'tiled-panorama-derivatives'],
    }));

    expect(result.valid).toBe(true);
    expect(result.capabilities).toEqual(expect.arrayContaining(['gallery', 'tiledPanorama']));
    expect(result.issues).toEqual([]);
  });
});

describe('capability resolver — semantic configuration', () => {
  it('does not compile a compass that is not configured for the experience', () => {
    const result = resolveCapabilities(input(['basicPanorama', 'compass']));

    expect(result.capabilities).not.toContain('compass');
    expect(result.runtimeModules).not.toContain('compass');
    expect(result.issues[0]?.code).toBe('FEATURE_NOT_CONFIGURED');
  });

  it('compiles a compass that is configured', () => {
    const result = resolveCapabilities(input(['basicPanorama', 'compass'], {
      configuration: { compassEnabled: true },
    }));

    expect(result.valid).toBe(true);
    expect(result.capabilities).toContain('compass');
    expect(result.runtimeModules).toContain('compass');
  });

  it('compiles view limits only when the configured bounds are valid', () => {
    const valid = resolveCapabilities(input(['basicPanorama', 'viewLimits'], {
      configuration: { viewLimits: { minHeadingDegrees: -90, maxHeadingDegrees: 90 } },
    }));
    expect(valid.valid).toBe(true);
    expect(valid.capabilities).toContain('viewLimits');

    const inverted = resolveCapabilities(input(['basicPanorama', 'viewLimits'], {
      configuration: { viewLimits: { minPitchDegrees: 40, maxPitchDegrees: -40 } },
    }));
    expect(inverted.valid).toBe(false);
    expect(inverted.issues[0]?.code).toBe('FEATURE_CONFIGURATION_INVALID');
    expect(inverted.capabilities).not.toContain('viewLimits');

    const outOfRange = resolveCapabilities(input(['basicPanorama', 'viewLimits'], {
      configuration: { viewLimits: { minPitchDegrees: -120 } },
    }));
    expect(outOfRange.issues[0]?.code).toBe('FEATURE_CONFIGURATION_INVALID');

    const unconfigured = resolveCapabilities(input(['basicPanorama', 'viewLimits'], {
      configuration: { viewLimits: {} },
    }));
    expect(unconfigured.issues[0]?.code).toBe('FEATURE_NOT_CONFIGURED');
  });

  it('does not offer map or plan navigation without meaningful spatial data', () => {
    const result = resolveCapabilities(input(['sceneNavigation', 'map', 'plan'], {
      availableMediaRequirements: [
        'ready-panorama',
        'map-spatial-data',
        'plan-spatial-data',
        'ready-plan-asset',
      ],
      configuration: { mappedSceneCount: 0, planPositionedSceneCount: 0 },
    }));

    expect(result.capabilities).not.toContain('map');
    expect(result.capabilities).not.toContain('plan');
    expect(result.runtimeModules).not.toContain('map');
    expect(result.runtimeModules).not.toContain('plan');
    expect(result.issues.every((issue) => issue.code === 'FEATURE_FALLBACK_APPLIED')).toBe(true);
  });
});

describe('capability resolver — runtime module declarations', () => {
  it('omits every heavy module the experience does not use', () => {
    const result = resolveCapabilities(input(['basicPanorama', 'hotspots']));

    expect(result.runtimeModules).toEqual(['core-panorama', 'hotspots']);
    for (const unused of ['gallery', 'map', 'plan', 'stereo', 'gyroscope',
      'immersive-viewing', 'equirectangular-tiles', 'resolution-selection',
      'advanced-overlays', 'video-panorama']) {
      expect(result.runtimeModules).not.toContain(unused);
    }
  });

  it('marks optional modules lazy and core modules eager', () => {
    const result = resolveCapabilities(input(['basicPanorama', 'sceneNavigation', 'gallery', 'compass'], {
      configuration: { compassEnabled: true },
    }));

    const byId = new Map(result.moduleDeclarations.map((module) => [module.id, module]));
    expect(byId.get('core-panorama')?.load).toBe('eager');
    expect(byId.get('gallery')?.load).toBe('lazy');
    expect(byId.get('compass')?.load).toBe('lazy');
    expect(result.runtimeModules).toEqual(result.moduleDeclarations.map((module) => module.id));
  });

  it('declares one module once when several capabilities share it', () => {
    const result = resolveCapabilities(input(['basicPanorama', 'autorotation', 'viewLimits'], {
      configuration: { viewLimits: { minHeadingDegrees: -10, maxHeadingDegrees: 10 } },
    }));

    const core = result.moduleDeclarations.filter((module) => module.id === 'core-panorama');
    expect(core).toHaveLength(1);
    expect(core[0]?.capabilities).toEqual(
      expect.arrayContaining(['basicPanorama', 'autorotation', 'viewLimits']),
    );
  });
});

describe('capability resolver — product-facing output', () => {
  it('never leaks a renderer module name into a creator-facing message', () => {
    const rendererModules = new Set(CAPABILITY_DEFINITIONS.map(
      (definition) => definition.rendererModule,
    ));
    const results = [
      resolveCapabilities(input(['basicPanorama', 'tiledPanorama'])),
      resolveCapabilities(input(['sceneNavigation', 'gallery', 'highResolution'], {
        availableMediaRequirements: ['ready-panorama', 'high-resolution-derivative'],
        fallbackMode: 'reject',
      })),
      resolveCapabilities(input(['basicPanorama', 'compass'])),
      resolveCapabilities({
        projectId: 'project-1',
        requestedCapabilities: ['basicPanorama'],
        availableMediaRequirements: [],
      }),
    ];

    for (const result of results) {
      for (const issue of result.issues) {
        const text = `${issue.message} ${issue.alternatives.join(' ')}`;
        for (const rendererModule of rendererModules) {
          expect(text).not.toContain(rendererModule);
        }
        expect(text).not.toMatch(/plugin|adapter|Photo Sphere|PSV|three\.js/i);
      }
    }
  });

  it('is deterministic in registry order regardless of request order', () => {
    const requested: CapabilityId[] = ['gallery', 'hotspots', 'basicPanorama', 'sceneNavigation'];
    const forward = resolveCapabilities(input(requested));
    const reversed = resolveCapabilities(input([...requested].reverse()));

    expect(forward.capabilities).toEqual(reversed.capabilities);
    expect(forward.runtimeModules).toEqual(reversed.runtimeModules);
    const order = forward.capabilities.map((id) => CAPABILITY_IDS.indexOf(id));
    expect(order).toEqual([...order].sort((left, right) => left - right));
  });

  it('exposes the same resolution through the class wrapper', () => {
    const request = input(['basicPanorama', 'hotspots']);
    expect(new CapabilityResolver().resolve(request)).toEqual(resolveCapabilities(request));
  });

  it('fails safely and without registry detail when the registry is inconsistent', () => {
    const broken = {
      ...CAPABILITY_REGISTRY,
      gallery: { ...CAPABILITY_REGISTRY.gallery, incompatibilities: [] },
    };

    const result = resolveCapabilities(input(['basicPanorama']), broken);

    expect(result.valid).toBe(false);
    expect(result.capabilities).toEqual([]);
    expect(result.runtimeModules).toEqual([]);
    expect(result.issues[0]?.message).not.toContain('gallery');
  });
});
