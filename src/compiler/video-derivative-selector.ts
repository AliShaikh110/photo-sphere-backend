import type { AssetDerivative, CanonicalAsset } from '../domain/types';
import type { VideoPlaybackProfileId } from '../runtime';
import { isDerivativeReady, selectLatestReadyDerivative } from './derivative-selector';

export const VIDEO_PROFILE_ID_BY_DERIVATIVE_KIND = Object.freeze({
  desktopVideoProfile: 'desktop',
  mobileVideoProfile: 'mobile',
} as const satisfies Record<string, VideoPlaybackProfileId>);

export interface SelectedVideoDerivatives {
  readonly poster?: AssetDerivative;
  readonly profiles: readonly {
    readonly profileId: VideoPlaybackProfileId;
    readonly derivative: AssetDerivative;
  }[];
}

/**
 * Video profiles are selected per kind rather than per version set, so one
 * regenerated profile does not invalidate the profiles that are still current.
 * The original upload is never a candidate.
 */
export function selectVideoDerivatives(
  asset: Pick<CanonicalAsset, 'derivatives'>,
): SelectedVideoDerivatives {
  const poster = selectLatestReadyDerivative(asset.derivatives, 'videoPoster');
  const profiles = (['desktopVideoProfile', 'mobileVideoProfile'] as const)
    .flatMap((kind) => {
      const derivative = selectLatestReadyDerivative(asset.derivatives, kind);
      return derivative === undefined
        ? []
        : [{ profileId: VIDEO_PROFILE_ID_BY_DERIVATIVE_KIND[kind], derivative }];
    });
  return Object.freeze({
    ...(poster === undefined ? {} : { poster }),
    profiles: Object.freeze(profiles),
  });
}

export function hasPublishableVideoProfile(
  asset: Pick<CanonicalAsset, 'derivatives'>,
): boolean {
  return asset.derivatives.some((derivative) => (
    (derivative.kind === 'desktopVideoProfile' || derivative.kind === 'mobileVideoProfile')
    && isDerivativeReady(derivative)
  ));
}

export function isHandheldSafeProfile(derivative: AssetDerivative): boolean {
  if (derivative.metadata?.handheldSafe === true) return true;
  if (derivative.metadata?.handheldSafe === false) return false;
  // Fall back to the delivered geometry when the pipeline did not record a
  // decision, rather than assuming the profile is safe.
  return derivative.width !== null && derivative.width <= 4_096;
}
