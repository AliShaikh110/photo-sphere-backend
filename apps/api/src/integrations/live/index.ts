import { config } from '../../config';
import {
  UnavailableLiveSourceProvider,
  type LiveSourceProvider
} from './live-source-provider';

export {
  assertAllowedLiveSourceUrl,
  LiveSourceUnsupportedError,
  UnavailableLiveSourceProvider
} from './live-source-provider';
export type {
  LiveSourceAuthorization,
  LiveSourceHealth,
  LiveSourceKind,
  LiveSourceProvider,
  LiveSourceRequest,
  LiveSourceValidation,
  ResolvedLiveSource
} from './live-source-provider';

let provider: LiveSourceProvider = new UnavailableLiveSourceProvider(config.liveSourceAllowedHosts);

/** Installs a concrete streaming provider once one is approved. */
export function setLiveSourceProvider(replacement: LiveSourceProvider): void {
  provider = replacement;
}

export function liveSourceProvider(): LiveSourceProvider {
  return provider;
}

/**
 * Live input stays behind a flag and an explicit host allow-list, so a
 * deployment cannot accidentally accept arbitrary outbound stream addresses.
 */
export function isLiveSourceEnabled(): boolean {
  return config.liveSourceEnabled
    && provider.id !== 'unavailable'
    && config.liveSourceAllowedHosts.length > 0;
}
