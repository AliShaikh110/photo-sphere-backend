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
  const lowResolutionBase = selectLatestReadyDerivative(
    asset.derivatives,
    'lowResolutionBase',
  );
  const standardWeb = selectLatestReadyDerivative(asset.derivatives, 'standardWeb');
  if (lowResolutionBase === undefined || standardWeb === undefined) {
    return undefined;
  }
  return Object.freeze({ lowResolutionBase, standardWeb });
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

