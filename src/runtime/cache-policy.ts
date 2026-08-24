import type { RuntimeDeviceClass } from './types';

export const RUNTIME_CACHE_POLICY_VERSION = 1 as const;
const MEBIBYTE = 1024 * 1024;

export const RUNTIME_MEDIA_CLASSES = [
  'image-tour',
  'mixed-media-tour',
  'video-tour',
] as const;
export type RuntimeMediaClass = (typeof RUNTIME_MEDIA_CLASSES)[number];

export type RuntimeCacheEvictionStrategy = 'least-recently-used';
export type DuplicateRequestStrategy = 'coalesce';

export interface RuntimeCacheBudget {
  readonly maxRecentScenes: number;
  readonly maxEstimatedBytes: number;
}

export interface RuntimeCachePolicyConfig {
  readonly version: number;
  readonly evictionStrategy: RuntimeCacheEvictionStrategy;
  readonly duplicateRequestStrategy: DuplicateRequestStrategy;
  readonly absoluteMaximum: RuntimeCacheBudget;
  readonly deviceBudgets: Readonly<Record<RuntimeDeviceClass, RuntimeCacheBudget>>;
  readonly mediaBudgetFactors: Readonly<Record<RuntimeMediaClass, number>>;
}

export interface RuntimeCachePolicyOverrides {
  readonly version?: number;
  readonly evictionStrategy?: RuntimeCacheEvictionStrategy;
  readonly duplicateRequestStrategy?: DuplicateRequestStrategy;
  readonly absoluteMaximum?: Partial<RuntimeCacheBudget>;
  readonly deviceBudgets?: Partial<Record<RuntimeDeviceClass, Partial<RuntimeCacheBudget>>>;
  readonly mediaBudgetFactors?: Partial<Record<RuntimeMediaClass, number>>;
}

export interface RuntimeCachePolicyInput {
  readonly deviceClass?: RuntimeDeviceClass;
  readonly deviceMemoryGb?: number;
  readonly mediaClass?: RuntimeMediaClass;
  readonly saveData?: boolean;
}

/** Versioned, platform-controlled hints consumed by the player cache. */
export interface CompiledRuntimeCachePolicy {
  readonly policyVersion: number;
  readonly deviceClass: RuntimeDeviceClass;
  readonly mediaClass: RuntimeMediaClass;
  readonly maxRecentScenes: number;
  readonly maxEstimatedBytes: number;
  readonly evictionStrategy: RuntimeCacheEvictionStrategy;
  readonly duplicateRequestStrategy: DuplicateRequestStrategy;
  readonly suppressDuplicateRequests: true;
}

export const DEFAULT_RUNTIME_CACHE_POLICY: RuntimeCachePolicyConfig = freezeCachePolicy({
  version: RUNTIME_CACHE_POLICY_VERSION,
  evictionStrategy: 'least-recently-used',
  duplicateRequestStrategy: 'coalesce',
  absoluteMaximum: {
    maxRecentScenes: 8,
    maxEstimatedBytes: 512 * MEBIBYTE,
  },
  deviceBudgets: {
    constrained: {
      maxRecentScenes: 2,
      maxEstimatedBytes: 64 * MEBIBYTE,
    },
    standard: {
      maxRecentScenes: 4,
      maxEstimatedBytes: 192 * MEBIBYTE,
    },
    capable: {
      maxRecentScenes: 6,
      maxEstimatedBytes: 384 * MEBIBYTE,
    },
  },
  mediaBudgetFactors: {
    'image-tour': 1,
    'mixed-media-tour': 0.75,
    'video-tour': 0.5,
  },
});

export function createRuntimeCachePolicy(
  overrides: RuntimeCachePolicyOverrides = {},
): RuntimeCachePolicyConfig {
  return freezeCachePolicy({
    ...DEFAULT_RUNTIME_CACHE_POLICY,
    ...overrides,
    absoluteMaximum: {
      ...DEFAULT_RUNTIME_CACHE_POLICY.absoluteMaximum,
      ...overrides.absoluteMaximum,
    },
    deviceBudgets: {
      constrained: {
        ...DEFAULT_RUNTIME_CACHE_POLICY.deviceBudgets.constrained,
        ...overrides.deviceBudgets?.constrained,
      },
      standard: {
        ...DEFAULT_RUNTIME_CACHE_POLICY.deviceBudgets.standard,
        ...overrides.deviceBudgets?.standard,
      },
      capable: {
        ...DEFAULT_RUNTIME_CACHE_POLICY.deviceBudgets.capable,
        ...overrides.deviceBudgets?.capable,
      },
    },
    mediaBudgetFactors: {
      ...DEFAULT_RUNTIME_CACHE_POLICY.mediaBudgetFactors,
      ...overrides.mediaBudgetFactors,
    },
  });
}

export function resolveRuntimeCachePolicy(
  input: RuntimeCachePolicyInput = {},
  policy: RuntimeCachePolicyConfig = DEFAULT_RUNTIME_CACHE_POLICY,
): CompiledRuntimeCachePolicy {
  validateCachePolicy(policy);
  const deviceClass = resolveDeviceClass(input);
  const mediaClass = input.mediaClass ?? 'image-tour';
  const deviceBudget = policy.deviceBudgets[deviceClass];
  const factor = policy.mediaBudgetFactors[mediaClass];
  const dataSavingFactor = input.saveData === true ? 0.5 : 1;
  const effectiveFactor = factor * dataSavingFactor;

  return Object.freeze({
    policyVersion: policy.version,
    deviceClass,
    mediaClass,
    maxRecentScenes: Math.min(
      policy.absoluteMaximum.maxRecentScenes,
      Math.max(1, Math.floor(deviceBudget.maxRecentScenes * effectiveFactor)),
    ),
    maxEstimatedBytes: Math.min(
      policy.absoluteMaximum.maxEstimatedBytes,
      Math.max(MEBIBYTE, Math.floor(deviceBudget.maxEstimatedBytes * effectiveFactor)),
    ),
    evictionStrategy: policy.evictionStrategy,
    duplicateRequestStrategy: policy.duplicateRequestStrategy,
    suppressDuplicateRequests: true,
  });
}

/** Concise alias for manifest compilers. */
export const compileRuntimeCacheHints = resolveRuntimeCachePolicy;
export const resolveCachePolicy = resolveRuntimeCachePolicy;

export class BoundedRuntimeCachePolicy {
  readonly config: RuntimeCachePolicyConfig;

  constructor(config: RuntimeCachePolicyConfig = DEFAULT_RUNTIME_CACHE_POLICY) {
    this.config = freezeCachePolicy(config);
  }

  resolve(input: RuntimeCachePolicyInput = {}): CompiledRuntimeCachePolicy {
    return resolveRuntimeCachePolicy(input, this.config);
  }
}

function resolveDeviceClass(input: RuntimeCachePolicyInput): RuntimeDeviceClass {
  if (input.deviceClass !== undefined) {
    return input.deviceClass;
  }
  if (input.deviceMemoryGb === undefined || !Number.isFinite(input.deviceMemoryGb)) {
    return 'standard';
  }
  if (input.deviceMemoryGb <= 2) {
    return 'constrained';
  }
  if (input.deviceMemoryGb >= 8) {
    return 'capable';
  }
  return 'standard';
}

function validateCachePolicy(policy: RuntimeCachePolicyConfig): void {
  assertPositiveInteger(policy.version, 'version');
  assertBudget(policy.absoluteMaximum, 'absoluteMaximum');
  for (const [deviceClass, budget] of Object.entries(policy.deviceBudgets)) {
    assertBudget(budget, `deviceBudgets.${deviceClass}`);
    if (budget.maxRecentScenes > policy.absoluteMaximum.maxRecentScenes
      || budget.maxEstimatedBytes > policy.absoluteMaximum.maxEstimatedBytes) {
      throw new RangeError(`deviceBudgets.${deviceClass} exceeds the absolute cache maximum.`);
    }
  }
  for (const [mediaClass, factor] of Object.entries(policy.mediaBudgetFactors)) {
    if (!Number.isFinite(factor) || factor <= 0 || factor > 1) {
      throw new RangeError(`mediaBudgetFactors.${mediaClass} must be greater than 0 and at most 1.`);
    }
  }
}

function assertBudget(budget: RuntimeCacheBudget, name: string): void {
  assertPositiveInteger(budget.maxRecentScenes, `${name}.maxRecentScenes`);
  assertPositiveInteger(budget.maxEstimatedBytes, `${name}.maxEstimatedBytes`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
}

function freezeCachePolicy(policy: RuntimeCachePolicyConfig): RuntimeCachePolicyConfig {
  validateCachePolicy(policy);
  return Object.freeze({
    ...policy,
    absoluteMaximum: Object.freeze({ ...policy.absoluteMaximum }),
    deviceBudgets: Object.freeze({
      constrained: Object.freeze({ ...policy.deviceBudgets.constrained }),
      standard: Object.freeze({ ...policy.deviceBudgets.standard }),
      capable: Object.freeze({ ...policy.deviceBudgets.capable }),
    }),
    mediaBudgetFactors: Object.freeze({ ...policy.mediaBudgetFactors }),
  });
}
