import { describe, expect, it } from 'vitest';

import { validateCanonicalProject } from '@sphere/experience-schema';
import { canonicalProject, panoramaAsset } from '../compiler/fixtures';

describe('canonical Experience validation', () => {
  it('accepts the renderer-independent HTTP canonical shape', () => {
    const validation = validateCanonicalProject(canonicalProject(), {
      assets: [panoramaAsset()],
      supportedProjectTypes: ['image360'],
    });

    expect(validation).toEqual({ valid: true, issues: [] });
  });

  it('returns actionable entity/path issues for unsafe hotspot URLs', () => {
    const project = canonicalProject();
    const hotspot = project.scenes[0]!.hotspots[0]!;
    const invalid = canonicalProject({
      scenes: [{
        ...project.scenes[0]!,
        hotspots: [{ ...hotspot, action: { kind: 'openUrl', url: 'javascript:alert(1)' } }],
      }],
    });

    expect(validateCanonicalProject(invalid, { assets: [panoramaAsset()] }).issues).toContainEqual({
      code: 'INVALID_URL',
      message: 'Only HTTPS URLs are allowed.',
      entityType: 'hotspot',
      entityId: 'hotspot-1',
      path: 'scenes[0].hotspots[0].action.url',
      retryable: false,
    });
  });

  it('reports missing scene references at the author-fixable action path', () => {
    const project = canonicalProject();
    const hotspot = project.scenes[0]!.hotspots[0]!;
    const invalid = canonicalProject({
      scenes: [{
        ...project.scenes[0]!,
        hotspots: [{ ...hotspot, action: { kind: 'goToScene', sceneId: 'missing-scene' } }],
      }],
    });

    expect(validateCanonicalProject(invalid).issues).toContainEqual(expect.objectContaining({
      code: 'REFERENCE_NOT_FOUND',
      entityId: 'hotspot-1',
      path: 'scenes[0].hotspots[0].action.sceneId',
    }));
  });

  it('distinguishes retryable non-ready assets from forbidden asset references', () => {
    const notReady = panoramaAsset({ processingStatus: 'processing' });
    const processingIssues = validateCanonicalProject(canonicalProject(), {
      assets: [notReady],
    }).issues;
    expect(processingIssues).toContainEqual(expect.objectContaining({
      code: 'ASSET_NOT_READY',
      path: 'scenes[0].panoramaAssetId',
      retryable: true,
    }));

    const foreign = panoramaAsset({ ownerId: 'someone-else' });
    expect(validateCanonicalProject(canonicalProject(), {
      assets: [foreign],
    }).issues).toContainEqual(expect.objectContaining({
      code: 'REFERENCE_FORBIDDEN',
      path: 'scenes[0].panoramaAssetId',
      retryable: false,
    }));
  });

  it('rejects raw renderer configuration anywhere in canonical data', () => {
    const project = canonicalProject({
      settings: {
        appearance: { theme: 'dark' },
        viewerConfig: { panorama: 'raw-origin-url' },
      },
    });

    expect(validateCanonicalProject(project).issues).toContainEqual(expect.objectContaining({
      code: 'RENDERER_CONFIG_FORBIDDEN',
      path: 'settings.viewerConfig',
    }));
  });

  it('validates the product coordinate discriminator and exact position path', () => {
    const project = canonicalProject();
    const hotspot = project.scenes[0]!.hotspots[0]!;
    const invalid = canonicalProject({
      scenes: [{
        ...project.scenes[0]!,
        hotspots: [{
          ...hotspot,
          position: {
            coordinateSystem: 'spherical_degrees',
            longitudeDegrees: 181,
            latitudeDegrees: 0,
          },
        }],
      }],
    });

    expect(validateCanonicalProject(invalid).issues).toContainEqual(expect.objectContaining({
      code: 'INVALID_FIELD',
      path: 'scenes[0].hotspots[0].position.longitudeDegrees',
    }));
  });
});

