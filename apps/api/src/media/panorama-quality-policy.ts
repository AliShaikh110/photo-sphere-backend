export const PANORAMA_TILING_POLICY_VERSION = 'panorama-tiling-v1' as const;

export type PanoramaTilingPolicy = {
  readonly enabled: boolean;
  /** A panorama at or above this width is a tiling candidate. */
  readonly minimumSourceWidth: number;
  /** A smaller panorama can still qualify when its encoded source is unusually large. */
  readonly minimumSourceBytes: number;
  /** Do not create tiled levels at or below the ordinary web-derivative range. */
  readonly minimumLevelWidth: number;
  readonly tileSize: number;
  readonly tileQuality: number;
  readonly maximumLevels: number;
};

export type PanoramaTilingPolicyInput = {
  readonly width: number;
  readonly height: number;
  readonly sizeBytes: number;
  readonly projection: 'equirectangular' | 'cropped_equirectangular';
};

export type PanoramaTilingDecision = {
  readonly policyVersion: typeof PANORAMA_TILING_POLICY_VERSION;
  readonly generateTiles: boolean;
  readonly reason: 'disabled' | 'below-high-detail-range' | 'below-trigger' | 'qualified';
  readonly triggeredBy: readonly ('source-width' | 'source-size')[];
  /** Widths are ordered from the lowest-detail tiled level to the source-detail level. */
  readonly levelWidths: readonly number[];
};

export const DEFAULT_PANORAMA_TILING_POLICY: PanoramaTilingPolicy = Object.freeze({
  enabled: true,
  minimumSourceWidth: 6_144,
  minimumSourceBytes: 12 * 1024 * 1024,
  minimumLevelWidth: 4_096,
  tileSize: 512,
  tileQuality: 82,
  maximumLevels: 4
});

/**
 * Product/media policy only. It deliberately does not contain viewer adapter
 * options; the compiler owns translation from this canonical media output.
 */
export function resolvePanoramaTilingPolicy(
  input: PanoramaTilingPolicyInput,
  policy: PanoramaTilingPolicy = DEFAULT_PANORAMA_TILING_POLICY
): PanoramaTilingDecision {
  assertPolicy(policy);
  assertPositiveInteger(input.width, 'width');
  assertPositiveInteger(input.height, 'height');
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 0) {
    throw new TypeError('Panorama source sizeBytes must be a non-negative integer.');
  }

  if (!policy.enabled) return decision(false, 'disabled');
  if (input.width <= policy.minimumLevelWidth) {
    return decision(false, 'below-high-detail-range');
  }

  const triggeredBy: ('source-width' | 'source-size')[] = [];
  if (input.width >= policy.minimumSourceWidth) triggeredBy.push('source-width');
  if (input.sizeBytes >= policy.minimumSourceBytes) triggeredBy.push('source-size');
  if (triggeredBy.length === 0) return decision(false, 'below-trigger');

  const levelWidths = [input.width];
  let nextWidth = Math.floor(input.width / 2);
  while (nextWidth > policy.minimumLevelWidth && levelWidths.length < policy.maximumLevels) {
    levelWidths.push(nextWidth);
    nextWidth = Math.floor(nextWidth / 2);
  }
  levelWidths.reverse();

  return {
    policyVersion: PANORAMA_TILING_POLICY_VERSION,
    generateTiles: true,
    reason: 'qualified',
    triggeredBy,
    levelWidths
  };
}

function decision(
  generateTiles: false,
  reason: Exclude<PanoramaTilingDecision['reason'], 'qualified'>
): PanoramaTilingDecision {
  return {
    policyVersion: PANORAMA_TILING_POLICY_VERSION,
    generateTiles,
    reason,
    triggeredBy: [],
    levelWidths: []
  };
}

function assertPolicy(policy: PanoramaTilingPolicy): void {
  assertPositiveInteger(policy.minimumSourceWidth, 'minimumSourceWidth');
  assertPositiveInteger(policy.minimumSourceBytes, 'minimumSourceBytes');
  assertPositiveInteger(policy.minimumLevelWidth, 'minimumLevelWidth');
  assertPositiveInteger(policy.tileSize, 'tileSize');
  assertPositiveInteger(policy.maximumLevels, 'maximumLevels');
  if (!Number.isInteger(policy.tileQuality) || policy.tileQuality < 1 || policy.tileQuality > 100) {
    throw new TypeError('Panorama tiling tileQuality must be an integer from 1 through 100.');
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`Panorama tiling ${field} must be a positive integer.`);
  }
}
