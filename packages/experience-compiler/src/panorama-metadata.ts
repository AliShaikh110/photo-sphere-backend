import type {
  CanonicalAsset,
  CompiledPanoramaCrop,
  CompiledSphereCorrection,
  JsonObject,
} from '@alishaikh110/experience-schema';



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



function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Wraps to (-180, 180]; a pose of 360 degrees is the same view as 0. */
function wrapDegrees(value: number, limit: number): number {
  const span = limit * 2;
  const wrapped = ((value + limit) % span + span) % span - limit;
  // -180 and 180 name the same heading; prefer the positive representation so
  // the compiled value is stable across equivalent inputs.
  return Object.is(wrapped, -0) ? 0 : wrapped === -limit ? limit : wrapped;
}

function clampDegrees(value: number, limit: number): number {
  return Math.min(limit, Math.max(-limit, value));
}

function roundDegrees(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * The GPano pose of a panorama, expressed as the product-level "straighten"
 * correction. A camera that was not level when it captured the sphere records
 * how far off it was; applying the inverse is what puts the horizon back where
 * a viewer expects it.
 *
 * Returns undefined when the pose is absent or already level, so a correction
 * only ever appears in a manifest when it changes what a visitor sees.
 */
export function readPanoramaSphereCorrection(
  asset: Pick<CanonicalAsset, 'metadata'>,
): CompiledSphereCorrection | undefined {
  const metadata = record(asset.metadata as JsonObject | undefined);
  const xmp = record(metadata?.xmp);
  if (xmp === undefined) return undefined;
  const headingDegrees = roundDegrees(
    wrapDegrees(finiteNumber(xmp.poseHeadingDegrees) ?? 0, 180),
  );
  const pitchDegrees = roundDegrees(
    clampDegrees(finiteNumber(xmp.posePitchDegrees) ?? 0, 90),
  );
  const rollDegrees = roundDegrees(
    wrapDegrees(finiteNumber(xmp.poseRollDegrees) ?? 0, 180),
  );
  if (headingDegrees === 0 && pitchDegrees === 0 && rollDegrees === 0) return undefined;
  return { headingDegrees, pitchDegrees, rollDegrees };
}

/**
 * The initial view the capture device recorded for a panorama. It seeds a new
 * scene so the first thing a visitor sees is what the photographer framed,
 * rather than whichever direction happens to be pixel column zero.
 */
export function readPanoramaInitialView(asset: Pick<CanonicalAsset, 'metadata'>): {
  readonly headingDegrees?: number;
  readonly pitchDegrees?: number;
  readonly horizontalFovDegrees?: number;
} | undefined {
  const metadata = record(asset.metadata as JsonObject | undefined);
  const xmp = record(metadata?.xmp);
  if (xmp === undefined) return undefined;
  const heading = finiteNumber(xmp.initialViewHeadingDegrees);
  const pitch = finiteNumber(xmp.initialViewPitchDegrees);
  const fov = finiteNumber(xmp.initialViewFovDegrees);
  const initialView = {
    ...(heading === undefined ? {} : { headingDegrees: roundDegrees(wrapDegrees(heading, 180)) }),
    ...(pitch === undefined ? {} : { pitchDegrees: roundDegrees(clampDegrees(pitch, 90)) }),
    // The canonical schema accepts 30-120 degrees; a value outside that range
    // is a capture artefact rather than an intent worth preserving.
    ...(fov === undefined || fov < 30 || fov > 120
      ? {}
      : { horizontalFovDegrees: roundDegrees(fov) }),
  };
  return Object.keys(initialView).length === 0 ? undefined : initialView;
}
