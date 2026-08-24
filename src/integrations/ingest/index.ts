import { config } from '../../config';
import {
  UnavailableDualFisheyeProvider,
  type DualFisheyeIngestProvider
} from './dual-fisheye-provider';

export {
  DualFisheyeUnsupportedError,
  UnavailableDualFisheyeProvider
} from './dual-fisheye-provider';
export type {
  DualFisheyeIngestProvider,
  NormalizedPanorama,
  RawSourceInspection,
  RawSourceMetadata
} from './dual-fisheye-provider';

let provider: DualFisheyeIngestProvider = new UnavailableDualFisheyeProvider();

/** Installs a concrete camera ingest provider once one is approved. */
export function setDualFisheyeIngestProvider(replacement: DualFisheyeIngestProvider): void {
  provider = replacement;
}

export function dualFisheyeIngestProvider(): DualFisheyeIngestProvider {
  return provider;
}

/**
 * Ingest stays behind a flag: enabling it on a deployment without a real
 * provider would let the pipeline accept media it cannot render.
 */
export function isDualFisheyeIngestEnabled(): boolean {
  return config.dualFisheyeIngestEnabled && provider.id !== 'unavailable';
}
