import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  recordGoldenArtifact,
  serializeGoldenArtifact
} from '../../golden/record';
import { goldenScenarios } from '../../golden/scenarios';

const expectedDirectory = path.resolve(__dirname, '..', '..', 'golden', 'expected');

/**
 * The behaviour freeze.
 *
 * These fixtures were recorded from the compiler as it stood before it was
 * extracted into a shared package. A single differing byte means the
 * extraction changed what a customer's published experience looks like, and
 * the extraction — not the fixture — is what has to change.
 */
describe('golden manifest fixtures', () => {
  for (const scenario of goldenScenarios()) {
    it(`reproduces ${scenario.id} byte for byte`, async () => {
      const expected = readFileSync(
        path.join(expectedDirectory, `${scenario.id}.json`),
        'utf8'
      );
      const actual = serializeGoldenArtifact(await recordGoldenArtifact(scenario));
      if (actual !== expected) {
        // A whole manifest diff is unreadable; point at the first divergence.
        const divergence = [...actual].findIndex((character, index) => character !== expected[index]);
        const window = 200;
        expect
          .soft(actual.slice(Math.max(0, divergence - window), divergence + window))
          .toBe(expected.slice(Math.max(0, divergence - window), divergence + window));
      }
      expect(actual).toBe(expected);
    });
  }

  it('records the scenarios named by the behaviour freeze', () => {
    expect(goldenScenarios().map((scenario) => scenario.id)).toEqual([
      'image360-single-scene',
      'image360-single-scene-preview',
      'image360-multi-scene-tour',
      'image360-cropped-with-pose-correction',
      'image360-gallery',
      'image360-private-publication',
      'image360-tiled-high-resolution',
      'image360-hotspots-and-content',
      'image360-map-and-plan',
      'image360-overlays-and-layers',
      'image360-capability-fallback',
      'image360-large-progressive-tour',
      'video360-timeline',
      'video360-multiple-playback-profiles',
      'image360-rejected-validation'
    ]);
  });

  it('never emits a credential or an expiring URL', async () => {
    for (const scenario of goldenScenarios()) {
      const serialized = serializeGoldenArtifact(await recordGoldenArtifact(scenario));
      expect(serialized).not.toContain('token=');
      expect(serialized).not.toContain('expiresAt');
      expect(serialized).not.toContain('signature=');
    }
  });
});
