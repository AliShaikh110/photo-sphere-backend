import type { AssetDerivativeKind } from '../domain/types';
import {
  HANDHELD_MAX_VIDEO_WIDTH,
  type VideoPlaybackProfileId,
} from '../runtime/video-playback-policy';
import type { VideoInspection } from './video-processor';

/**
 * Playback profiles are a platform policy, not project data. Nothing in this
 * module may be persisted on a Project: the canonical model stores a logical
 * video asset, and the pipeline decides which deliverable profiles exist.
 */
export const VIDEO_PLAYBACK_PROFILE_IDS = ['desktop', 'mobile'] as const;
export type { VideoPlaybackProfileId };

export interface VideoPlaybackProfileSpec {
  readonly id: VideoPlaybackProfileId;
  readonly derivativeKind: Extract<
    AssetDerivativeKind,
    'desktopVideoProfile' | 'mobileVideoProfile'
  >;
  readonly maxWidth: number;
  readonly maxFrameRate: number;
  readonly targetVideoBitrate: number;
  readonly audioBitrate: number;
  readonly container: 'mp4';
  readonly mimeType: 'video/mp4';
  /** Advisory codec identity for the transcoder integration only. */
  readonly videoCodec: string;
  readonly audioCodec: string;
  /** Whether this profile must satisfy the documented handheld width ceiling. */
  readonly handheldSafe: boolean;
}

export interface VideoTranscodingPolicy {
  readonly version: number;
  readonly desktopMaxWidth: number;
  readonly desktopMaxFrameRate: number;
  readonly desktopTargetBitrate: number;
  readonly mobileMaxWidth: number;
  readonly mobileMaxFrameRate: number;
  readonly mobileTargetBitrate: number;
  readonly audioBitrate: number;
  readonly videoCodec: string;
  readonly audioCodec: string;
  readonly posterEnabled: boolean;
}

export const DEFAULT_VIDEO_TRANSCODING_POLICY: VideoTranscodingPolicy = Object.freeze({
  version: 1,
  desktopMaxWidth: 8_192,
  desktopMaxFrameRate: 60,
  desktopTargetBitrate: 16_000_000,
  mobileMaxWidth: HANDHELD_MAX_VIDEO_WIDTH,
  mobileMaxFrameRate: 30,
  mobileTargetBitrate: 6_000_000,
  audioBitrate: 128_000,
  videoCodec: 'h264',
  audioCodec: 'aac',
  posterEnabled: true,
});

export function resolveVideoPlaybackProfiles(
  policy: VideoTranscodingPolicy = DEFAULT_VIDEO_TRANSCODING_POLICY,
): readonly VideoPlaybackProfileSpec[] {
  return Object.freeze([
    Object.freeze({
      id: 'desktop' as const,
      derivativeKind: 'desktopVideoProfile' as const,
      maxWidth: policy.desktopMaxWidth,
      maxFrameRate: policy.desktopMaxFrameRate,
      targetVideoBitrate: policy.desktopTargetBitrate,
      audioBitrate: policy.audioBitrate,
      container: 'mp4' as const,
      mimeType: 'video/mp4' as const,
      videoCodec: policy.videoCodec,
      audioCodec: policy.audioCodec,
      handheldSafe: policy.desktopMaxWidth <= HANDHELD_MAX_VIDEO_WIDTH,
    }),
    Object.freeze({
      id: 'mobile' as const,
      derivativeKind: 'mobileVideoProfile' as const,
      maxWidth: Math.min(policy.mobileMaxWidth, HANDHELD_MAX_VIDEO_WIDTH),
      maxFrameRate: policy.mobileMaxFrameRate,
      targetVideoBitrate: policy.mobileTargetBitrate,
      audioBitrate: policy.audioBitrate,
      container: 'mp4' as const,
      mimeType: 'video/mp4' as const,
      videoCodec: policy.videoCodec,
      audioCodec: policy.audioCodec,
      handheldSafe: true,
    }),
  ]);
}

export interface VideoProfileTarget {
  readonly profile: VideoPlaybackProfileSpec;
  readonly outputWidth: number;
  readonly outputHeight: number;
  readonly outputFrameRate?: number;
  /** True when the inspected source already satisfies every profile constraint. */
  readonly sourceAlreadyCompliant: boolean;
  readonly requiresResize: boolean;
  readonly requiresFrameRateChange: boolean;
  readonly requiresCodecChange: boolean;
  readonly requiresContainerChange: boolean;
}

/**
 * Chooses the output geometry for each profile. Equirectangular output must
 * stay 2:1, so widths are rounded to an even number and the height follows.
 */
export function planVideoProfileTargets(
  inspection: VideoInspection,
  policy: VideoTranscodingPolicy = DEFAULT_VIDEO_TRANSCODING_POLICY,
): readonly VideoProfileTarget[] {
  return resolveVideoPlaybackProfiles(policy).map((profile) => {
    const outputWidth = evenWidth(Math.min(inspection.width, profile.maxWidth));
    const outputHeight = evenWidth(Math.round(outputWidth / (inspection.width / inspection.height)));
    const requiresResize = outputWidth !== inspection.width || outputHeight !== inspection.height;
    const requiresFrameRateChange = inspection.frameRate !== undefined
      && inspection.frameRate > profile.maxFrameRate + 0.5;
    const requiresCodecChange = !inspection.compatibility.webVideoCodec
      || !inspection.compatibility.webAudioCodec
      || !inspection.compatibility.upright;
    const requiresContainerChange = inspection.container !== profile.container;
    return Object.freeze({
      profile,
      outputWidth,
      outputHeight,
      ...(requiresFrameRateChange ? { outputFrameRate: profile.maxFrameRate } : {}),
      sourceAlreadyCompliant: !requiresResize
        && !requiresFrameRateChange
        && !requiresCodecChange
        && !requiresContainerChange,
      requiresResize,
      requiresFrameRateChange,
      requiresCodecChange,
      requiresContainerChange,
    });
  });
}
function evenWidth(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}
