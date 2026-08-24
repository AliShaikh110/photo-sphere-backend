import sharp, { type Metadata, type Sharp } from 'sharp';
import { AppError } from '../errors/app-error';
import { sha256 } from '../utils/hash';
import type { SupportedImageMime } from './file-policy';
import {
  DEFAULT_PANORAMA_TILING_POLICY,
  resolvePanoramaTilingPolicy,
  type PanoramaTilingDecision,
  type PanoramaTilingPolicy
} from './panorama-quality-policy';
import { extractGpanoMetadata, type GpanoMetadata } from './xmp';

export type ImageInspection = {
  width: number;
  height: number;
  aspectRatio: number;
  format: string;
  mimeType: SupportedImageMime;
  sizeBytes: number;
  hasAlpha: boolean;
  orientation?: number;
  projection: 'equirectangular' | 'cropped_equirectangular' | 'unknown';
  is360: boolean;
  isFullSphere: boolean;
  xmp?: GpanoMetadata;
};

export type PanoramaInspection = ImageInspection & {
  projection: 'equirectangular' | 'cropped_equirectangular';
  is360: true;
};

export type GeneratedStorageObject = {
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  body: Buffer;
  metadata: Record<string, string>;
};

export type GeneratedDerivative = {
  kind: 'thumbnail' | 'lowResolutionBase' | 'standardWeb' | 'tiledLevels';
  version: number;
  storageKey: string;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  checksum: string;
  body: Buffer;
  metadata: Record<string, unknown>;
  /** Supporting immutable objects which must be stored before the parent object. */
  supportingObjects?: readonly GeneratedStorageObject[];
};

export async function inspectPanorama(options: {
  bytes: Buffer;
  mimeType: SupportedImageMime;
  maxPixels: number;
}): Promise<PanoramaInspection> {
  const decoded = await inspectDecodedImage(options);
  const { metadata, xmp } = decoded;
  const orientedWidth = metadata.autoOrient.width;
  const orientedHeight = metadata.autoOrient.height;
  const aspectRatio = orientedWidth / orientedHeight;
  const hasFullPano = isPositivePixelCount(xmp?.fullPanoWidthPixels)
    && isPositivePixelCount(xmp?.fullPanoHeightPixels);
  if (hasFullPano) {
    validateGpanoCrop(xmp!, orientedWidth, orientedHeight);
  }
  const isCropped = hasFullPano && (
    xmp?.fullPanoWidthPixels !== orientedWidth || xmp?.fullPanoHeightPixels !== orientedHeight
  );
  const equirectangularByShape = Math.abs(aspectRatio - 2) <= 0.08;
  const equirectangularByXmp = xmp?.projectionType?.toLowerCase() === 'equirectangular' || hasFullPano;
  if (!equirectangularByShape && !equirectangularByXmp) {
    throw new AppError('PANORAMA_NOT_DETECTED', 'The image is not a supported 360 panorama.', {
      status: 422,
      details: { width: orientedWidth, height: orientedHeight, aspectRatio }
    });
  }
  return inspectionResult(options, decoded, {
    projection: isCropped ? 'cropped_equirectangular' : 'equirectangular',
    is360: true,
    isFullSphere: !isCropped
  }) as PanoramaInspection;
}

function isPositivePixelCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function validateGpanoCrop(xmp: GpanoMetadata, imageWidth: number, imageHeight: number): void {
  const fullWidth = xmp.fullPanoWidthPixels!;
  const fullHeight = xmp.fullPanoHeightPixels!;
  const croppedWidth = xmp.croppedAreaImageWidthPixels ?? imageWidth;
  const croppedHeight = xmp.croppedAreaImageHeightPixels ?? imageHeight;
  const croppedLeft = xmp.croppedAreaLeftPixels ?? Math.round((fullWidth - croppedWidth) / 2);
  const croppedTop = xmp.croppedAreaTopPixels ?? Math.round((fullHeight - croppedHeight) / 2);
  const valid = [croppedWidth, croppedHeight].every(isPositivePixelCount)
    && [croppedLeft, croppedTop].every(
      (value) => typeof value === 'number' && Number.isInteger(value) && value >= 0
    )
    && Math.abs(fullWidth / fullHeight - 2) <= 0.01
    && croppedWidth === imageWidth
    && croppedHeight === imageHeight
    && croppedLeft + croppedWidth <= fullWidth
    && croppedTop + croppedHeight <= fullHeight;
  if (!valid) {
    throw new AppError('PANORAMA_METADATA_INVALID', 'The GPano crop metadata is inconsistent.', {
      status: 422,
      details: { fullWidth, fullHeight, croppedWidth, croppedHeight, croppedLeft, croppedTop }
    });
  }
}

export async function inspectImage(options: {
  bytes: Buffer;
  mimeType: SupportedImageMime;
  maxPixels: number;
}): Promise<ImageInspection> {
  const decoded = await inspectDecodedImage(options);
  return inspectionResult(options, decoded, {
    projection: 'unknown',
    is360: false,
    isFullSphere: false
  });
}

async function inspectDecodedImage(options: {
  bytes: Buffer;
  mimeType: SupportedImageMime;
  maxPixels: number;
}): Promise<{ metadata: Metadata; xmp?: GpanoMetadata }> {
  let metadata: Metadata;
  try {
    metadata = await sharp(options.bytes, {
      failOn: 'error',
      limitInputPixels: options.maxPixels,
      sequentialRead: true
    }).metadata();
  } catch (error) {
    throw new AppError('IMAGE_DECODE_FAILED', 'The image could not be decoded safely.', {
      status: 422,
      details: { category: 'decode_failed' },
      cause: error
    });
  }
  if (!metadata.width || !metadata.height || !metadata.format) {
    throw new AppError('IMAGE_METADATA_MISSING', 'The image dimensions could not be determined.', {
      status: 422
    });
  }
  const xmp = extractGpanoMetadata(options.bytes);
  return { metadata, ...(xmp === undefined ? {} : { xmp }) };
}

function inspectionResult(
  options: { bytes: Buffer; mimeType: SupportedImageMime },
  decoded: { metadata: Metadata; xmp?: GpanoMetadata },
  classification: Pick<ImageInspection, 'projection' | 'is360' | 'isFullSphere'>
): ImageInspection {
  const { metadata, xmp } = decoded;
  return {
    width: metadata.autoOrient.width,
    height: metadata.autoOrient.height,
    aspectRatio: metadata.autoOrient.width / metadata.autoOrient.height,
    format: metadata.format!,
    mimeType: options.mimeType,
    sizeBytes: options.bytes.byteLength,
    hasAlpha: metadata.hasAlpha ?? false,
    ...(metadata.orientation === undefined ? {} : { orientation: metadata.orientation }),
    ...classification,
    ...(xmp === undefined ? {} : { xmp })
  };
}

const derivativeSpecs = [
  { kind: 'thumbnail' as const, width: 640, quality: 72 },
  { kind: 'lowResolutionBase' as const, width: 2048, quality: 75 },
  { kind: 'standardWeb' as const, width: 4096, quality: 84 }
];

type DerivativeEncoding = 'jpeg' | 'png' | 'webp';

const derivativeOutputByEncoding: Record<
  DerivativeEncoding,
  { extension: '.jpg' | '.png' | '.webp'; mimeType: SupportedImageMime }
> = {
  jpeg: { extension: '.jpg', mimeType: 'image/jpeg' },
  png: { extension: '.png', mimeType: 'image/png' },
  webp: { extension: '.webp', mimeType: 'image/webp' }
};

export async function generatePanoramaDerivatives(options: {
  assetId: string;
  version: number;
  bytes: Buffer;
  maxPixels: number;
  inspection?: PanoramaInspection;
  tilingPolicy?: PanoramaTilingPolicy;
}): Promise<GeneratedDerivative[]> {
  const baseline = await generateDerivatives({ ...options, encoding: 'jpeg', mediaLabel: 'panorama' });
  const panorama = options.inspection ?? await inspectPanoramaForGeneration(options.bytes, options.maxPixels);
  const decision = resolvePanoramaTilingPolicy({
    width: panorama.width,
    height: panorama.height,
    sizeBytes: options.bytes.byteLength,
    projection: panorama.projection
  }, options.tilingPolicy ?? DEFAULT_PANORAMA_TILING_POLICY);
  if (!decision.generateTiles) return baseline;
  try {
    const tiled = await generateTiledPanoramaDerivative({
      ...options,
      panorama,
      policy: options.tilingPolicy ?? DEFAULT_PANORAMA_TILING_POLICY,
      decision
    });
    return [...baseline, tiled];
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('DERIVATIVE_GENERATION_FAILED', 'The tiled panorama derivative could not be generated.', {
      status: 500,
      retryable: true,
      details: { kind: 'tiledLevels' },
      cause: error
    });
  }
}

type PanoramaGenerationInspection = Pick<
  PanoramaInspection,
  'width' | 'height' | 'projection' | 'xmp'
>;

async function inspectPanoramaForGeneration(
  bytes: Buffer,
  maxPixels: number
): Promise<PanoramaGenerationInspection> {
  const metadata = await sharp(bytes, {
    failOn: 'error',
    limitInputPixels: maxPixels,
    sequentialRead: true
  }).metadata();
  const width = metadata.autoOrient.width;
  const height = metadata.autoOrient.height;
  const xmp = extractGpanoMetadata(bytes);
  const projection = xmp?.fullPanoWidthPixels !== undefined
    && xmp.fullPanoHeightPixels !== undefined
    && (xmp.fullPanoWidthPixels !== width || xmp.fullPanoHeightPixels !== height)
    ? 'cropped_equirectangular' as const
    : 'equirectangular' as const;
  return { width, height, projection, ...(xmp === undefined ? {} : { xmp }) };
}

const TILED_PANORAMA_MANIFEST_SCHEMA = 'tiled-equirectangular-v1' as const;

type TileDescriptor = {
  level: number;
  levelWidth: number;
  levelHeight: number;
  row: number;
  column: number;
  /** Stable grid aliases consumed by serving/compiler integration. */
  x: number;
  y: number;
  width: number;
  height: number;
  storageKey: string;
  mimeType: 'image/jpeg';
  sizeBytes: number;
  checksumSha256: string;
};

type TiledLevelDescriptor = {
  level: number;
  width: number;
  height: number;
  columns: number;
  rows: number;
  tiles: TileDescriptor[];
};

async function generateTiledPanoramaDerivative(options: {
  assetId: string;
  version: number;
  bytes: Buffer;
  maxPixels: number;
  panorama: PanoramaGenerationInspection;
  policy: PanoramaTilingPolicy;
  decision: PanoramaTilingDecision;
}): Promise<GeneratedDerivative> {
  const supportingObjects: GeneratedStorageObject[] = [];
  const levels: TiledLevelDescriptor[] = [];
  const sourceAspectRatio = options.panorama.width / options.panorama.height;

  for (const [level, levelWidth] of options.decision.levelWidths.entries()) {
    const levelHeight = Math.max(1, Math.round(levelWidth / sourceAspectRatio));
    const columns = Math.ceil(levelWidth / options.policy.tileSize);
    const rows = Math.ceil(levelHeight / options.policy.tileSize);
    const tiles: TileDescriptor[] = [];
    const resizedLevel = sharp(options.bytes, {
      failOn: 'error',
      limitInputPixels: options.maxPixels,
      sequentialRead: true
    })
      .rotate()
      .resize({ width: levelWidth, height: levelHeight, fit: 'fill' });

    // Tile encoding is deliberately sequential: one policy-approved panorama
    // cannot multiply native memory use by its full tile count.
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const left = column * options.policy.tileSize;
        const top = row * options.policy.tileSize;
        const width = Math.min(options.policy.tileSize, levelWidth - left);
        const height = Math.min(options.policy.tileSize, levelHeight - top);
        const body = await resizedLevel
          .clone()
          .extract({ left, top, width, height })
          .jpeg({ quality: options.policy.tileQuality, mozjpeg: true })
          .toBuffer();
        const checksum = sha256(body);
        const storageKey = [
          `derivatives/${options.assetId}/v${options.version}/tiledLevels`,
          `${levelWidth}x${levelHeight}`,
          `r${row}-c${column}-${checksum.slice(0, 16)}.jpg`
        ].join('/');
        const descriptor: TileDescriptor = {
          level,
          levelWidth,
          levelHeight,
          row,
          column,
          x: column,
          y: row,
          width,
          height,
          storageKey,
          mimeType: 'image/jpeg',
          sizeBytes: body.byteLength,
          checksumSha256: checksum
        };
        tiles.push(descriptor);
        supportingObjects.push({
          storageKey,
          mimeType: 'image/jpeg',
          sizeBytes: body.byteLength,
          checksum,
          body,
          metadata: {
            checksumSha256: checksum,
            role: 'panorama-tile',
            level: String(level),
            row: String(row),
            column: String(column)
          }
        });
      }
    }
    levels.push({ level, width: levelWidth, height: levelHeight, columns, rows, tiles });
  }

  const source = canonicalTiledSource(options.panorama);
  const manifest = {
    schema: TILED_PANORAMA_MANIFEST_SCHEMA,
    assetId: options.assetId,
    derivativeVersion: options.version,
    strategy: 'tiled-equirectangular',
    source,
    tile: {
      size: options.policy.tileSize,
      encoding: 'jpeg',
      mimeType: 'image/jpeg',
      quality: options.policy.tileQuality
    },
    levels
  };
  const body = Buffer.from(JSON.stringify(manifest), 'utf8');
  const checksum = sha256(body);
  const tileObjects = levels.flatMap((level) => level.tiles);
  const totalTileSizeBytes = supportingObjects.reduce((total, object) => total + object.sizeBytes, 0);
  return {
    kind: 'tiledLevels',
    version: options.version,
    storageKey: `derivatives/${options.assetId}/v${options.version}/tiledLevels-${checksum.slice(0, 16)}.json`,
    mimeType: 'application/json',
    width: options.panorama.width,
    height: options.panorama.height,
    sizeBytes: body.byteLength,
    checksum,
    body,
    supportingObjects,
    metadata: {
      schema: TILED_PANORAMA_MANIFEST_SCHEMA,
      strategy: 'tiled-equirectangular',
      policyVersion: options.decision.policyVersion,
      policyTrigger: options.decision.triggeredBy,
      source,
      tile: manifest.tile,
      tileSize: options.policy.tileSize,
      levels: levels.map(({ tiles, ...level }) => ({ ...level, tileCount: tiles.length })),
      tiles: tileObjects,
      tileCount: tileObjects.length,
      totalTileSizeBytes,
      manifestSizeBytes: body.byteLength
    }
  };
}

function canonicalTiledSource(panorama: PanoramaGenerationInspection): Record<string, unknown> {
  const xmp = panorama.xmp;
  const fullWidth = xmp?.fullPanoWidthPixels ?? panorama.width;
  const fullHeight = xmp?.fullPanoHeightPixels ?? panorama.height;
  const cropped = panorama.projection === 'cropped_equirectangular';
  return {
    projection: panorama.projection,
    width: panorama.width,
    height: panorama.height,
    fullWidth,
    fullHeight,
    ...(cropped ? {
      crop: {
        width: xmp?.croppedAreaImageWidthPixels ?? panorama.width,
        height: xmp?.croppedAreaImageHeightPixels ?? panorama.height,
        left: xmp?.croppedAreaLeftPixels ?? Math.round((fullWidth - panorama.width) / 2),
        top: xmp?.croppedAreaTopPixels ?? Math.round((fullHeight - panorama.height) / 2)
      }
    } : {})
  };
}

/**
 * Keeps display assets in their validated source format. In particular, PNG
 * and WebP output retain their alpha channel instead of being flattened by a
 * JPEG conversion. The derivative kinds intentionally match panorama output
 * so compiler selection remains format-agnostic.
 */
export async function generateDisplayImageDerivatives(options: {
  assetId: string;
  version: number;
  bytes: Buffer;
  maxPixels: number;
  mimeType: SupportedImageMime;
}): Promise<GeneratedDerivative[]> {
  const encoding: DerivativeEncoding = options.mimeType === 'image/png'
    ? 'png'
    : options.mimeType === 'image/webp'
      ? 'webp'
      : 'jpeg';
  return generateDerivatives({ ...options, encoding, mediaLabel: 'display image' });
}

async function generateDerivatives(options: {
  assetId: string;
  version: number;
  bytes: Buffer;
  maxPixels: number;
  encoding: DerivativeEncoding;
  mediaLabel: 'panorama' | 'display image';
}): Promise<GeneratedDerivative[]> {
  const generated: GeneratedDerivative[] = [];
  const outputFormat = derivativeOutputByEncoding[options.encoding];
  // Decode/resize sequentially so one large, policy-approved source cannot
  // multiply peak native memory by the number of derivative profiles.
  for (const spec of derivativeSpecs) {
      const resized = sharp(options.bytes, {
        failOn: 'error',
        limitInputPixels: options.maxPixels,
        sequentialRead: true
      })
        .rotate()
        .resize({ width: spec.width, withoutEnlargement: true, fit: 'inside' });
      const body = await encodeDerivative(resized, options.encoding, spec.quality).toBuffer();
      const output = await sharp(body).metadata();
      if (!output.width || !output.height) {
        throw new AppError('DERIVATIVE_GENERATION_FAILED', `A ${options.mediaLabel} derivative could not be generated.`, {
          status: 500,
          retryable: true,
          details: { kind: spec.kind }
        });
      }
      const checksum = sha256(body);
      generated.push({
        kind: spec.kind,
        version: options.version,
        storageKey: `derivatives/${options.assetId}/v${options.version}/${spec.kind}-${checksum.slice(0, 16)}${outputFormat.extension}`,
        mimeType: outputFormat.mimeType,
        width: output.width,
        height: output.height,
        sizeBytes: body.byteLength,
        checksum,
        body,
        metadata: {
          ...encodingMetadata(options.encoding, spec.quality),
          normalizedOrientation: true
        }
      });
  }
  return generated;
}

function encodeDerivative(image: Sharp, encoding: DerivativeEncoding, quality: number): Sharp {
  if (encoding === 'png') {
    return image.png({ compressionLevel: 9, adaptiveFiltering: true, palette: false });
  }
  if (encoding === 'webp') {
    return image.webp({ quality, alphaQuality: 100, smartSubsample: true });
  }
  return image.jpeg({ quality, mozjpeg: true });
}

function encodingMetadata(encoding: DerivativeEncoding, quality: number): Record<string, unknown> {
  if (encoding === 'png') return { compressionLevel: 9 };
  if (encoding === 'webp') return { quality, alphaQuality: 100 };
  return { quality };
}
