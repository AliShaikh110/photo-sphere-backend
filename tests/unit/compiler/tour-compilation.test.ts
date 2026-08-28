import { describe, expect, it, vi } from 'vitest';

import { ExperienceCompiler } from '../../../apps/api/src/compiler/experience-compiler';
import { PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION } from '../../../apps/api/src/compiler/viewer-integration-adapter';
import { isImageExperienceManifest } from '../../../apps/api/src/compiler/types';
import type {
  CompiledExperienceBundle,
  CompiledImageExperienceManifest,
  CompileExperienceInput,
  MediaUrlResolutionRequest,
} from '../../../apps/api/src/compiler/types';
import { createTourStrategyPolicy } from '../../../apps/api/src/runtime/tour-strategy';
import type { CanonicalProject } from '../../../apps/api/src/domain/types';
import {
  derivative,
  panoramaAsset,
  tiledPanoramaAsset,
  tourProject,
} from './fixtures';

function createCompiler(
  overrides: Partial<ConstructorParameters<typeof ExperienceCompiler>[0]> = {},
): ExperienceCompiler {
  return new ExperienceCompiler({
    viewerIntegrationVersion: PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION,
    mediaUrlResolver: {
      resolve: vi.fn((request: MediaUrlResolutionRequest) => `/media/${request.derivative.id}`),
    },
    ...overrides,
  });
}

function publicationInput(
  project: CanonicalProject,
  overrides: Partial<CompileExperienceInput> = {},
): CompileExperienceInput {
  return {
    project,
    assets: [panoramaAsset()],
    target: 'publication',
    publicationRevision: 1,
    publicationSlug: 'museum-tour',
    ...overrides,
  };
}

function imageManifest(bundle: CompiledExperienceBundle): CompiledImageExperienceManifest {
  if (!isImageExperienceManifest(bundle.manifest)) {
    throw new Error('Expected an image360 manifest.');
  }
  return bundle.manifest;
}

describe('tour compilation — delivery strategy', () => {
  it('compiles a small tour with every scene definition inline', async () => {
    const bundle = await createCompiler().compileBundle(publicationInput(tourProject(3)));
    const manifest = imageManifest(bundle);

    expect(manifest.tour.strategy).toBe('embedded');
    expect(manifest.scenes).toHaveLength(3);
    expect(manifest.tour.sceneIndex).toHaveLength(3);
    expect(manifest.tour.sceneCount).toBe(3);
    expect(manifest.tour.sceneDefinitionUrlTemplate).toBeUndefined();
    // Published scene definitions still exist so any scene stays addressable.
    expect(bundle.sceneDefinitions).toHaveLength(3);
  });

  it('compiles a large tour to an entry scene plus a lightweight index', async () => {
    const compiler = createCompiler({
      tourStrategyPolicy: createTourStrategyPolicy({ maxInlineSceneCount: 3 }),
    });

    const bundle = await compiler.compileBundle(publicationInput(tourProject(8)));
    const manifest = imageManifest(bundle);

    expect(manifest.tour.strategy).toBe('progressive');
    expect(manifest.scenes).toHaveLength(1);
    expect(manifest.scenes[0]?.id).toBe(manifest.initialSceneId);
    // The index names every scene without carrying any scene body.
    expect(manifest.tour.sceneIndex).toHaveLength(8);
    expect(manifest.tour.sceneCount).toBe(8);
    expect(manifest.tour.sceneDefinitionUrlTemplate)
      .toBe('/view/museum-tour/revisions/1/scenes/{sceneId}');
    expect(manifest.tour.sceneIndexUrl).toBe('/view/museum-tour/revisions/1/scene-index');
    // Every scene is still published, just fetched on demand.
    expect(bundle.sceneDefinitions).toHaveLength(8);
    expect(bundle.sceneIndex).toHaveLength(8);
  });

  it('keeps the index free of hotspots, overlays and panorama bodies', async () => {
    const compiler = createCompiler({
      tourStrategyPolicy: createTourStrategyPolicy({ maxInlineSceneCount: 1 }),
    });

    const manifest = imageManifest(await compiler.compileBundle(publicationInput(tourProject(4))));

    for (const entry of manifest.tour.sceneIndex) {
      expect(Object.keys(entry).sort()).toEqual([
        'connectionTargetSceneIds',
        'hasHotspots',
        'hasOverlays',
        'id',
        'isPrimary',
        'name',
        'panoramaAssetId',
        'sortOrder',
        'thumbnail',
      ]);
    }
  });

  it('does not let the initial manifest grow with the full detail of every scene', async () => {
    const compiler = createCompiler({
      tourStrategyPolicy: createTourStrategyPolicy({ maxInlineSceneCount: 4 }),
    });

    const small = imageManifest(await compiler.compileBundle(publicationInput(tourProject(4))));
    const large = imageManifest(await compiler.compileBundle(publicationInput(tourProject(40))));

    const smallBytes = Buffer.byteLength(JSON.stringify(small));
    const largeBytes = Buffer.byteLength(JSON.stringify(large));
    const inlineSceneBytes = Buffer.byteLength(JSON.stringify(small.scenes));

    expect(large.tour.strategy).toBe('progressive');
    // Ten times the scenes must not cost ten times the manifest.
    expect(largeBytes).toBeLessThan(smallBytes * 4);
    // The growth comes from the index, not from inlined scene bodies.
    expect(Buffer.byteLength(JSON.stringify(large.scenes)))
      .toBeLessThanOrEqual(inlineSceneBytes);
  });

  it('keeps the draft preview on the shared compiler path', async () => {
    const compiler = createCompiler({
      tourStrategyPolicy: createTourStrategyPolicy({ maxInlineSceneCount: 1 }),
    });

    const preview = imageManifest(await compiler.compileBundle({
      project: tourProject(4),
      assets: [panoramaAsset()],
      target: 'preview',
    }));

    expect(preview.target).toBe('preview');
    expect(preview.publicationRevision).toBeNull();
    // A draft has no published revision to fetch scenes from.
    expect(preview.tour.sceneDefinitionUrlTemplate).toBeUndefined();
    expect(preview.tour.sceneIndex).toHaveLength(4);
  });
});

describe('tour compilation — preload and cache hints', () => {
  it('names only likely adjacent scenes, never the whole tour', async () => {
    const manifest = imageManifest(
      await createCompiler().compileBundle(publicationInput(tourProject(6))),
    );

    expect(manifest.runtime.preload.strategy).toBe('selective-adjacent');
    expect(manifest.runtime.preload.maxScenesPerSource).toBeLessThanOrEqual(2);
    expect(manifest.runtime.preload.content).toBe('scene-definition-and-base-media');
    for (const scene of manifest.scenes) {
      expect(scene.preloadSceneIds.length).toBeLessThanOrEqual(2);
      expect(scene.preloadSceneIds).not.toContain(scene.id);
    }
    // The chain scene-1 -> scene-2 -> ... only ever preloads the next room.
    expect(manifest.scenes[0]?.preloadSceneIds).toEqual(['scene-2']);
    expect(manifest.scenes.at(-1)?.preloadSceneIds).toEqual([]);
  });

  it('promotes a creator preload hint without unbounding the budget', async () => {
    const project = tourProject(4);
    const hinted: CanonicalProject = {
      ...project,
      scenes: project.scenes.map((scene, index) => (index === 0
        ? {
          ...scene,
          connections: [
            { id: 'c-a', sourceSceneId: scene.id, targetSceneId: 'scene-2', importance: 10 },
            { id: 'c-b', sourceSceneId: scene.id, targetSceneId: 'scene-3', importance: 10 },
            { id: 'c-c', sourceSceneId: scene.id, targetSceneId: 'scene-4', importance: 10 },
          ],
          runtimeHints: { likelyNextSceneIds: ['scene-4'] },
        }
        : scene)),
    };

    const manifest = imageManifest(
      await createCompiler().compileBundle(publicationInput(hinted)),
    );

    const preloads = manifest.scenes[0]!.preloadSceneIds;
    expect(preloads[0]).toBe('scene-4');
    expect(preloads).toHaveLength(2);
  });

  it('compiles a bounded, versioned cache contract for every device profile', async () => {
    const manifest = imageManifest(
      await createCompiler().compileBundle(publicationInput(tourProject(3))),
    );

    const cache = manifest.runtime.cache;
    expect(cache.defaultProfile).toBe('standard');
    for (const profile of Object.values(cache.profiles)) {
      expect(profile.maxRecentScenes).toBeGreaterThanOrEqual(1);
      expect(profile.maxRecentScenes).toBeLessThanOrEqual(8);
      expect(profile.maxEstimatedBytes).toBeGreaterThan(0);
      expect(profile.evictionStrategy).toBe('least-recently-used');
      expect(profile.suppressDuplicateRequests).toBe(true);
      expect(profile.policyVersion).toBeGreaterThanOrEqual(1);
    }
    expect(cache.profiles.constrained.maxEstimatedBytes)
      .toBeLessThan(cache.profiles.capable.maxEstimatedBytes);
  });
});

describe('tour compilation — quality policy', () => {
  it('delivers tiled detail over a low-resolution base when the derivatives exist', async () => {
    const bundle = await createCompiler().compileBundle(publicationInput(tourProject(2), {
      assets: [tiledPanoramaAsset()],
    }));
    const manifest = imageManifest(bundle);

    const scene = manifest.scenes[0]!;
    expect(scene.panorama.tiles).toBeDefined();
    expect(scene.panorama.tiles?.tileSize).toBe(512);
    expect(scene.panorama.tiles?.levels.map((level) => level.level)).toEqual([0, 1]);
    // The first meaningful view still comes from the small base image.
    expect(scene.panorama.base.derivativeId).toContain('lowResolutionBase');
    expect(manifest.capabilities.map((capability) => capability.id)).toContain('tiledPanorama');
    expect(manifest.runtime.modules).toContain('equirectangular-tiles');
  });

  it('falls back to the standard derivative when no tiled set was generated', async () => {
    const manifest = imageManifest(
      await createCompiler().compileBundle(publicationInput(tourProject(2))),
    );

    const scene = manifest.scenes[0]!;
    expect(scene.panorama.tiles).toBeUndefined();
    expect(scene.panorama.primary.derivativeId).toContain('standardWeb');
    expect(manifest.runtime.modules).not.toContain('equirectangular-tiles');
    expect(manifest.capabilities.map((capability) => capability.id)).not.toContain('tiledPanorama');
  });

  it('honours a scene that opts out of tiled delivery', async () => {
    const project = tourProject(2);
    const standard: CanonicalProject = {
      ...project,
      scenes: project.scenes.map((scene, index) => (index === 0
        ? { ...scene, runtimeHints: { qualityPreference: 'standard' as const } }
        : scene)),
    };

    const manifest = imageManifest(await createCompiler().compileBundle(
      publicationInput(standard, { assets: [tiledPanoramaAsset()] }),
    ));

    expect(manifest.scenes[0]?.panorama.tiles).toBeUndefined();
    expect(manifest.scenes[1]?.panorama.tiles).toBeDefined();
  });
});

describe('tour compilation — scene index media', () => {
  it('uses the dedicated thumbnail derivative rather than the panorama base', async () => {
    const manifest = imageManifest(
      await createCompiler().compileBundle(publicationInput(tourProject(3))),
    );

    for (const entry of manifest.tour.sceneIndex) {
      expect(entry.thumbnail.derivativeId).toBe('asset-panorama-thumbnail-1');
    }
    // The scene body keeps the larger base image for first render.
    expect(manifest.scenes[0]?.panorama.base.derivativeId).toBe('asset-panorama-lowResolutionBase-1');
    expect(manifest.tour.sceneIndex[0]?.thumbnail.derivativeId)
      .not.toBe(manifest.scenes[0]?.panorama.base.derivativeId);
  });

  it('serves the gallery from the same lightweight thumbnail', async () => {
    const project = tourProject(3);
    const manifest = imageManifest(await createCompiler().compileBundle(publicationInput({
      ...project,
      settings: { ...project.settings, gallery: { enabled: true } },
    })));

    const gallery = manifest.viewerIntegration.config.gallery as {
      items: { id: string; thumbnail?: string }[];
    };
    expect(gallery.items).toHaveLength(3);
    for (const item of gallery.items) {
      expect(item.thumbnail).toBe('/media/asset-panorama-thumbnail-1');
    }
  });

  it('falls back to the base image when the asset has no ready thumbnail', async () => {
    const withoutThumbnail = panoramaAsset({
      derivatives: [
        derivative('asset-panorama', 'lowResolutionBase'),
        derivative('asset-panorama', 'standardWeb'),
      ],
    });

    const manifest = imageManifest(await createCompiler().compileBundle(
      publicationInput(tourProject(2), { assets: [withoutThumbnail] }),
    ));

    expect(manifest.tour.sceneIndex[0]?.thumbnail.derivativeId)
      .toBe('asset-panorama-lowResolutionBase-1');
  });

  it('does not mix derivative generations inside one scene index', async () => {
    const reprocessed = panoramaAsset({
      derivatives: [
        derivative('asset-panorama', 'thumbnail', 1),
        derivative('asset-panorama', 'lowResolutionBase', 1),
        derivative('asset-panorama', 'standardWeb', 1),
        derivative('asset-panorama', 'thumbnail', 2),
        derivative('asset-panorama', 'lowResolutionBase', 2),
        derivative('asset-panorama', 'standardWeb', 2),
      ],
    });

    const manifest = imageManifest(await createCompiler().compileBundle(
      publicationInput(tourProject(2), { assets: [reprocessed] }),
    ));

    expect(manifest.tour.sceneIndex[0]?.thumbnail.derivativeId)
      .toBe('asset-panorama-thumbnail-2');
    expect(manifest.scenes[0]?.panorama.base.derivativeId)
      .toBe('asset-panorama-lowResolutionBase-2');
  });
});

describe('tour compilation — published scene definitions', () => {
  it('emits one immutable definition per scene, pinned to the publication revision', async () => {
    const bundle = await createCompiler().compileBundle(publicationInput(tourProject(3), {
      publicationRevision: 7,
    }));

    expect(bundle.sceneDefinitions).toHaveLength(3);
    for (const definition of bundle.sceneDefinitions) {
      expect(definition.publicationRevision).toBe(7);
      expect(definition.experienceId).toBe('project-1');
      expect(definition.viewerIntegrationVersion).toBe(PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION);
      expect(definition.viewerIntegration).toBeDefined();
    }
    expect(bundle.sceneDefinitions.map((definition) => definition.scene.id))
      .toEqual(['scene-1', 'scene-2', 'scene-3']);
    expect(Object.isFrozen(bundle)).toBe(true);
  });

  it('emits no published scene definitions for a draft preview', async () => {
    const bundle = await createCompiler().compileBundle({
      project: tourProject(3),
      assets: [panoramaAsset()],
      target: 'preview',
    });

    expect(bundle.sceneDefinitions).toEqual([]);
  });

  it('compiles the same input to the same output, so a revision is reproducible', async () => {
    const first = await createCompiler().compileBundle(publicationInput(tourProject(4)));
    const second = await createCompiler().compileBundle(publicationInput(tourProject(4)));

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('does not carry a later draft edit into an already-compiled revision', async () => {
    const compiler = createCompiler();
    const published = await compiler.compileBundle(publicationInput(tourProject(3)));

    const edited = tourProject(3);
    const renamed: CanonicalProject = {
      ...edited,
      revision: edited.revision + 1,
      scenes: edited.scenes.map((scene, index) => (index === 1
        ? { ...scene, name: 'Renamed after publish' }
        : scene)),
    };
    const republished = await compiler.compileBundle(publicationInput(renamed, {
      publicationRevision: 2,
    }));

    expect(published.sceneDefinitions[1]?.scene.name).toBe('Room 2');
    expect(republished.sceneDefinitions[1]?.scene.name).toBe('Renamed after publish');
    // The earlier bundle is frozen, so a draft edit cannot reach back into it.
    expect(Object.isFrozen(published.sceneDefinitions[1]?.scene)).toBe(true);
  });
});
