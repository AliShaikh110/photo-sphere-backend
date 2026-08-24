import {
  CAPABILITY_IDS,
  type AppliedCapabilityFallback,
  type CapabilityAssetReference,
  type CapabilityDefinition,
  type CapabilityId,
  type CapabilityIssue,
  type CapabilityIssueCode,
  type CapabilityRegistry,
  type CapabilityResolutionInput,
  type CapabilityResolutionResult,
  type CapabilityViewLimits,
  type RuntimeModuleDeclaration,
} from './types';
import {
  CAPABILITY_REGISTRY,
  validateCapabilityRegistry,
} from './registry';

const CAPABILITY_PATHS: Readonly<Record<CapabilityId, string>> = Object.freeze({
  basicPanorama: 'scenes.panoramaAssetId',
  hotspots: 'scenes.hotspots',
  sceneNavigation: 'settings.navigation.sceneNavigation',
  gallery: 'settings.gallery',
  autorotation: 'settings.autorotation',
  compass: 'settings.compass',
  viewLimits: 'scenes.viewLimits',
  tiledPanorama: 'settings.quality',
  highResolution: 'settings.quality',
  imageContent: 'scenes.hotspots.content.imageAssetId',
  videoContent: 'scenes.hotspots.content.videoAssetId',
  externalLink: 'scenes.hotspots.content.externalUrl',
  video360: 'videoAssetId',
  videoTimeline: 'timeline',
  timedHotspots: 'timeline',
  timedViewpoint: 'timeline',
  cta: 'timeline',
  map: 'settings.map',
  plan: 'settings.plan',
  gyroscope: 'settings.motionNavigation',
  stereo: 'settings.immersiveViewing',
  vr: 'settings.immersiveViewing',
  advancedOverlay: 'scenes.overlays',
  advancedGeometry: 'scenes.hotspots.geometry',
});

interface CapabilityFailure {
  readonly capabilityId: CapabilityId;
  readonly code: CapabilityIssueCode;
  readonly message: string;
  readonly capabilityIds?: readonly CapabilityId[] | undefined;
  readonly entityId?: string | undefined;
  readonly path?: string | undefined;
  readonly alternatives?: readonly string[] | undefined;
}

interface ResolutionState {
  readonly input: CapabilityResolutionInput;
  readonly registry: CapabilityRegistry;
  readonly active: Set<CapabilityId>;
  readonly blocked: Set<CapabilityId>;
  readonly issues: CapabilityIssue[];
  readonly fallbacks: AppliedCapabilityFallback[];
}

/**
 * Resolve product capabilities without importing renderer or framework code.
 * The function is deterministic: output capability and module ordering follows
 * the registry's stable capability order rather than request ordering.
 */
export function resolveCapabilities(
  input: CapabilityResolutionInput,
  registry: CapabilityRegistry = CAPABILITY_REGISTRY,
): CapabilityResolutionResult {
  const registryErrors = validateCapabilityRegistry(registry);
  if (registryErrors.length > 0) {
    return invalidRegistryResult(input, registryErrors);
  }

  const active = new Set(input.requestedCapabilities);
  addTransitiveDependencies(active, registry);

  const state: ResolutionState = {
    input,
    registry,
    active,
    blocked: new Set(),
    issues: [],
    fallbacks: [],
  };

  resolveAvailability(state);
  resolveSemanticConfiguration(state);
  resolveDeviceRequirements(state);
  resolveMediaRequirements(state);
  resolveDependencies(state);
  resolveIncompatibilities(state);
  // An incompatibility may remove a capability which another feature needs.
  resolveDependencies(state);

  const capabilities = CAPABILITY_IDS.filter(
    (id) => active.has(id) && !state.blocked.has(id),
  );
  const moduleDeclarations = buildModuleDeclarations(capabilities, registry);
  const issues = Object.freeze([...state.issues]);
  const fallbacks = Object.freeze([...state.fallbacks]);

  return Object.freeze({
    valid: issues.every((issue) => issue.severity !== 'error'),
    capabilities: Object.freeze(capabilities),
    runtimeModules: Object.freeze(moduleDeclarations.map((module) => module.id)),
    moduleDeclarations,
    issues,
    fallbacks,
  });
}

export class CapabilityResolver {
  readonly registry: CapabilityRegistry;

  constructor(registry: CapabilityRegistry = CAPABILITY_REGISTRY) {
    this.registry = registry;
  }

  resolve(input: CapabilityResolutionInput): CapabilityResolutionResult {
    return resolveCapabilities(input, this.registry);
  }
}

function addTransitiveDependencies(
  active: Set<CapabilityId>,
  registry: CapabilityRegistry,
): void {
  const pending = [...active];
  for (let index = 0; index < pending.length; index += 1) {
    const id = pending[index];
    if (id === undefined) {
      continue;
    }
    for (const dependency of registry[id].dependencies) {
      if (!active.has(dependency)) {
        active.add(dependency);
        pending.push(dependency);
      }
    }
  }
}

function resolveAvailability(state: ResolutionState): void {
  for (const id of orderedActiveCapabilities(state)) {
    const definition = state.registry[id];
    if (definition.availability !== 'available') {
      failCapability(state, {
        capabilityId: id,
        code: 'FEATURE_UNAVAILABLE',
        message: `${definition.productFeature} is not available yet.`,
        alternatives: definition.fallback?.alternatives,
      });
    }
  }
}

function resolveSemanticConfiguration(state: ResolutionState): void {
  if (isUsable(state, 'videoTimeline')
    && (state.input.configuration?.timelineInteractionCount ?? 0) === 0) {
    failCapability(state, {
      capabilityId: 'videoTimeline',
      code: 'FEATURE_NOT_CONFIGURED',
      message: 'The video timeline is enabled but has no interactions.',
      alternatives: ['Add a timed interaction', 'Play the video without timed interactions'],
    });
  }

  if (isUsable(state, 'compass')
    && state.input.configuration?.compassEnabled !== true) {
    failCapability(state, {
      capabilityId: 'compass',
      code: 'FEATURE_NOT_CONFIGURED',
      message: 'Compass is enabled as a feature but is not configured for this experience.',
      alternatives: ['Enable Compass in viewer controls', 'Continue without Compass'],
    });
  }

  if (!isUsable(state, 'viewLimits')) {
    return;
  }

  const viewLimits = state.input.configuration?.viewLimits;
  if (viewLimits === undefined || !hasConfiguredViewLimit(viewLimits)) {
    failCapability(state, {
      capabilityId: 'viewLimits',
      code: 'FEATURE_NOT_CONFIGURED',
      message: 'Allowed viewing area is enabled but no viewing limits are configured.',
      alternatives: ['Set an allowed viewing area', 'Continue without viewing limits'],
    });
    return;
  }

  if (!areViewLimitsValid(viewLimits)) {
    failCapability(state, {
      capabilityId: 'viewLimits',
      code: 'FEATURE_CONFIGURATION_INVALID',
      message: 'The allowed viewing area contains invalid bounds.',
      alternatives: ['Keep heading between -180 and 180 degrees', 'Keep pitch between -90 and 90 degrees'],
    });
  }
}

function resolveDeviceRequirements(state: ResolutionState): void {
  const available = new Set(state.input.availableDeviceRequirements ?? []);
  for (const id of orderedUsableCapabilities(state)) {
    const definition = state.registry[id];
    if (definition.deviceRequirements.some((requirement) => !available.has(requirement))) {
      failCapability(state, {
        capabilityId: id,
        code: 'FEATURE_DEVICE_UNAVAILABLE',
        message: `${definition.productFeature} is not available on this device.`,
        alternatives: definition.fallback?.alternatives,
      });
    }
  }
}

function resolveMediaRequirements(state: ResolutionState): void {
  const declaredReady = new Set(state.input.availableMediaRequirements ?? []);
  const references = state.input.assetReferences ?? [];

  for (const id of orderedUsableCapabilities(state)) {
    const definition = state.registry[id];
    const capabilityReferences = references.filter((reference) => reference.capabilityId === id);
    const invalidReference = capabilityReferences.find((reference) => reference.state !== 'ready');
    if (invalidReference !== undefined) {
      failCapability(state, assetReferenceFailure(definition, invalidReference));
      continue;
    }

    const readyFromReferences = new Set(
      capabilityReferences
        .filter((reference) => reference.state === 'ready')
        .map((reference) => reference.requirement),
    );
    const missingRequirement = definition.mediaRequirements.find(
      (requirement) => !declaredReady.has(requirement) && !readyFromReferences.has(requirement),
    );
    if (missingRequirement !== undefined) {
      failCapability(state, {
        capabilityId: id,
        code: 'FEATURE_MEDIA_REQUIRED',
        message: `${definition.productFeature} requires prepared media that is not ready yet.`,
        alternatives: definition.fallback?.alternatives,
      });
    }
  }
}

function resolveDependencies(state: ResolutionState): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of orderedUsableCapabilities(state)) {
      const unavailableDependency = state.registry[id].dependencies.find(
        (dependency) => !state.active.has(dependency) || state.blocked.has(dependency),
      );
      if (unavailableDependency !== undefined) {
        failCapability(state, {
          capabilityId: id,
          code: 'FEATURE_DEPENDENCY_UNAVAILABLE',
          message: `${state.registry[id].productFeature} requires ${state.registry[unavailableDependency].productFeature}, which is unavailable.`,
          capabilityIds: [id, unavailableDependency],
          alternatives: state.registry[id].fallback?.alternatives,
        });
        changed = true;
      }
    }
  }
}

function resolveIncompatibilities(state: ResolutionState): void {
  const usable = orderedUsableCapabilities(state);
  for (let leftIndex = 0; leftIndex < usable.length; leftIndex += 1) {
    const left = usable[leftIndex];
    if (left === undefined || state.blocked.has(left)) {
      continue;
    }
    for (let rightIndex = leftIndex + 1; rightIndex < usable.length; rightIndex += 1) {
      const right = usable[rightIndex];
      if (right === undefined || state.blocked.has(right)) {
        continue;
      }
      if (!areIncompatible(left, right, state.registry)) {
        continue;
      }

      const disabled = chooseIncompatibilityFallback(left, right, state);
      const retained = disabled === left ? right : left;
      failCapability(state, {
        capabilityId: disabled,
        code: 'FEATURE_COMBINATION_UNAVAILABLE',
        message: `${state.registry[left].productFeature} is not available together with ${state.registry[right].productFeature}.`,
        capabilityIds: [left, right],
        alternatives: state.registry[disabled].fallback?.alternatives
          ?? [`Continue without ${state.registry[disabled].productFeature}`, `Keep ${state.registry[retained].productFeature}`],
      });
    }
  }
}

function chooseIncompatibilityFallback(
  left: CapabilityId,
  right: CapabilityId,
  state: ResolutionState,
): CapabilityId {
  if ((state.input.fallbackMode ?? 'apply') === 'apply') {
    const leftHasFallback = state.registry[left].fallback !== null;
    const rightHasFallback = state.registry[right].fallback !== null;
    if (leftHasFallback !== rightHasFallback) {
      return leftHasFallback ? left : right;
    }
  }
  // Registry order is the platform priority: retain the earlier/core feature.
  return right;
}

function failCapability(state: ResolutionState, failure: CapabilityFailure): void {
  if (state.blocked.has(failure.capabilityId)) {
    return;
  }

  const definition = state.registry[failure.capabilityId];
  const fallback = definition.fallback;
  const applyFallback = (state.input.fallbackMode ?? 'apply') === 'apply' && fallback !== null;
  state.blocked.add(failure.capabilityId);

  if (applyFallback) {
    state.fallbacks.push(Object.freeze({
      capabilityId: failure.capabilityId,
      behavior: fallback.behavior,
      reason: failure.code,
      message: fallback.message,
    }));
    state.issues.push(issue({
      ...failure,
      code: 'FEATURE_FALLBACK_APPLIED',
      message: `${failure.message} ${fallback.message}`,
      alternatives: fallback.alternatives,
    }, state.input.projectId, 'warning'));
    return;
  }

  state.issues.push(issue(failure, state.input.projectId, 'error'));
}

function issue(
  failure: CapabilityFailure,
  defaultEntityId: string,
  severity: CapabilityIssue['severity'],
): CapabilityIssue {
  return Object.freeze({
    code: failure.code,
    severity,
    entityId: failure.entityId ?? defaultEntityId,
    path: failure.path ?? CAPABILITY_PATHS[failure.capabilityId],
    message: failure.message,
    alternatives: Object.freeze([...(failure.alternatives ?? [])]),
    capabilityIds: Object.freeze([...(failure.capabilityIds ?? [failure.capabilityId])]),
  });
}

function assetReferenceFailure(
  definition: CapabilityDefinition,
  reference: CapabilityAssetReference,
): CapabilityFailure {
  const missing = reference.state === 'missing';
  return {
    capabilityId: definition.id,
    code: missing ? 'CONTENT_ASSET_NOT_FOUND' : 'CONTENT_ASSET_NOT_READY',
    entityId: reference.entityId ?? reference.assetId,
    path: reference.path ?? `assets.${reference.assetId}`,
    message: missing
      ? `A referenced asset for ${definition.productFeature} could not be found.`
      : `A referenced asset for ${definition.productFeature} is not ready.`,
    alternatives: definition.fallback?.alternatives,
  };
}

function buildModuleDeclarations(
  capabilities: readonly CapabilityId[],
  registry: CapabilityRegistry,
): readonly RuntimeModuleDeclaration[] {
  const modules = new Map<string, { capabilities: CapabilityId[]; eager: boolean }>();
  for (const id of capabilities) {
    const definition = registry[id];
    const existing = modules.get(definition.rendererModule);
    if (existing === undefined) {
      modules.set(definition.rendererModule, {
        capabilities: [id],
        eager: definition.lazyLoadModule === null,
      });
      continue;
    }
    existing.capabilities.push(id);
    existing.eager ||= definition.lazyLoadModule === null;
  }

  return Object.freeze([...modules.entries()].map(([id, module]) => Object.freeze({
    id,
    load: module.eager ? 'eager' : 'lazy',
    capabilities: Object.freeze([...module.capabilities]),
  })));
}

function hasConfiguredViewLimit(limits: CapabilityViewLimits): boolean {
  return limits.minHeadingDegrees !== undefined
    || limits.maxHeadingDegrees !== undefined
    || limits.minPitchDegrees !== undefined
    || limits.maxPitchDegrees !== undefined;
}

function areViewLimitsValid(limits: CapabilityViewLimits): boolean {
  const values = [
    [limits.minHeadingDegrees, -180, 180],
    [limits.maxHeadingDegrees, -180, 180],
    [limits.minPitchDegrees, -90, 90],
    [limits.maxPitchDegrees, -90, 90],
  ] as const;
  if (values.some(([value, minimum, maximum]) => value !== undefined
    && (!Number.isFinite(value) || value < minimum || value > maximum))) {
    return false;
  }
  return !(
    limits.minHeadingDegrees !== undefined
      && limits.maxHeadingDegrees !== undefined
      && limits.minHeadingDegrees > limits.maxHeadingDegrees
  ) && !(
    limits.minPitchDegrees !== undefined
      && limits.maxPitchDegrees !== undefined
      && limits.minPitchDegrees > limits.maxPitchDegrees
  );
}

function orderedActiveCapabilities(state: ResolutionState): CapabilityId[] {
  return CAPABILITY_IDS.filter((id) => state.active.has(id));
}

function orderedUsableCapabilities(state: ResolutionState): CapabilityId[] {
  return CAPABILITY_IDS.filter((id) => isUsable(state, id));
}

function isUsable(state: ResolutionState, id: CapabilityId): boolean {
  return state.active.has(id) && !state.blocked.has(id);
}

function areIncompatible(
  left: CapabilityId,
  right: CapabilityId,
  registry: CapabilityRegistry,
): boolean {
  return registry[left].incompatibilities.includes(right)
    || registry[right].incompatibilities.includes(left);
}

function invalidRegistryResult(
  input: CapabilityResolutionInput,
  registryErrors: readonly string[],
): CapabilityResolutionResult {
  const issues = Object.freeze(registryErrors.map(() => Object.freeze({
    code: 'FEATURE_CONFIGURATION_INVALID' as const,
    severity: 'error' as const,
    entityId: input.projectId,
    path: 'capabilities',
    message: 'The platform feature configuration is temporarily unavailable.',
    alternatives: Object.freeze([]),
    capabilityIds: Object.freeze([]),
  })));
  return Object.freeze({
    valid: false,
    capabilities: Object.freeze([]),
    runtimeModules: Object.freeze([]),
    moduleDeclarations: Object.freeze([]),
    issues,
    fallbacks: Object.freeze([]),
  });
}
