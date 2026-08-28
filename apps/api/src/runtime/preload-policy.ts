import type { RuntimeDeviceClass, RuntimeNetworkClass } from './types';

export const MAX_ADJACENT_SCENE_PRELOADS = 2 as const;

export type ScenePreloadHint = 'none' | 'normal' | 'high';
export type ScenePreloadReason =
  | 'connected-scene'
  | 'connection-importance'
  | 'target-scene-priority'
  | 'explicit-high-priority'
  | 'explicit-likely-next-scene'
  | 'recent-navigation';

export interface ScenePreloadConnection {
  readonly sourceSceneId: string;
  readonly targetSceneId: string;
  /** Portable product hint from 0 through 100. */
  readonly importance?: number;
  readonly preloadHint?: ScenePreloadHint;
}

export interface AdjacentScenePreloadInput {
  readonly currentSceneId: string;
  readonly connections: readonly ScenePreloadConnection[];
  readonly likelyNextSceneIds?: readonly string[];
  /** Canonical per-scene hints; only connected candidates remain eligible. */
  readonly scenePreloadPriorities?: Readonly<Record<string, number>>;
  /** Most-recent scene first. */
  readonly recentSceneIds?: readonly string[];
  readonly deviceClass?: RuntimeDeviceClass;
  readonly networkClass?: RuntimeNetworkClass;
  readonly saveData?: boolean;
}

export interface ScenePreloadWeights {
  readonly connectionImportance: number;
  readonly scenePreloadPriority: number;
  readonly normalHint: number;
  readonly highHint: number;
  readonly likelyNext: number;
  readonly recentNavigation: number;
}

export interface AdjacentScenePreloadPolicyConfig {
  readonly maxScenes: number;
  readonly weights: ScenePreloadWeights;
  readonly maximumByDeviceClass: Readonly<Record<RuntimeDeviceClass, number>>;
  readonly maximumByNetworkClass: Readonly<Record<RuntimeNetworkClass, number>>;
}

export interface AdjacentScenePreloadPolicyOverrides {
  readonly maxScenes?: number;
  readonly weights?: Partial<ScenePreloadWeights>;
  readonly maximumByDeviceClass?: Partial<Record<RuntimeDeviceClass, number>>;
  readonly maximumByNetworkClass?: Partial<Record<RuntimeNetworkClass, number>>;
}

export interface ScenePreloadSelection {
  readonly sceneId: string;
  readonly rank: number;
  readonly score: number;
  readonly reasons: readonly ScenePreloadReason[];
  /** Prevents a hint from being interpreted as a full-resolution blanket fetch. */
  readonly content: 'scene-definition-and-base-media';
}

export interface AdjacentScenePreloadPlan {
  readonly currentSceneId: string;
  readonly sceneIds: readonly string[];
  readonly selections: readonly ScenePreloadSelection[];
  readonly maximumSelectedScenes: number;
}

interface MutableCandidate {
  readonly sceneId: string;
  readonly firstConnectionIndex: number;
  importance: number;
  hint: Exclude<ScenePreloadHint, 'none'> | undefined;
}

export const DEFAULT_ADJACENT_SCENE_PRELOAD_POLICY: AdjacentScenePreloadPolicyConfig = freezePolicy({
  maxScenes: MAX_ADJACENT_SCENE_PRELOADS,
  weights: {
    connectionImportance: 1,
    scenePreloadPriority: 0.75,
    normalHint: 20,
    highHint: 75,
    likelyNext: 100,
    recentNavigation: 30,
  },
  maximumByDeviceClass: {
    constrained: 1,
    standard: 2,
    capable: 2,
  },
  maximumByNetworkClass: {
    offline: 0,
    constrained: 1,
    standard: 2,
    fast: 2,
  },
});

export function createAdjacentScenePreloadPolicy(
  overrides: AdjacentScenePreloadPolicyOverrides = {},
): AdjacentScenePreloadPolicyConfig {
  return freezePolicy({
    ...DEFAULT_ADJACENT_SCENE_PRELOAD_POLICY,
    ...overrides,
    weights: {
      ...DEFAULT_ADJACENT_SCENE_PRELOAD_POLICY.weights,
      ...overrides.weights,
    },
    maximumByDeviceClass: {
      ...DEFAULT_ADJACENT_SCENE_PRELOAD_POLICY.maximumByDeviceClass,
      ...overrides.maximumByDeviceClass,
    },
    maximumByNetworkClass: {
      ...DEFAULT_ADJACENT_SCENE_PRELOAD_POLICY.maximumByNetworkClass,
      ...overrides.maximumByNetworkClass,
    },
  });
}

export function buildAdjacentScenePreloadPlan(
  input: AdjacentScenePreloadInput,
  policy: AdjacentScenePreloadPolicyConfig = DEFAULT_ADJACENT_SCENE_PRELOAD_POLICY,
): AdjacentScenePreloadPlan {
  validatePolicy(policy);
  if (input.currentSceneId.length === 0) {
    throw new RangeError('currentSceneId must not be empty.');
  }

  const maximum = effectiveMaximum(input, policy);
  if (maximum === 0) {
    return Object.freeze({
      currentSceneId: input.currentSceneId,
      sceneIds: Object.freeze([]),
      selections: Object.freeze([]),
      maximumSelectedScenes: 0,
    });
  }

  const candidates = collectAdjacentCandidates(input);
  const likelyNext = indexedUniqueValues(input.likelyNextSceneIds ?? []);
  const recent = indexedUniqueValues(input.recentSceneIds ?? []);
  const scored = [...candidates.values()].map((candidate) => scoreCandidate(
    candidate,
    likelyNext,
    recent,
    input.scenePreloadPriorities ?? {},
    policy.weights,
  ));

  scored.sort((left, right) => right.score - left.score
    || left.firstConnectionIndex - right.firstConnectionIndex
    || left.sceneId.localeCompare(right.sceneId));

  const selections = Object.freeze(scored.slice(0, maximum).map((candidate, index) => Object.freeze({
    sceneId: candidate.sceneId,
    rank: index + 1,
    score: candidate.score,
    reasons: Object.freeze(candidate.reasons),
    content: 'scene-definition-and-base-media' as const,
  })));

  return Object.freeze({
    currentSceneId: input.currentSceneId,
    sceneIds: Object.freeze(selections.map((selection) => selection.sceneId)),
    selections,
    maximumSelectedScenes: maximum,
  });
}

/** Returns the compact manifest shape when scoring detail is not needed. */
export function selectAdjacentScenePreloads(
  input: AdjacentScenePreloadInput,
  policy: AdjacentScenePreloadPolicyConfig = DEFAULT_ADJACENT_SCENE_PRELOAD_POLICY,
): readonly string[] {
  return buildAdjacentScenePreloadPlan(input, policy).sceneIds;
}

/** Returns ranked selections for diagnostics or richer manifest hints. */
export function rankAdjacentScenePreloads(
  input: AdjacentScenePreloadInput,
  policy: AdjacentScenePreloadPolicyConfig = DEFAULT_ADJACENT_SCENE_PRELOAD_POLICY,
): readonly ScenePreloadSelection[] {
  return buildAdjacentScenePreloadPlan(input, policy).selections;
}

export class AdjacentScenePreloadPolicy {
  readonly config: AdjacentScenePreloadPolicyConfig;

  constructor(config: AdjacentScenePreloadPolicyConfig = DEFAULT_ADJACENT_SCENE_PRELOAD_POLICY) {
    this.config = freezePolicy(config);
  }

  select(input: AdjacentScenePreloadInput): AdjacentScenePreloadPlan {
    return buildAdjacentScenePreloadPlan(input, this.config);
  }
}

function collectAdjacentCandidates(
  input: AdjacentScenePreloadInput,
): Map<string, MutableCandidate> {
  const candidates = new Map<string, MutableCandidate>();
  for (const [index, connection] of input.connections.entries()) {
    if (connection.sourceSceneId !== input.currentSceneId
      || connection.targetSceneId === input.currentSceneId
      || connection.targetSceneId.length === 0
      || connection.preloadHint === 'none') {
      continue;
    }

    const importance = clampImportance(connection.importance);
    const existing = candidates.get(connection.targetSceneId);
    if (existing === undefined) {
      candidates.set(connection.targetSceneId, {
        sceneId: connection.targetSceneId,
        firstConnectionIndex: index,
        importance,
        hint: connection.preloadHint,
      });
      continue;
    }
    existing.importance = Math.max(existing.importance, importance);
    if (connection.preloadHint === 'high'
      || (connection.preloadHint === 'normal' && existing.hint === undefined)) {
      existing.hint = connection.preloadHint;
    }
  }
  return candidates;
}

function scoreCandidate(
  candidate: MutableCandidate,
  likelyNext: ReadonlyMap<string, number>,
  recent: ReadonlyMap<string, number>,
  scenePreloadPriorities: Readonly<Record<string, number>>,
  weights: ScenePreloadWeights,
): MutableCandidate & { readonly score: number; readonly reasons: ScenePreloadReason[] } {
  let score = 1;
  const reasons: ScenePreloadReason[] = ['connected-scene'];
  if (candidate.importance > 0) {
    score += candidate.importance * weights.connectionImportance;
    reasons.push('connection-importance');
  }
  const scenePriority = clampImportance(scenePreloadPriorities[candidate.sceneId]);
  if (scenePriority > 0) {
    score += scenePriority * weights.scenePreloadPriority;
    reasons.push('target-scene-priority');
  }
  if (candidate.hint === 'high') {
    score += weights.highHint;
    reasons.push('explicit-high-priority');
  } else if (candidate.hint === 'normal') {
    score += weights.normalHint;
  }

  const likelyIndex = likelyNext.get(candidate.sceneId);
  if (likelyIndex !== undefined) {
    score += weights.likelyNext / (likelyIndex + 1);
    reasons.push('explicit-likely-next-scene');
  }
  const recentIndex = recent.get(candidate.sceneId);
  if (recentIndex !== undefined) {
    score += weights.recentNavigation / (recentIndex + 1);
    reasons.push('recent-navigation');
  }

  return {
    ...candidate,
    score: Math.round(score * 1000) / 1000,
    reasons,
  };
}

function effectiveMaximum(
  input: AdjacentScenePreloadInput,
  policy: AdjacentScenePreloadPolicyConfig,
): number {
  if (input.saveData === true) {
    return 0;
  }
  const deviceMaximum = policy.maximumByDeviceClass[input.deviceClass ?? 'standard'];
  const networkMaximum = policy.maximumByNetworkClass[input.networkClass ?? 'standard'];
  return Math.min(
    MAX_ADJACENT_SCENE_PRELOADS,
    policy.maxScenes,
    deviceMaximum,
    networkMaximum,
  );
}

function indexedUniqueValues(values: readonly string[]): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  for (const [index, value] of values.entries()) {
    if (!result.has(value)) {
      result.set(value, index);
    }
  }
  return result;
}

function clampImportance(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

function validatePolicy(policy: AdjacentScenePreloadPolicyConfig): void {
  assertBoundedMaximum(policy.maxScenes, 'maxScenes');
  for (const [name, value] of Object.entries(policy.weights)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`${name} must be a non-negative finite weight.`);
    }
  }
  for (const [name, value] of [
    ...Object.entries(policy.maximumByDeviceClass),
    ...Object.entries(policy.maximumByNetworkClass),
  ]) {
    assertBoundedMaximum(value, name);
  }
}

function assertBoundedMaximum(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_ADJACENT_SCENE_PRELOADS) {
    throw new RangeError(`${name} must be an integer between 0 and ${MAX_ADJACENT_SCENE_PRELOADS}.`);
  }
}

function freezePolicy(
  policy: AdjacentScenePreloadPolicyConfig,
): AdjacentScenePreloadPolicyConfig {
  validatePolicy(policy);
  return Object.freeze({
    ...policy,
    weights: Object.freeze({ ...policy.weights }),
    maximumByDeviceClass: Object.freeze({ ...policy.maximumByDeviceClass }),
    maximumByNetworkClass: Object.freeze({ ...policy.maximumByNetworkClass }),
  });
}
