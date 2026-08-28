import { describe, expect, it } from 'vitest';

import {
  AdjacentScenePreloadPolicy,
  DEFAULT_ADJACENT_SCENE_PRELOAD_POLICY,
  MAX_ADJACENT_SCENE_PRELOADS,
  buildAdjacentScenePreloadPlan,
  createAdjacentScenePreloadPolicy,
  rankAdjacentScenePreloads,
  selectAdjacentScenePreloads,
} from '@alishaikh110/experience-schema';
import type { ScenePreloadConnection } from '@alishaikh110/experience-schema';

/** A lobby linked to three rooms, plus one link that does not start at the lobby. */
const connections: readonly ScenePreloadConnection[] = [
  { sourceSceneId: 'lobby', targetSceneId: 'pool', importance: 10 },
  { sourceSceneId: 'lobby', targetSceneId: 'suite', importance: 90 },
  { sourceSceneId: 'lobby', targetSceneId: 'spa', importance: 50 },
  { sourceSceneId: 'pool', targetSceneId: 'roof', importance: 100 },
];

describe('adjacent scene preload policy', () => {
  it('preloads only scenes connected to the current one', () => {
    const plan = buildAdjacentScenePreloadPlan({ currentSceneId: 'lobby', connections });

    expect(plan.sceneIds).not.toContain('roof');
    for (const sceneId of plan.sceneIds) {
      expect(['pool', 'suite', 'spa']).toContain(sceneId);
    }
  });

  it('never preloads the whole tour', () => {
    const wide = Array.from({ length: 50 }, (_, index) => ({
      sourceSceneId: 'lobby',
      targetSceneId: `room-${index}`,
      importance: 100,
    }));

    const plan = buildAdjacentScenePreloadPlan({ currentSceneId: 'lobby', connections: wide });

    expect(plan.sceneIds.length).toBeLessThanOrEqual(MAX_ADJACENT_SCENE_PRELOADS);
    expect(plan.maximumSelectedScenes).toBeLessThanOrEqual(MAX_ADJACENT_SCENE_PRELOADS);
  });

  it('ranks the strongest connection first and keeps a second candidate', () => {
    const plan = buildAdjacentScenePreloadPlan({ currentSceneId: 'lobby', connections });

    expect(plan.sceneIds).toEqual(['suite', 'spa']);
    expect(plan.selections[0]).toMatchObject({ sceneId: 'suite', rank: 1 });
    expect(plan.selections[0]?.reasons).toContain('connection-importance');
    expect(plan.selections[1]?.rank).toBe(2);
  });

  it('hints base media and the scene definition, never full-resolution media', () => {
    const plan = buildAdjacentScenePreloadPlan({ currentSceneId: 'lobby', connections });

    for (const selection of plan.selections) {
      expect(selection.content).toBe('scene-definition-and-base-media');
    }
  });

  it('lets an explicit creator hint outrank raw connection importance', () => {
    const plan = buildAdjacentScenePreloadPlan({
      currentSceneId: 'lobby',
      connections,
      likelyNextSceneIds: ['spa'],
    });

    expect(plan.sceneIds[0]).toBe('spa');
    expect(plan.selections[0]?.reasons).toContain('explicit-likely-next-scene');
  });

  it('honours a per-scene preload priority for a connected candidate only', () => {
    const plan = buildAdjacentScenePreloadPlan({
      currentSceneId: 'lobby',
      connections,
      scenePreloadPriorities: { pool: 100, roof: 100 },
    });

    expect(plan.sceneIds).toContain('pool');
    // roof is not reachable from the lobby, so a hint cannot make it eligible.
    expect(plan.sceneIds).not.toContain('roof');
  });

  it('respects an explicit high hint and an explicit opt-out', () => {
    const high = buildAdjacentScenePreloadPlan({
      currentSceneId: 'lobby',
      connections: [
        { sourceSceneId: 'lobby', targetSceneId: 'suite', importance: 50 },
        { sourceSceneId: 'lobby', targetSceneId: 'pool', importance: 10, preloadHint: 'high' },
      ],
    });
    expect(high.sceneIds[0]).toBe('pool');
    expect(high.selections[0]?.reasons).toContain('explicit-high-priority');

    const suppressed = buildAdjacentScenePreloadPlan({
      currentSceneId: 'lobby',
      connections: [
        { sourceSceneId: 'lobby', targetSceneId: 'pool', importance: 100, preloadHint: 'none' },
      ],
    });
    expect(suppressed.sceneIds).toEqual([]);
  });

  it('uses recent navigation as a weaker signal', () => {
    const graph: readonly ScenePreloadConnection[] = [
      { sourceSceneId: 'lobby', targetSceneId: 'suite', importance: 90 },
      { sourceSceneId: 'lobby', targetSceneId: 'spa', importance: 50 },
      { sourceSceneId: 'lobby', targetSceneId: 'pool', importance: 30 },
    ];

    expect(buildAdjacentScenePreloadPlan({ currentSceneId: 'lobby', connections: graph }).sceneIds)
      .toEqual(['suite', 'spa']);

    const plan = buildAdjacentScenePreloadPlan({
      currentSceneId: 'lobby',
      connections: graph,
      recentSceneIds: ['pool'],
    });

    // Recent navigation lifts pool past spa...
    expect(plan.sceneIds).toEqual(['suite', 'pool']);
    expect(plan.selections[1]?.reasons).toContain('recent-navigation');
    // ...but does not outweigh the strongest authored connection.
    expect(plan.sceneIds[0]).toBe('suite');
  });

  it('ignores a self-connection and an empty target', () => {
    const plan = buildAdjacentScenePreloadPlan({
      currentSceneId: 'lobby',
      connections: [
        { sourceSceneId: 'lobby', targetSceneId: 'lobby', importance: 100 },
        { sourceSceneId: 'lobby', targetSceneId: '', importance: 100 },
        { sourceSceneId: 'lobby', targetSceneId: 'pool' },
      ],
    });

    expect(plan.sceneIds).toEqual(['pool']);
  });

  it('merges duplicate connections to the same target on their strongest signal', () => {
    const plan = buildAdjacentScenePreloadPlan({
      currentSceneId: 'lobby',
      connections: [
        { sourceSceneId: 'lobby', targetSceneId: 'pool', importance: 5 },
        { sourceSceneId: 'lobby', targetSceneId: 'pool', importance: 95, preloadHint: 'high' },
        { sourceSceneId: 'lobby', targetSceneId: 'spa', importance: 50 },
      ],
    });

    expect(plan.sceneIds[0]).toBe('pool');
    expect(plan.selections.filter((selection) => selection.sceneId === 'pool')).toHaveLength(1);
  });

  it('tightens the budget on a constrained device or network', () => {
    expect(buildAdjacentScenePreloadPlan({
      currentSceneId: 'lobby',
      connections,
      deviceClass: 'constrained',
    }).sceneIds).toHaveLength(1);

    expect(buildAdjacentScenePreloadPlan({
      currentSceneId: 'lobby',
      connections,
      networkClass: 'constrained',
    }).sceneIds).toHaveLength(1);

    expect(buildAdjacentScenePreloadPlan({
      currentSceneId: 'lobby',
      connections,
      networkClass: 'offline',
    }).sceneIds).toEqual([]);
  });

  it('preloads nothing when the visitor asked to save data', () => {
    const plan = buildAdjacentScenePreloadPlan({
      currentSceneId: 'lobby',
      connections,
      saveData: true,
    });

    expect(plan).toMatchObject({ sceneIds: [], selections: [], maximumSelectedScenes: 0 });
  });

  it('is deterministic for equally weighted candidates', () => {
    const equal = [
      { sourceSceneId: 'lobby', targetSceneId: 'zulu' },
      { sourceSceneId: 'lobby', targetSceneId: 'yankee' },
      { sourceSceneId: 'lobby', targetSceneId: 'xray' },
    ];

    const first = buildAdjacentScenePreloadPlan({ currentSceneId: 'lobby', connections: equal });
    const second = buildAdjacentScenePreloadPlan({ currentSceneId: 'lobby', connections: equal });

    expect(first.sceneIds).toEqual(second.sceneIds);
    // Ties fall back to the authored connection order.
    expect(first.sceneIds).toEqual(['zulu', 'yankee']);
  });

  it('clamps an out-of-range importance rather than letting it dominate', () => {
    const plan = buildAdjacentScenePreloadPlan({
      currentSceneId: 'lobby',
      connections: [
        { sourceSceneId: 'lobby', targetSceneId: 'pool', importance: 10_000 },
        { sourceSceneId: 'lobby', targetSceneId: 'suite', importance: 100, preloadHint: 'high' },
      ],
    });

    expect(plan.sceneIds[0]).toBe('suite');
  });

  it('refuses a policy that would raise the platform preload ceiling', () => {
    expect(() => createAdjacentScenePreloadPolicy({
      maxScenes: MAX_ADJACENT_SCENE_PRELOADS + 1,
    })).toThrow(RangeError);
    expect(() => createAdjacentScenePreloadPolicy({
      maximumByDeviceClass: { capable: 5 },
    })).toThrow(RangeError);
    expect(() => createAdjacentScenePreloadPolicy({
      weights: { likelyNext: -1 },
    })).toThrow(RangeError);
    expect(() => buildAdjacentScenePreloadPlan({ currentSceneId: '', connections }))
      .toThrow(RangeError);
  });

  it('supports a narrower configured budget', () => {
    const policy = createAdjacentScenePreloadPolicy({ maxScenes: 1 });

    expect(selectAdjacentScenePreloads({ currentSceneId: 'lobby', connections }, policy))
      .toEqual(['suite']);
  });

  it('exposes the same plan through its helper and class forms', () => {
    const request = { currentSceneId: 'lobby', connections };

    expect(selectAdjacentScenePreloads(request))
      .toEqual(buildAdjacentScenePreloadPlan(request).sceneIds);
    expect(rankAdjacentScenePreloads(request))
      .toEqual(buildAdjacentScenePreloadPlan(request).selections);
    expect(new AdjacentScenePreloadPolicy().select(request))
      .toEqual(buildAdjacentScenePreloadPlan(request));
    expect(Object.isFrozen(DEFAULT_ADJACENT_SCENE_PRELOAD_POLICY)).toBe(true);
  });
});
