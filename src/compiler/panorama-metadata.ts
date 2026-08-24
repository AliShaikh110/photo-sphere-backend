import type { CanonicalAsset, JsonObject } from '../domain/types';

export interface CompiledPanoramaCrop {
  readonly fullWidthPixels: number;
  readonly fullHeightPixels: number;
  readonly croppedWidthPixels: number;
  readonly croppedHeightPixels: number;
  readonly croppedLeftPixels: number;
  readonly croppedTopPixels: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/** Converts persisted GPano metadata to renderer-independent crop geometry. */
export function readPanoramaCrop(asset: CanonicalAsset): CompiledPanoramaCrop | undefined {
  if (asset.projection !== 'cropped_equirectangular') return undefined;
  const metadata = record(asset.metadata as JsonObject | undefined);
  const xmp = record(metadata?.xmp);
  const fullWidthPixels = positiveInteger(xmp?.fullPanoWidthPixels);
  const fullHeightPixels = positiveInteger(xmp?.fullPanoHeightPixels);
  const croppedWidthPixels = positiveInteger(xmp?.croppedAreaImageWidthPixels)
    ?? positiveInteger(metadata?.width);
  const croppedHeightPixels = positiveInteger(xmp?.croppedAreaImageHeightPixels)
    ?? positiveInteger(metadata?.height);
  if (!fullWidthPixels || !fullHeightPixels || !croppedWidthPixels || !croppedHeightPixels) {
    return undefined;
  }
  const croppedLeftPixels = nonNegativeInteger(xmp?.croppedAreaLeftPixels)
    ?? Math.round((fullWidthPixels - croppedWidthPixels) / 2);
  const croppedTopPixels = nonNegativeInteger(xmp?.croppedAreaTopPixels)
    ?? Math.round((fullHeightPixels - croppedHeightPixels) / 2);
  if (
    croppedLeftPixels < 0
    || croppedTopPixels < 0
    || croppedLeftPixels + croppedWidthPixels > fullWidthPixels
    || croppedTopPixels + croppedHeightPixels > fullHeightPixels
    || Math.abs(fullWidthPixels / fullHeightPixels - 2) > 0.01
  ) {
    return undefined;
  }
  return {
    fullWidthPixels,
    fullHeightPixels,
    croppedWidthPixels,
    croppedHeightPixels,
    croppedLeftPixels,
    croppedTopPixels
  };
}
