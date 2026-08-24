import type { RuntimeDeviceClass, RuntimeNetworkClass } from './types';

export const VIDEO_PLAYBACK_POLICY_VERSION = 1 as const;

/** The documented handheld ceiling for 360 video delivery. */
export const HANDHELD_MAX_VIDEO_WIDTH = 4_096;

export type VideoPlaybackProfileId = 'desktop' | 'mobile';

export interface VideoProfileCandidate {
  readonly profileId: VideoPlaybackProfileId;
  readonly derivativeId: string;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly handheldSafe: boolean;
}

/** What the player reports about the device it is running on. */
export interface VideoDeviceCapabilities {
  readonly deviceClass?: RuntimeDeviceClass;
  readonly handheld?: boolean;
  readonly touch?: boolean;
  readonly maxTextureSize?: number;
  readonly networkClass?: RuntimeNetworkClass;
  readonly supportedMimeTypes?: readonly string[];
  readonly dataSaver?: boolean;
}

export interface VideoProfileSelection {
  readonly policyVersion: number;
  readonly selected: VideoProfileCandidate;
  /** Ordered best-first; the player may fall back down this list. */
  readonly ordered: readonly VideoProfileCandidate[];
  readonly reason: VideoProfileSelectionReason;
  readonly rejected: readonly { readonly profileId: VideoPlaybackProfileId; readonly reason: string }[];
}

export type VideoProfileSelectionReason =
  | 'handheld-width-constraint'
  | 'texture-size-constraint'
  | 'data-saver'
  | 'constrained-network'
  | 'mime-type-support'
  | 'preferred-quality'
  | 'only-candidate';

export class NoCompatibleVideoProfileError extends Error {
  readonly code = 'VIDEO_PLAYBACK_CAPABILITY_UNSUPPORTED';

  constructor(reason: string) {
    super(`No compatible video playback profile is available: ${reason}`);
    this.name = 'NoCompatibleVideoProfileError';
  }
}

/**
 * Chooses a playback profile from the compiled candidate list.
 *
 * The original upload is never a candidate: only generated, policy-approved
 * derivatives reach this function. When device facts are missing the policy
 * stays conservative and prefers the handheld-safe profile, because a stalled
 * or blank 360 video is a worse outcome than a slightly softer one.
 */
export function selectVideoPlaybackProfile(
  candidates: readonly VideoProfileCandidate[],
  device: VideoDeviceCapabilities = {},
): VideoProfileSelection {
  if (candidates.length === 0) {
    throw new NoCompatibleVideoProfileError('the experience has no playback profiles');
  }

  const rejected: { profileId: VideoPlaybackProfileId; reason: string }[] = [];
  const supportedMimeTypes = device.supportedMimeTypes === undefined
    ? undefined
    : new Set(device.supportedMimeTypes.map((value) => value.toLowerCase()));

  const compatible = candidates.filter((candidate) => {
    if (supportedMimeTypes !== undefined && !supportedMimeTypes.has(candidate.mimeType.toLowerCase())) {
      rejected.push({ profileId: candidate.profileId, reason: 'mime-type-unsupported' });
      return false;
    }
    if (device.handheld === true && !candidate.handheldSafe) {
      rejected.push({ profileId: candidate.profileId, reason: 'exceeds-handheld-width' });
      return false;
    }
    if (device.maxTextureSize !== undefined
      && device.maxTextureSize > 0
      && candidate.width > device.maxTextureSize) {
      rejected.push({ profileId: candidate.profileId, reason: 'exceeds-max-texture-size' });
      return false;
    }
    return true;
  });

  if (compatible.length === 0) {
    throw new NoCompatibleVideoProfileError(
      rejected[0]?.reason ?? 'the device does not support any published profile',
    );
  }

  const preferSmaller = device.dataSaver === true
    || device.handheld === true
    || device.deviceClass === 'constrained'
    || device.networkClass === 'constrained'
    || device.networkClass === 'offline';
  const ordered = [...compatible].sort((left, right) => (
    preferSmaller ? left.width - right.width : right.width - left.width
  ));
  const selected = ordered[0]!;

  return Object.freeze({
    policyVersion: VIDEO_PLAYBACK_POLICY_VERSION,
    selected,
    ordered: Object.freeze(ordered),
    reason: selectionReason(device, compatible.length, rejected.length, preferSmaller),
    rejected: Object.freeze(rejected),
  });
}

function selectionReason(
  device: VideoDeviceCapabilities,
  candidateCount: number,
  rejectedCount: number,
  preferSmaller: boolean,
): VideoProfileSelectionReason {
  // A device constraint that eliminated candidates is the more useful reason
  // to report than the fact that one candidate happened to remain.
  if (candidateCount === 1 && rejectedCount === 0) return 'only-candidate';
  if (device.handheld === true) return 'handheld-width-constraint';
  if (device.maxTextureSize !== undefined) return 'texture-size-constraint';
  if (device.dataSaver === true) return 'data-saver';
  if (device.networkClass === 'constrained' || device.networkClass === 'offline') {
    return 'constrained-network';
  }
  if (device.supportedMimeTypes !== undefined) return 'mime-type-support';
  return preferSmaller ? 'data-saver' : 'preferred-quality';
}

/**
 * The default candidate order baked into a published manifest, used when the
 * player performs selection itself. Handheld-safe profiles come first so a
 * player that simply takes the first playable entry is already safe.
 */
export function defaultCandidateOrder(
  candidates: readonly VideoProfileCandidate[],
): readonly VideoProfileCandidate[] {
  return Object.freeze([...candidates].sort((left, right) => {
    if (left.handheldSafe !== right.handheldSafe) return left.handheldSafe ? -1 : 1;
    return right.width - left.width;
  }));
}
