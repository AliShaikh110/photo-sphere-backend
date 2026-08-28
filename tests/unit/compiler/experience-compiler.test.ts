import { describe, expect, it } from 'vitest';

import {
  ExperienceCompilationError,
  ExperienceCompiler,
} from '@alishaikh110/experience-compiler';
import type {
  CompiledImageExperienceManifest,
  CompileExperienceInput,
} from '@alishaikh110/experience-compiler';
import { isImageExperienceManifest } from '@alishaikh110/experience-compiler';
import type { CanonicalOverlay } from '@alishaikh110/experience-schema';
import { compileFailure } from './compile-failure';
import { derivative, canonicalProject, panoramaAsset } from './fixtures';
import { PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION } from '@alishaikh110/viewer-integration';
import { COMPILED_MANIFEST_VERSION } from '@alishaikh110/experience-compiler';

function compilerInput(
  overrides: Partial<CompileExperienceInput> = {},
): CompileExperienceInput {
  return {
    project: canonicalProject(),
    assets: [panoramaAsset({
      derivatives: [
        derivative('asset-panorama', 'thumbnail'),
        derivative('asset-panorama', 'lowResolutionBase', 1),
        derivative('asset-panorama', 'lowResolutionBase', 2),
        derivative('asset-panorama', 'standardWeb', 1),
        derivative('asset-panorama', 'standardWeb', 2),
      ],
    })],
    target: 'preview',
    ...overrides,
  };
}

function createCompiler(): ExperienceCompiler {
  return new ExperienceCompiler({
    viewerIntegrationVersion: PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION,
    mediaDeliveryPolicy: {
      protectedUrlTemplate: '/media/protected/{derivativeId}',
      publicUrlTemplate: '/media/public/{derivativeId}',
    },
  });
}

/** Every media reference the compiler emitted, wherever it sits in the output. */
function mediaReferences(value: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (candidate === null || typeof candidate !== 'object') return;
    const object = candidate as Record<string, unknown>;
    if (typeof object.derivativeId === 'string' && typeof object.url === 'string') {
      found.push(object);
    }
    Object.values(object).forEach(visit);
  };
  visit(value);
  return found;
}

function expectImageManifest(
  manifest: Awaited<ReturnType<ExperienceCompiler['compile']>>,
): CompiledImageExperienceManifest {
  if (!isImageExperienceManifest(manifest)) {
    throw new Error('Expected an image360 manifest.');
  }
  return manifest;
}

describe('Experience compiler', () => {
  it('compiles deterministic protected previews through the shared adapter path', async () => {
    const compiler = createCompiler();
    const input = compilerInput();

    const first = expectImageManifest(compiler.compile(input));
    const second = compiler.compile(input);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      manifestVersion: COMPILED_MANIFEST_VERSION,
      experienceType: 'image360',
      schemaVersion: 1,
      experienceId: 'project-1',
      projectRevision: 7,
      publicationRevision: null,
      target: 'preview',
      visibility: 'private',
      viewerIntegrationVersion: PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION,
      initialSceneId: 'scene-1',
      capabilities: expect.arrayContaining([
        expect.objectContaining({ id: 'basicPanorama', required: true }),
        expect.objectContaining({ id: 'hotspots' }),
      ]),
      telemetry: expect.objectContaining({
        experienceId: 'project-1',
        viewerIntegrationVersion: PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION,
      }),
    });
    expect(first.scenes[0]!.panorama.base).toMatchObject({
      kind: 'lowResolutionBase',
      version: 2,
      access: 'protected',
    });
    expect(first.scenes[0]!.panorama.primary).toMatchObject({
      kind: 'standardWeb',
      version: 2,
      access: 'protected',
    });
    expect(first.scenes[0]!.hotspots[0]!.content?.bodyHtml).toBe('<p>Safe</p>');
    expect(first.settings.information?.bodyHtml).toBe('<p>Welcome </p>');
    expect(first.branding.welcomeMessage).not.toContain('onerror');
    expect(mediaReferences(first).every((reference) => reference.access === 'protected')).toBe(true);
    expect(JSON.stringify(first)).not.toContain('private/asset-panorama');
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('uses public media only for public publications', async () => {
    const published = createCompiler().compile(compilerInput({
      target: 'publication',
      publicationRevision: 3,
      visibility: 'public',
      publicationSlug: 'museum-tour',
    }));
    expect(published.publicationRevision).toBe(3);
    expect(published.visibility).toBe('public');
    expect(mediaReferences(published).every((reference) => reference.access === 'public')).toBe(true);

    const privateManifest = createCompiler().compile(compilerInput({
      target: 'publication',
      publicationRevision: 4,
      visibility: 'private',
      publicationSlug: 'museum-tour',
    }));
    expect(privateManifest.visibility).toBe('private');
    expect(mediaReferences(privateManifest).every((reference) => reference.access === 'protected')).toBe(true);
  });

  it('resolves ready transparent branding media without assuming a panorama MIME type', async () => {
    const project = canonicalProject({
      branding: { logoAssetId: 'asset-logo', companyName: 'Transparent Brand' },
    });
    const logoDerivative = derivative('asset-logo', 'standardWeb', 1, {
      storageKey: 'private/asset-logo/standardWeb/v1.png',
      mimeType: 'image/png',
      width: 512,
      height: 256,
    });
    const manifest = createCompiler().compile(compilerInput({
      project,
      assets: [
        panoramaAsset(),
        {
          id: 'asset-logo',
          ownerId: 'owner-1',
          projectId: 'project-1',
          mediaType: 'logo',
          projection: 'unknown',
          processingStatus: 'ready',
          metadata: { hasAlpha: true },
          derivatives: [logoDerivative],
        },
      ],
    }));

    expect(manifest.branding.logo).toMatchObject({
      assetId: 'asset-logo',
      derivativeId: logoDerivative.id,
      mimeType: 'image/png',
      access: 'protected',
    });
    expect(manifest.branding.logo?.url).toBe(`/media/protected/${logoDerivative.id}`);
  });

  it('turns a tilted capture pose into a straighten correction the renderer applies', async () => {
    const tilted = panoramaAsset({
      metadata: {
        width: 4096,
        height: 2048,
        xmp: {
          poseHeadingDegrees: 30,
          posePitchDegrees: -4.5,
          poseRollDegrees: 2,
        },
      },
    });
    const manifest = expectImageManifest(
      createCompiler().compile(compilerInput({ assets: [tilted] })),
    );

    expect(manifest.scenes[0]!.panorama.sphereCorrection).toEqual({
      headingDegrees: 30,
      pitchDegrees: -4.5,
      rollDegrees: 2,
    });
    // The renderer receives the inverse, in radians: applying it puts the
    // horizon back where a visitor expects it.
    const startup = (manifest.viewerIntegration.config as {
      startup: { sphereCorrection: { pan: number; tilt: number; roll: number } };
    }).startup;
    expect(startup.sphereCorrection.pan).toBeCloseTo(-Math.PI / 6, 10);
    expect(startup.sphereCorrection.tilt).toBeCloseTo((4.5 * Math.PI) / 180, 10);
    expect(startup.sphereCorrection.roll).toBeCloseTo((-2 * Math.PI) / 180, 10);
  });

  it('omits a correction for a level panorama and normalises an equivalent pose', async () => {
    const level = panoramaAsset({
      metadata: { xmp: { poseHeadingDegrees: 360, posePitchDegrees: 0 } },
    });
    const manifest = expectImageManifest(
      createCompiler().compile(compilerInput({ assets: [level] })),
    );
    expect(manifest.scenes[0]!.panorama.sphereCorrection).toBeUndefined();
    expect(manifest.viewerIntegration.config).not.toHaveProperty('startup.sphereCorrection');
  });

  it('falls back to the captured initial view only when the scene has no framing', async () => {
    const framed = panoramaAsset({
      metadata: {
        xmp: {
          initialViewHeadingDegrees: 210,
          initialViewPitchDegrees: 12,
          initialViewFovDegrees: 65,
        },
      },
    });
    const unframedScene = canonicalProject({
      scenes: [{ ...canonicalProject().scenes[0]!, initialView: {} }],
    });
    const captured = expectImageManifest(createCompiler().compile(compilerInput({
      project: unframedScene,
      assets: [framed],
    })));
    expect(captured.scenes[0]!.initialView).toEqual({
      headingDegrees: -150,
      pitchDegrees: 12,
      horizontalFovDegrees: 65,
    });

    // An authored framing is the creator's decision and always wins.
    const authored = expectImageManifest(createCompiler().compile(compilerInput({
      assets: [framed],
    })));
    expect(authored.scenes[0]!.initialView).toEqual({
      headingDegrees: 90,
      pitchDegrees: -15,
      horizontalFovDegrees: 80,
    });
  });

  it('carries cropped GPano geometry through the product manifest and renderer adapter', async () => {
    const croppedAsset = panoramaAsset({
      projection: 'cropped_equirectangular',
      metadata: {
        width: 4096,
        height: 2048,
        xmp: {
          fullPanoWidthPixels: 8192,
          fullPanoHeightPixels: 4096,
          croppedAreaImageWidthPixels: 4096,
          croppedAreaImageHeightPixels: 2048,
          croppedAreaLeftPixels: 2048,
          croppedAreaTopPixels: 1024,
        },
      },
      derivatives: [
        derivative('asset-panorama', 'thumbnail'),
        derivative('asset-panorama', 'lowResolutionBase'),
        derivative('asset-panorama', 'standardWeb'),
      ],
    });
    const manifest = expectImageManifest(
      createCompiler().compile(compilerInput({ assets: [croppedAsset] })),
    );

    expect(manifest.scenes[0]!.panorama.crop).toEqual({
      fullWidthPixels: 8192,
      fullHeightPixels: 4096,
      croppedWidthPixels: 4096,
      croppedHeightPixels: 2048,
      croppedLeftPixels: 2048,
      croppedTopPixels: 1024,
    });
    expect(manifest.viewerIntegration.config).toMatchObject({
      startup: {
        panoData: {
          fullWidth: 8192,
          fullHeight: 4096,
          croppedWidth: 4096,
          croppedHeight: 2048,
          croppedX: 2048,
          croppedY: 1024,
        },
      },
    });
  });

  it('blocks unsupported forward-compatible scene bags before runtime compilation', async () => {
    const project = canonicalProject();
    const scene = project.scenes[0]!;
    const unsafeProject = canonicalProject({
      scenes: [{
        ...scene,
        // Deliberately not a canonical overlay: the compiler must reject an
        // unrecognized bag rather than pass it through to the renderer.
        overlays: [{ html: '<img src=x onerror=steal()>' } as unknown as CanonicalOverlay],
      }],
    });

    expect(compileFailure(() => createCompiler().compile(compilerInput({ project: unsafeProject })))).toMatchObject({
        code: 'EXPERIENCE_COMPILATION_FAILED',
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: 'INVALID_FIELD',
            path: 'scenes[0].overlays[0].geometry',
          }),
          expect.objectContaining({
            code: 'INVALID_FIELD',
            path: 'scenes[0].overlays[0].action',
          }),
        ]),
      });
  });

  it('rejects missing baseline derivatives before resolving any URL', async () => {
    const compiler = createCompiler();
    const asset = panoramaAsset({
      derivatives: [derivative('asset-panorama', 'standardWeb')],
    });

    expect(compileFailure(() => compiler.compile(compilerInput({ assets: [asset] })))).toMatchObject({
      code: 'EXPERIENCE_COMPILATION_FAILED',
      issues: [expect.objectContaining({
        code: 'REQUIRED_DERIVATIVE_MISSING',
        entityId: 'scene-1',
        path: 'scenes[0].panoramaAssetId',
        retryable: true,
      })],
    });

  });

  it('rejects publication without a revision using an actionable project path', async () => {
    expect(() => createCompiler().compile(compilerInput({
      target: 'publication',
      visibility: 'public',
    }))).toThrow(ExperienceCompilationError);
    try {
      createCompiler().compile(compilerInput({ target: 'publication' }));
    } catch (error) {
      expect(error).toMatchObject({
        issues: expect.arrayContaining([expect.objectContaining({
          code: 'INVALID_FIELD',
          path: 'publicationRevision',
        })]),
      });
    }
  });

  it('fails closed when the delivery policy produces an unsafe URL', () => {
    const compiler = new ExperienceCompiler({
      mediaDeliveryPolicy: {
        protectedUrlTemplate: 'javascript:alert(1)',
        publicUrlTemplate: 'javascript:alert(1)',
      },
      viewerIntegrationVersion: PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION,
    });
    expect(compileFailure(() => compiler.compile(compilerInput()))).toMatchObject({
      code: 'EXPERIENCE_COMPILATION_FAILED',
      issues: [expect.objectContaining({ code: 'MEDIA_URL_INVALID' })],
    });
  });
});
