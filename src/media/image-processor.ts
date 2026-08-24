import sharp, { type Metadata, type Sharp } from 'sharp';
import { AppError } from '../errors/app-error';
import { sha256 } from '../utils/hash';
import type { SupportedImageMime } from './file-policy';
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

export type GeneratedDerivative = {
  kind: 'thumbnail' | 'lowResolutionBase' | 'standardWeb';
  version: number;
  storageKey: string;
  mimeType: SupportedImageMime;
  width: number;
  height: number;
  sizeBytes: number;
  checksum: string;
  body: Buffer;
  metadata: Record<string, unknown>;
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
}): Promise<GeneratedDerivative[]> {
  return generateDerivatives({ ...options, encoding: 'jpeg', mediaLabel: 'panorama' });
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
