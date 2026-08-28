import { describe, expect, it } from 'vitest';

import {
  ConfigurableTourStrategyPolicy,
  DEFAULT_TOUR_STRATEGY_POLICY,
  TOUR_STRATEGY_POLICY_VERSION,
  createTourStrategyPolicy,
  selectTourRuntimeStrategy,
  selectTourStrategy,
} from '../../../apps/api/src/runtime/tour-strategy';

describe('tour runtime strategy', () => {
  it('keeps an ordinary tour inline', () => {
    const decision = selectTourRuntimeStrategy({ sceneCount: 3, connectionCount: 4 });

    expect(decision).toEqual({
      strategy: 'small',
      sceneDelivery: 'inline',
      includeAllSceneDefinitions: true,
      reasons: ['within-inline-budgets'],
      policyVersion: TOUR_STRATEGY_POLICY_VERSION,
    });
  });

  it('switches to progressive delivery once the scene budget is exceeded', () => {
    const decision = selectTourRuntimeStrategy({
      sceneCount: DEFAULT_TOUR_STRATEGY_POLICY.maxInlineSceneCount + 1,
    });

    expect(decision.strategy).toBe('large');
    expect(decision.sceneDelivery).toBe('progressive');
    expect(decision.includeAllSceneDefinitions).toBe(false);
    expect(decision.reasons).toEqual(['scene-count-budget-exceeded']);
  });

  it('stays inline exactly at the scene budget', () => {
    const decision = selectTourRuntimeStrategy({
      sceneCount: DEFAULT_TOUR_STRATEGY_POLICY.maxInlineSceneCount,
    });

    expect(decision.strategy).toBe('small');
  });

  it('considers serialized manifest size, not only scene count', () => {
    const decision = selectTourRuntimeStrategy({
      sceneCount: 4,
      estimatedManifestBytes: DEFAULT_TOUR_STRATEGY_POLICY.maxInlineManifestBytes + 1,
    });

    expect(decision.strategy).toBe('large');
    expect(decision.reasons).toEqual(['manifest-size-budget-exceeded']);
  });

  it('considers graph complexity independently of the raw connection count', () => {
    const decision = selectTourRuntimeStrategy({ sceneCount: 10, connectionCount: 100 });

    expect(decision.strategy).toBe('large');
    expect(decision.reasons).toEqual(['graph-complexity-budget-exceeded']);
  });

  it('reports every budget a tour crosses', () => {
    const decision = selectTourRuntimeStrategy({
      sceneCount: 4,
      connectionCount: DEFAULT_TOUR_STRATEGY_POLICY.maxInlineConnectionCount + 1,
    });

    expect(decision.reasons).toEqual([
      'connection-count-budget-exceeded',
      'graph-complexity-budget-exceeded',
    ]);
  });

  it('lets product or runtime policy require progressive delivery outright', () => {
    const decision = selectTourRuntimeStrategy({
      sceneCount: 1,
      requireProgressiveDelivery: true,
    });

    expect(decision.strategy).toBe('large');
    expect(decision.reasons).toEqual(['runtime-policy-required-progressive-delivery']);
  });

  it('treats an empty tour as inline without dividing by zero', () => {
    expect(selectTourRuntimeStrategy({ sceneCount: 0, connectionCount: 0 }).strategy).toBe('small');
  });

  it('is a configuration decision, not a hard-coded threshold', () => {
    const policy = createTourStrategyPolicy({ maxInlineSceneCount: 2 });

    expect(selectTourRuntimeStrategy({ sceneCount: 3 }, policy).strategy).toBe('large');
    // The same tour is inline under the platform default.
    expect(selectTourRuntimeStrategy({ sceneCount: 3 }).strategy).toBe('small');
    expect(policy.maxInlineManifestBytes)
      .toBe(DEFAULT_TOUR_STRATEGY_POLICY.maxInlineManifestBytes);
  });

  it('carries the policy version so a compiled decision stays traceable', () => {
    const policy = createTourStrategyPolicy({ version: 9 });

    expect(selectTourRuntimeStrategy({ sceneCount: 1 }, policy).policyVersion).toBe(9);
  });

  it('rejects an unusable policy or metric instead of guessing', () => {
    expect(() => createTourStrategyPolicy({ maxInlineSceneCount: -1 })).toThrow(RangeError);
    expect(() => createTourStrategyPolicy({ version: 0 })).toThrow(RangeError);
    expect(() => createTourStrategyPolicy({ maxInlineAverageConnectionsPerScene: Number.NaN }))
      .toThrow(RangeError);
    expect(() => selectTourRuntimeStrategy({ sceneCount: 1.5 })).toThrow(RangeError);
    expect(() => selectTourRuntimeStrategy({ sceneCount: 1, connectionCount: -2 }))
      .toThrow(RangeError);
  });

  it('exposes the same decision through the class and the alias', () => {
    const metrics = { sceneCount: 40 };

    expect(new ConfigurableTourStrategyPolicy().select(metrics))
      .toEqual(selectTourRuntimeStrategy(metrics));
    expect(selectTourStrategy(metrics)).toEqual(selectTourRuntimeStrategy(metrics));
  });

  it('freezes the default policy against accidental mutation', () => {
    expect(Object.isFrozen(DEFAULT_TOUR_STRATEGY_POLICY)).toBe(true);
  });
});
