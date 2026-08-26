import { describe, expect, it } from 'vitest';

import {
  BoundedRuntimeCachePolicy,
  DEFAULT_RUNTIME_CACHE_POLICY,
  RUNTIME_CACHE_POLICY_VERSION,
  RUNTIME_MEDIA_CLASSES,
  compileRuntimeCacheHints,
  createRuntimeCachePolicy,
  resolveCachePolicy,
  resolveRuntimeCachePolicy,
} from '../../../src/runtime/cache-policy';
import { RUNTIME_DEVICE_CLASSES } from '../../../src/runtime/types';

const MEBIBYTE = 1024 * 1024;

describe('runtime cache policy', () => {
  it('compiles a bounded, versioned default profile', () => {
    const compiled = resolveRuntimeCachePolicy();

    expect(compiled).toEqual({
      policyVersion: RUNTIME_CACHE_POLICY_VERSION,
      deviceClass: 'standard',
      mediaClass: 'image-tour',
      maxRecentScenes: 4,
      maxEstimatedBytes: 192 * MEBIBYTE,
      evictionStrategy: 'least-recently-used',
      duplicateRequestStrategy: 'coalesce',
      suppressDuplicateRequests: true,
    });
  });

  it('bounds every device and media combination', () => {
    for (const deviceClass of RUNTIME_DEVICE_CLASSES) {
      for (const mediaClass of RUNTIME_MEDIA_CLASSES) {
        const compiled = resolveRuntimeCachePolicy({ deviceClass, mediaClass });

        expect(compiled.maxRecentScenes).toBeGreaterThanOrEqual(1);
        expect(compiled.maxRecentScenes)
          .toBeLessThanOrEqual(DEFAULT_RUNTIME_CACHE_POLICY.absoluteMaximum.maxRecentScenes);
        expect(compiled.maxEstimatedBytes).toBeGreaterThanOrEqual(MEBIBYTE);
        expect(compiled.maxEstimatedBytes)
          .toBeLessThanOrEqual(DEFAULT_RUNTIME_CACHE_POLICY.absoluteMaximum.maxEstimatedBytes);
      }
    }
  });

  it('gives a constrained device a smaller budget than a capable one', () => {
    const constrained = resolveRuntimeCachePolicy({ deviceClass: 'constrained' });
    const standard = resolveRuntimeCachePolicy({ deviceClass: 'standard' });
    const capable = resolveRuntimeCachePolicy({ deviceClass: 'capable' });

    expect(constrained.maxRecentScenes).toBeLessThan(standard.maxRecentScenes);
    expect(standard.maxRecentScenes).toBeLessThan(capable.maxRecentScenes);
    expect(constrained.maxEstimatedBytes).toBeLessThan(capable.maxEstimatedBytes);
  });

  it('spends less on heavier media classes', () => {
    const images = resolveRuntimeCachePolicy({ deviceClass: 'capable', mediaClass: 'image-tour' });
    const mixed = resolveRuntimeCachePolicy({ deviceClass: 'capable', mediaClass: 'mixed-media-tour' });
    const video = resolveRuntimeCachePolicy({ deviceClass: 'capable', mediaClass: 'video-tour' });

    expect(mixed.maxEstimatedBytes).toBeLessThan(images.maxEstimatedBytes);
    expect(video.maxEstimatedBytes).toBeLessThan(mixed.maxEstimatedBytes);
  });

  it('halves the budget when the visitor asked to save data', () => {
    const normal = resolveRuntimeCachePolicy({ deviceClass: 'standard' });
    const saving = resolveRuntimeCachePolicy({ deviceClass: 'standard', saveData: true });

    expect(saving.maxEstimatedBytes).toBe(Math.floor(normal.maxEstimatedBytes / 2));
    expect(saving.maxRecentScenes).toBeLessThanOrEqual(normal.maxRecentScenes);
    expect(saving.maxRecentScenes).toBeGreaterThanOrEqual(1);
  });

  it('classifies an unknown device from its reported memory', () => {
    expect(resolveRuntimeCachePolicy({ deviceMemoryGb: 2 }).deviceClass).toBe('constrained');
    expect(resolveRuntimeCachePolicy({ deviceMemoryGb: 4 }).deviceClass).toBe('standard');
    expect(resolveRuntimeCachePolicy({ deviceMemoryGb: 8 }).deviceClass).toBe('capable');
    // Missing or unusable telemetry falls back to the middle profile.
    expect(resolveRuntimeCachePolicy({ deviceMemoryGb: Number.NaN }).deviceClass).toBe('standard');
    expect(resolveRuntimeCachePolicy({}).deviceClass).toBe('standard');
    // An explicit class always wins over inferred memory.
    expect(resolveRuntimeCachePolicy({ deviceClass: 'capable', deviceMemoryGb: 1 }).deviceClass)
      .toBe('capable');
  });

  it('always asks the player to suppress duplicate media requests', () => {
    for (const deviceClass of RUNTIME_DEVICE_CLASSES) {
      const compiled = resolveRuntimeCachePolicy({ deviceClass });

      expect(compiled.suppressDuplicateRequests).toBe(true);
      expect(compiled.duplicateRequestStrategy).toBe('coalesce');
      expect(compiled.evictionStrategy).toBe('least-recently-used');
    }
  });

  it('stays platform-controlled: a device budget cannot exceed the absolute maximum', () => {
    expect(() => createRuntimeCachePolicy({
      deviceBudgets: { capable: { maxRecentScenes: 999 } },
    })).toThrow(RangeError);
    expect(() => createRuntimeCachePolicy({
      deviceBudgets: { capable: { maxEstimatedBytes: 1024 * 1024 * 1024 * 4 } },
    })).toThrow(RangeError);
    expect(() => createRuntimeCachePolicy({ mediaBudgetFactors: { 'video-tour': 2 } }))
      .toThrow(RangeError);
    expect(() => createRuntimeCachePolicy({ mediaBudgetFactors: { 'video-tour': 0 } }))
      .toThrow(RangeError);
    expect(() => createRuntimeCachePolicy({ version: 0 })).toThrow(RangeError);
  });

  it('supports a narrower configured budget and reports its version', () => {
    const policy = createRuntimeCachePolicy({
      version: 4,
      deviceBudgets: { standard: { maxRecentScenes: 2, maxEstimatedBytes: 32 * MEBIBYTE } },
    });
    const compiled = resolveRuntimeCachePolicy({ deviceClass: 'standard' }, policy);

    expect(compiled.policyVersion).toBe(4);
    expect(compiled.maxRecentScenes).toBe(2);
    expect(compiled.maxEstimatedBytes).toBe(32 * MEBIBYTE);
  });

  it('exposes the same result through its aliases and class form', () => {
    const request = { deviceClass: 'capable' as const, mediaClass: 'video-tour' as const };

    expect(compileRuntimeCacheHints(request)).toEqual(resolveRuntimeCachePolicy(request));
    expect(resolveCachePolicy(request)).toEqual(resolveRuntimeCachePolicy(request));
    expect(new BoundedRuntimeCachePolicy().resolve(request))
      .toEqual(resolveRuntimeCachePolicy(request));
    expect(Object.isFrozen(DEFAULT_RUNTIME_CACHE_POLICY)).toBe(true);
  });
});
