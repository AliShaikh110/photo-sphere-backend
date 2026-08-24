export const TOUR_STRATEGY_POLICY_VERSION = 1 as const;

export type TourRuntimeStrategy = 'small' | 'large';
export type TourSceneDelivery = 'inline' | 'progressive';

export type TourStrategyReason =
  | 'within-inline-budgets'
  | 'scene-count-budget-exceeded'
  | 'manifest-size-budget-exceeded'
  | 'connection-count-budget-exceeded'
  | 'graph-complexity-budget-exceeded'
  | 'runtime-policy-required-progressive-delivery';

export interface TourStrategyMetrics {
  readonly sceneCount: number;
  readonly estimatedManifestBytes?: number;
  readonly connectionCount?: number;
  /** Product plan or runtime policy can require progressive delivery explicitly. */
  readonly requireProgressiveDelivery?: boolean;
}

export interface TourStrategyPolicyConfig {
  readonly version: number;
  readonly maxInlineSceneCount: number;
  readonly maxInlineManifestBytes: number;
  readonly maxInlineConnectionCount: number;
  readonly maxInlineAverageConnectionsPerScene: number;
}

export interface TourStrategyDecision {
  readonly strategy: TourRuntimeStrategy;
  readonly sceneDelivery: TourSceneDelivery;
  readonly includeAllSceneDefinitions: boolean;
  readonly reasons: readonly TourStrategyReason[];
  readonly policyVersion: number;
}

export const DEFAULT_TOUR_STRATEGY_POLICY: TourStrategyPolicyConfig = deepFreezePolicy({
  version: TOUR_STRATEGY_POLICY_VERSION,
  maxInlineSceneCount: 32,
  maxInlineManifestBytes: 1_048_576,
  maxInlineConnectionCount: 128,
  maxInlineAverageConnectionsPerScene: 5,
});

export function createTourStrategyPolicy(
  overrides: Partial<Omit<TourStrategyPolicyConfig, 'version'>> & { readonly version?: number } = {},
): TourStrategyPolicyConfig {
  const policy = {
    ...DEFAULT_TOUR_STRATEGY_POLICY,
    ...overrides,
  };
  assertPositiveInteger(policy.version, 'version');
  assertNonNegativeInteger(policy.maxInlineSceneCount, 'maxInlineSceneCount');
  assertNonNegativeInteger(policy.maxInlineManifestBytes, 'maxInlineManifestBytes');
  assertNonNegativeInteger(policy.maxInlineConnectionCount, 'maxInlineConnectionCount');
  assertNonNegativeFinite(
    policy.maxInlineAverageConnectionsPerScene,
    'maxInlineAverageConnectionsPerScene',
  );
  return deepFreezePolicy(policy);
}

export function selectTourRuntimeStrategy(
  metrics: TourStrategyMetrics,
  policy: TourStrategyPolicyConfig = DEFAULT_TOUR_STRATEGY_POLICY,
): TourStrategyDecision {
  validateMetrics(metrics);
  validatePolicy(policy);

  const connectionCount = metrics.connectionCount ?? 0;
  const averageConnections = metrics.sceneCount === 0
    ? 0
    : connectionCount / metrics.sceneCount;
  const reasons: TourStrategyReason[] = [];

  if (metrics.requireProgressiveDelivery === true) {
    reasons.push('runtime-policy-required-progressive-delivery');
  }
  if (metrics.sceneCount > policy.maxInlineSceneCount) {
    reasons.push('scene-count-budget-exceeded');
  }
  if ((metrics.estimatedManifestBytes ?? 0) > policy.maxInlineManifestBytes) {
    reasons.push('manifest-size-budget-exceeded');
  }
  if (connectionCount > policy.maxInlineConnectionCount) {
    reasons.push('connection-count-budget-exceeded');
  }
  if (averageConnections > policy.maxInlineAverageConnectionsPerScene) {
    reasons.push('graph-complexity-budget-exceeded');
  }

  const progressive = reasons.length > 0;
  const decisionReasons: readonly TourStrategyReason[] = progressive
    ? reasons
    : ['within-inline-budgets'];
  return Object.freeze({
    strategy: progressive ? 'large' : 'small',
    sceneDelivery: progressive ? 'progressive' : 'inline',
    includeAllSceneDefinitions: !progressive,
    reasons: Object.freeze(decisionReasons),
    policyVersion: policy.version,
  });
}

/** Concise alias for callers that already operate in a tour context. */
export const selectTourStrategy = selectTourRuntimeStrategy;

export class ConfigurableTourStrategyPolicy {
  readonly config: TourStrategyPolicyConfig;

  constructor(config: TourStrategyPolicyConfig = DEFAULT_TOUR_STRATEGY_POLICY) {
    validatePolicy(config);
    this.config = deepFreezePolicy(config);
  }

  select(metrics: TourStrategyMetrics): TourStrategyDecision {
    return selectTourRuntimeStrategy(metrics, this.config);
  }
}

function validateMetrics(metrics: TourStrategyMetrics): void {
  assertNonNegativeInteger(metrics.sceneCount, 'sceneCount');
  if (metrics.estimatedManifestBytes !== undefined) {
    assertNonNegativeInteger(metrics.estimatedManifestBytes, 'estimatedManifestBytes');
  }
  if (metrics.connectionCount !== undefined) {
    assertNonNegativeInteger(metrics.connectionCount, 'connectionCount');
  }
}

function validatePolicy(policy: TourStrategyPolicyConfig): void {
  assertPositiveInteger(policy.version, 'version');
  assertNonNegativeInteger(policy.maxInlineSceneCount, 'maxInlineSceneCount');
  assertNonNegativeInteger(policy.maxInlineManifestBytes, 'maxInlineManifestBytes');
  assertNonNegativeInteger(policy.maxInlineConnectionCount, 'maxInlineConnectionCount');
  assertNonNegativeFinite(
    policy.maxInlineAverageConnectionsPerScene,
    'maxInlineAverageConnectionsPerScene',
  );
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer.`);
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number.`);
  }
}

function deepFreezePolicy(policy: TourStrategyPolicyConfig): TourStrategyPolicyConfig {
  return Object.freeze({ ...policy });
}
