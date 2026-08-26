import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PANORAMA_TILING_POLICY,
  PANORAMA_TILING_POLICY_VERSION,
  resolvePanoramaTilingPolicy,
} from '../../../src/media/panorama-quality-policy';
import type { PanoramaTilingPolicyInput } from '../../../src/media/panorama-quality-policy';

function panorama(overrides: Partial<PanoramaTilingPolicyInput> = {}): PanoramaTilingPolicyInput {
  return {
    width: 8192,
    height: 4096,
    sizeBytes: 5 * 1024 * 1024,
    projection: 'equirectangular',
    ...overrides,
  };
}

describe('panorama tiling policy', () => {
  it('qualifies a large panorama on its source width alone', () => {
    const decision = resolvePanoramaTilingPolicy(panorama());

    expect(decision.generateTiles).toBe(true);
    expect(decision.reason).toBe('qualified');
    expect(decision.triggeredBy).toEqual(['source-width']);
    expect(decision.policyVersion).toBe(PANORAMA_TILING_POLICY_VERSION);
  });

  it('qualifies a smaller but unusually heavy panorama on its encoded size', () => {
    const decision = resolvePanoramaTilingPolicy(panorama({
      width: 5000,
      height: 2500,
      sizeBytes: 20 * 1024 * 1024,
    }));

    expect(decision.generateTiles).toBe(true);
    expect(decision.triggeredBy).toEqual(['source-size']);
  });

  it('records both triggers when a panorama is large and heavy', () => {
    const decision = resolvePanoramaTilingPolicy(panorama({
      width: 16_384,
      height: 8192,
      sizeBytes: 60 * 1024 * 1024,
    }));

    expect(decision.triggeredBy).toEqual(['source-width', 'source-size']);
  });

  it('does not tile a panorama inside the ordinary web-derivative range', () => {
    const decision = resolvePanoramaTilingPolicy(panorama({
      width: DEFAULT_PANORAMA_TILING_POLICY.minimumLevelWidth,
      height: 2048,
      sizeBytes: 40 * 1024 * 1024,
    }));

    expect(decision.generateTiles).toBe(false);
    expect(decision.reason).toBe('below-high-detail-range');
    expect(decision.levelWidths).toEqual([]);
  });

  it('does not tile a panorama that meets no trigger', () => {
    const decision = resolvePanoramaTilingPolicy(panorama({
      width: 5000,
      height: 2500,
      sizeBytes: 1024,
    }));

    expect(decision.generateTiles).toBe(false);
    expect(decision.reason).toBe('below-trigger');
  });

  it('orders levels from lowest detail to source detail and bounds their count', () => {
    const decision = resolvePanoramaTilingPolicy(panorama({
      width: 65_536,
      height: 32_768,
      sizeBytes: 200 * 1024 * 1024,
    }));

    expect(decision.levelWidths.length)
      .toBeLessThanOrEqual(DEFAULT_PANORAMA_TILING_POLICY.maximumLevels);
    expect(decision.levelWidths).toEqual([...decision.levelWidths].sort((a, b) => a - b));
    expect(decision.levelWidths.at(-1)).toBe(65_536);
    for (const width of decision.levelWidths) {
      expect(width).toBeGreaterThan(DEFAULT_PANORAMA_TILING_POLICY.minimumLevelWidth);
    }
  });

  it('is policy-driven and can be turned off without touching the pipeline', () => {
    const decision = resolvePanoramaTilingPolicy(panorama(), {
      ...DEFAULT_PANORAMA_TILING_POLICY,
      enabled: false,
    });

    expect(decision.generateTiles).toBe(false);
    expect(decision.reason).toBe('disabled');
  });

  it('applies a narrower configured trigger', () => {
    const eager = { ...DEFAULT_PANORAMA_TILING_POLICY, minimumSourceWidth: 4_500 };
    const input = panorama({ width: 5000, height: 2500, sizeBytes: 1024 });

    expect(resolvePanoramaTilingPolicy(input).generateTiles).toBe(false);
    expect(resolvePanoramaTilingPolicy(input, eager).generateTiles).toBe(true);
  });

  it('is deterministic, so a retried job reaches the same decision', () => {
    const input = panorama({ width: 12_000, height: 6000, sizeBytes: 30 * 1024 * 1024 });

    expect(resolvePanoramaTilingPolicy(input)).toEqual(resolvePanoramaTilingPolicy(input));
  });

  it('rejects unusable dimensions or policy values instead of guessing', () => {
    expect(() => resolvePanoramaTilingPolicy(panorama({ width: 0 }))).toThrow(TypeError);
    expect(() => resolvePanoramaTilingPolicy(panorama({ sizeBytes: -1 }))).toThrow(TypeError);
    expect(() => resolvePanoramaTilingPolicy(panorama(), {
      ...DEFAULT_PANORAMA_TILING_POLICY,
      tileSize: 0,
    })).toThrow(TypeError);
    expect(() => resolvePanoramaTilingPolicy(panorama(), {
      ...DEFAULT_PANORAMA_TILING_POLICY,
      tileQuality: 101,
    })).toThrow(TypeError);
  });
});
