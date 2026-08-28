import type {
  AssetDerivative,
  AssetDerivativeKind,
  CanonicalAsset,
} from '../domain/types';

export const BASELINE_PANORAMA_DERIVATIVE_KINDS = [
  'lowResolutionBase',
  'standardWeb',
] as const satisfies readonly AssetDerivativeKind[];

export interface SelectedPanoramaDerivatives {
  readonly lowResolutionBase: AssetDerivative;
  readonly standardWeb: AssetDerivative;
  readonly tiledLevels?: AssetDerivative;
}

/** Catalog entries pre-dating per-derivative readiness are already persisted outputs. */
export function isDerivativeReady(derivative: AssetDerivative): boolean {
  return derivative.readiness === undefined || derivative.readiness === 'ready';
}

export function selectLatestReadyDerivative(
  derivatives: readonly AssetDerivative[],
  kind: AssetDerivativeKind,
): AssetDerivative | undefined {
  return derivatives
    .filter((candidate) => candidate.kind === kind && isDerivativeReady(candidate))
    .sort(compareDerivativeCandidates)[0];
}

export function selectPreferredReadyDerivative(
  asset: Pick<CanonicalAsset, 'derivatives'>,
  priority: readonly AssetDerivativeKind[] = [
    'standardWeb',
    'lowResolutionBase',
    'thumbnail',
  ],
): AssetDerivative | undefined {
  for (const kind of priority) {
    const selected = selectLatestReadyDerivative(asset.derivatives, kind);
    if (selected !== undefined) {
      return selected;
    }
  }
  return undefined;
}

export function selectPanoramaDerivatives(
  asset: Pick<CanonicalAsset, 'id' | 'derivatives'>,
): SelectedPanoramaDerivatives | undefined {
  const versions = [...new Set(asset.derivatives
    .filter((candidate) => isDerivativeReady(candidate))
    .map((candidate) => candidate.version))]
    .sort((left, right) => right - left);
  for (const version of versions) {
    const versionDerivatives = asset.derivatives.filter(
      (candidate) => candidate.version === version && isDerivativeReady(candidate),
    );
    const lowResolutionBase = versionDerivatives
      .filter((candidate) => candidate.kind === 'lowResolutionBase')
      .sort(compareDerivativeCandidates)[0];
    const standardWeb = versionDerivatives
      .filter((candidate) => candidate.kind === 'standardWeb')
      .sort(compareDerivativeCandidates)[0];
    if (lowResolutionBase === undefined || standardWeb === undefined) continue;
    const tiledLevels = versionDerivatives
      .filter((candidate) => candidate.kind === 'tiledLevels')
      .sort(compareDerivativeCandidates)[0];
    return Object.freeze({
      lowResolutionBase,
      standardWeb,
      ...(tiledLevels === undefined ? {} : { tiledLevels }),
    });
  }
  return undefined;
}

export class DerivativeSelectionError extends Error {
  readonly code = 'REQUIRED_DERIVATIVE_MISSING';
  readonly assetId: string;
  readonly missingKinds: readonly AssetDerivativeKind[];

  constructor(asset: Pick<CanonicalAsset, 'id' | 'derivatives'>) {
    const missingKinds = BASELINE_PANORAMA_DERIVATIVE_KINDS.filter(
      (kind) => selectLatestReadyDerivative(asset.derivatives, kind) === undefined,
    );
    super(`Asset ${asset.id} is missing required ready derivatives: ${missingKinds.join(', ')}.`);
    this.name = 'DerivativeSelectionError';
    this.assetId = asset.id;
    this.missingKinds = Object.freeze([...missingKinds]);
  }
}

export function requirePanoramaDerivatives(
  asset: Pick<CanonicalAsset, 'id' | 'derivatives'>,
): SelectedPanoramaDerivatives {
  const selected = selectPanoramaDerivatives(asset);
  if (selected === undefined) {
    throw new DerivativeSelectionError(asset);
  }
  return selected;
}

/**
 * The media a gallery or scene index shows for one scene. The dedicated
 * thumbnail derivative is preferred over the much larger low-resolution base so
 * a 100-scene index stays light; the derivative generation of the panorama is
 * kept intact, and a catalog without a ready thumbnail falls back to the base.
 */
export function selectSceneIndexThumbnail(
  asset: Pick<CanonicalAsset, 'derivatives'>,
  panorama: SelectedPanoramaDerivatives,
): AssetDerivative {
  const sameGeneration = asset.derivatives
    .filter((candidate) => candidate.kind === 'thumbnail'
      && candidate.version === panorama.lowResolutionBase.version
      && isDerivativeReady(candidate))
    .sort(compareDerivativeCandidates)[0];
  return sameGeneration
    ?? selectLatestReadyDerivative(asset.derivatives, 'thumbnail')
    ?? panorama.lowResolutionBase;
}

function compareDerivativeCandidates(left: AssetDerivative, right: AssetDerivative): number {
  if (left.version !== right.version) {
    return right.version - left.version;
  }

  const leftCreatedAt = timestamp(left.createdAt);
  const rightCreatedAt = timestamp(right.createdAt);
  if (leftCreatedAt !== rightCreatedAt) {
    return rightCreatedAt - leftCreatedAt;
  }

  const byId = left.id.localeCompare(right.id);
  return byId === 0 ? left.storageKey.localeCompare(right.storageKey) : byId;
}

function timestamp(value: Date | string | undefined): number {
  if (value === undefined) {
    return 0;
  }
  const result = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(result) ? result : 0;
}

export interface PanoramaFamilyDerivatives {
  readonly standardEquirectangular?: AssetDerivative;
  readonly tiledEquirectangular?: AssetDerivative;
  readonly cubemap?: AssetDerivative;
  readonly tiledCubemap?: AssetDerivative;
}

/**
 * The delivery families available for one logical panorama. Only the newest
 * ready derivative version participates, so a partially reprocessed asset
 * never mixes generations inside a single published scene.
 */
export function selectPanoramaFamilyDerivatives(
  asset: Pick<CanonicalAsset, 'id' | 'derivatives'>,
): PanoramaFamilyDerivatives {
  const baseline = selectPanoramaDerivatives(asset);
  if (baseline === undefined) {
    return Object.freeze({});
  }
  const version = baseline.standardWeb.version;
  const ofKind = (kind: AssetDerivativeKind): AssetDerivative | undefined => asset.derivatives
    .filter((candidate) => candidate.kind === kind
      && candidate.version === version
      && isDerivativeReady(candidate))
    .sort(compareByRecency)[0];

  return Object.freeze({
    standardEquirectangular: baseline.standardWeb,
    ...(baseline.tiledLevels === undefined ? {} : { tiledEquirectangular: baseline.tiledLevels }),
    ...(ofKind('cubemap') === undefined ? {} : { cubemap: ofKind('cubemap')! }),
    ...(ofKind('tiledCubemap') === undefined ? {} : { tiledCubemap: ofKind('tiledCubemap')! }),
  });
}

function compareByRecency(left: AssetDerivative, right: AssetDerivative): number {
  const byId = left.id.localeCompare(right.id);
  return byId === 0 ? left.storageKey.localeCompare(right.storageKey) : byId;
}
