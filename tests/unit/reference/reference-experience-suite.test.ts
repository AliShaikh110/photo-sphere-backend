import { describe, expect, it } from 'vitest';

import {
  PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION
} from '@alishaikh110/viewer-integration';
import {
  listViewerIntegrationVersions
} from '@alishaikh110/viewer-integration';
import { referenceExperiences, runReferenceExperienceSuite } from '../../../apps/api/src/reference';

/**
 * Sprint 04 §20 makes this suite the promotion gate for a viewer integration
 * version: an adapter that cannot compile the reference set must never become
 * the version customer publications are built against. Nothing enforced that
 * until it ran here.
 */
describe('Reference experience suite', () => {
  it('covers every scenario the architecture requires of a renderer upgrade', () => {
    const ids = referenceExperiences().map((experience) => experience.id);

    expect(ids).toEqual(expect.arrayContaining([
      'basic-panorama',
      'cropped-panorama',
      'high-resolution-panorama',
      'multi-scene-tour',
      'large-tour',
      'gallery',
      'hotspots',
      'map-and-plan',
      'gyroscope-stereo-fallback',
      'video-360',
      'advanced-overlay',
      'media-layer',
      'private-embed'
    ]));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('passes for the active viewer integration version', async () => {
    const result = await runReferenceExperienceSuite(PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION);

    // Name the failures rather than asserting a bare boolean, so a regression
    // reports which scenario and which expectation broke.
    const failures = result.results
      .filter((scenario) => !scenario.passed)
      .map((scenario) => ({
        id: scenario.experienceId,
        failureCode: scenario.failureCode,
        failureMessage: scenario.failureMessage,
        failedExpectations: scenario.expectations
          .filter((expectation) => !expectation.passed)
          .map((expectation) => expectation.id)
      }));

    expect(failures).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.failedCount).toBe(0);
    expect(result.passedCount).toBe(result.totalCount);
  }, 60_000);

  it('compiles every registered integration version, not only the active one', async () => {
    const versions = listViewerIntegrationVersions();
    expect(versions.length).toBeGreaterThan(0);

    for (const registration of versions) {
      const result = await runReferenceExperienceSuite(registration.version);
      expect(
        result.results.filter((scenario) => !scenario.passed).map((scenario) => scenario.experienceId),
        `reference suite failed for ${registration.version}`
      ).toEqual([]);
    }
  }, 120_000);

  it('rejects a viewer integration version that has no registered adapter', async () => {
    await expect(runReferenceExperienceSuite('psv-does-not-exist')).rejects.toThrow(
      /Unsupported viewer integration version/
    );
  });

  it('keeps the initial manifest lightweight as a tour scales to 120 scenes', async () => {
    const result = await runReferenceExperienceSuite(PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION);
    const large = result.results.find((scenario) => scenario.experienceId === 'large-tour')!;
    const small = result.results.find((scenario) => scenario.experienceId === 'multi-scene-tour')!;

    expect(large.passed).toBe(true);
    expect(small.passed).toBe(true);
    expect(large.sceneDefinitionCount).toBe(120);
    expect(small.sceneDefinitionCount).toBe(4);

    // The point of progressive delivery: 30x the scenes must not cost 30x the
    // startup manifest, because only a lightweight index ships up front.
    const largePerScene = large.manifestBytes / large.sceneDefinitionCount;
    const smallPerScene = small.manifestBytes / small.sceneDefinitionCount;
    expect(largePerScene).toBeLessThan(smallPerScene);
    expect(large.manifestBytes).toBeLessThan(small.manifestBytes * 10);
  }, 60_000);
});
