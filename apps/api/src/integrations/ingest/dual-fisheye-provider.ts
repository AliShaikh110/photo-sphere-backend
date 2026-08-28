import type { AssetProjection, JsonObject } from '../../models/model.types';

/**
 * Ingest for raw camera formats the renderer cannot display directly.
 *
 * The platform's contract is normalization: a provider inspects a raw source
 * and produces a supported projection. No camera vendor is assumed here — the
 * concrete provider is chosen once real device requirements are agreed, and
 * until then the reference provider below declines everything.
 */

export interface RawSourceMetadata {
  readonly assetId: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly width: number | null;
  readonly height: number | null;
  /** Inspection output from the standard pipeline, including any XMP/EXIF. */
  readonly metadata: JsonObject;
}

export interface RawSourceInspection {
  readonly projection: AssetProjection;
  /** Whether this provider can normalize the source into a supported projection. */
  readonly normalizable: boolean;
  readonly reason?: string;
  readonly diagnostics: JsonObject;
}

export interface NormalizedPanorama {
  readonly projection: Extract<AssetProjection, 'equirectangular' | 'cubemap'>;
  readonly body: Buffer;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly metadata: JsonObject;
}

export interface DualFisheyeIngestProvider {
  readonly id: string;
  /** Whether this provider recognizes the raw source at all. */
  canHandle(source: RawSourceMetadata): boolean;
  inspect(source: RawSourceMetadata, body: Buffer): Promise<RawSourceInspection>;
  /** Produces a supported-projection panorama the normal pipeline can derive from. */
  normalizeToSupportedProjection(
    source: RawSourceMetadata,
    body: Buffer
  ): Promise<NormalizedPanorama>;
}

export class DualFisheyeUnsupportedError extends Error {
  readonly code = 'DUAL_FISHEYE_NOT_SUPPORTED';

  constructor(message = 'Dual-fisheye ingest is not enabled on this deployment.') {
    super(message);
    this.name = 'DualFisheyeUnsupportedError';
  }
}

/**
 * The provider used until a camera integration is approved. It recognizes the
 * shape of a dual-fisheye source so the pipeline can report it accurately, and
 * refuses to normalize rather than inventing a projection.
 */
export class UnavailableDualFisheyeProvider implements DualFisheyeIngestProvider {
  readonly id = 'unavailable';

  canHandle(source: RawSourceMetadata): boolean {
    // A dual-fisheye still is a single frame holding two circular images, so it
    // is close to square rather than the 2:1 of an equirectangular panorama.
    if (source.width === null || source.height === null || source.height === 0) return false;
    const aspectRatio = source.width / source.height;
    return aspectRatio > 0.9 && aspectRatio < 1.2;
  }

  async inspect(source: RawSourceMetadata): Promise<RawSourceInspection> {
    return {
      projection: this.canHandle(source) ? 'dual_fisheye' : 'unknown',
      normalizable: false,
      reason: 'No dual-fisheye ingest provider is configured.',
      diagnostics: {
        providerId: this.id,
        width: source.width,
        height: source.height
      }
    };
  }

  async normalizeToSupportedProjection(): Promise<NormalizedPanorama> {
    throw new DualFisheyeUnsupportedError();
  }
}
