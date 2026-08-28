import type { PanoramaDerivativeFamily } from '@sphere/experience-schema';
import type { RuntimeDeviceClass, RuntimeNetworkClass } from '@sphere/experience-schema';

export const QUALITY_POLICY_VERSION = 'panorama-quality-v1' as const;

export const QUALITY_CLASSES = ['dataSaver', 'standard', 'high'] as const;
export type QualityClass = (typeof QUALITY_CLASSES)[number];

/** What the media pipeline actually produced for one logical panorama. */
export interface AvailablePanoramaFamilies {
  readonly standardEquirectangular: boolean;
  readonly tiledEquirectangular: boolean;
  readonly cubemap: boolean;
  readonly tiledCubemap: boolean;
}

export interface QualityPolicyInput {
  readonly requested: QualityClass | 'automatic';
  readonly available: AvailablePanoramaFamilies;
  readonly deviceClass?: RuntimeDeviceClass;
  readonly networkClass?: RuntimeNetworkClass;
  readonly viewportWidth?: number;
  readonly sourceWidth?: number;
}

export interface QualityPolicyDecision {
  readonly policyVersion: typeof QUALITY_POLICY_VERSION;
  readonly family: PanoramaDerivativeFamily;
  /** Ordered alternatives the runtime may drop to, best first. */
  readonly fallbackFamilies: readonly PanoramaDerivativeFamily[];
  readonly qualityClass: QualityClass;
  readonly reason:
    | 'only-standard-available'
    | 'data-saver'
    | 'constrained-device'
    | 'high-detail-requested'
    | 'high-detail-available'
    | 'standard-sufficient';
}

/**
 * Chooses a panorama delivery family from what the pipeline produced and what
 * the visitor's context can use. It deliberately names media families rather
 * than renderer adapters: the integration adapter maps a family to a renderer.
 */
export function resolvePanoramaQuality(input: QualityPolicyInput): QualityPolicyDecision {
  const ordered = orderedAvailableFamilies(input.available);
  if (ordered.length === 0) {
    return decision('standardEquirectangular', [], 'standard', 'only-standard-available');
  }

  const detailed = ordered.filter(isHighDetailFamily);
  const plain = ordered.filter((family) => !isHighDetailFamily(family));
  const fallbacks = (family: PanoramaDerivativeFamily): PanoramaDerivativeFamily[] =>
    ordered.filter((candidate) => candidate !== family);

  if (detailed.length === 0) {
    const family = plain[0] ?? 'standardEquirectangular';
    return decision(family, fallbacks(family), 'standard', 'only-standard-available');
  }

  const qualityClass = resolveQualityClass(input);
  if (qualityClass === 'dataSaver' && plain.length > 0) {
    const family = plain[0]!;
    return decision(family, fallbacks(family), qualityClass, 'data-saver');
  }
  if (qualityClass === 'standard'
    && input.deviceClass === 'constrained'
    && plain.length > 0) {
    const family = plain[0]!;
    return decision(family, fallbacks(family), qualityClass, 'constrained-device');
  }
  if (qualityClass === 'standard' && input.requested === 'automatic' && plain.length > 0
    && !warrantsHighDetail(input)) {
    const family = plain[0]!;
    return decision(family, fallbacks(family), qualityClass, 'standard-sufficient');
  }

  const family = detailed[0]!;
  return decision(
    family,
    fallbacks(family),
    qualityClass,
    input.requested === 'high' ? 'high-detail-requested' : 'high-detail-available',
  );
}

function resolveQualityClass(input: QualityPolicyInput): QualityClass {
  if (input.requested !== 'automatic') return input.requested;
  if (input.networkClass === 'constrained' || input.networkClass === 'offline') {
    return 'dataSaver';
  }
  return 'standard';
}

/**
 * Automatic mode only pays for tiled detail when the panorama is meaningfully
 * larger than the viewport can already show.
 */
function warrantsHighDetail(input: QualityPolicyInput): boolean {
  if (input.sourceWidth === undefined || input.viewportWidth === undefined) return true;
  return input.sourceWidth >= input.viewportWidth * 4;
}

function orderedAvailableFamilies(
  available: AvailablePanoramaFamilies,
): readonly PanoramaDerivativeFamily[] {
  // Detail first, then plain: callers pick by class, and this order is the
  // stable preference within each group.
  const order: readonly PanoramaDerivativeFamily[] = [
    'tiledEquirectangular',
    'tiledCubemap',
    'standardEquirectangular',
    'cubemap',
  ];
  return order.filter((family) => available[family]);
}

function isHighDetailFamily(family: PanoramaDerivativeFamily): boolean {
  return family === 'tiledEquirectangular' || family === 'tiledCubemap';
}

function decision(
  family: PanoramaDerivativeFamily,
  fallbackFamilies: readonly PanoramaDerivativeFamily[],
  qualityClass: QualityClass,
  reason: QualityPolicyDecision['reason'],
): QualityPolicyDecision {
  return Object.freeze({
    policyVersion: QUALITY_POLICY_VERSION,
    family,
    fallbackFamilies: Object.freeze([...fallbackFamilies]),
    qualityClass,
    reason,
  });
}
