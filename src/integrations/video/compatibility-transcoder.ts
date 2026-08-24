import sharp from 'sharp';

import type { VideoProfileTarget } from '../../media/video-profile-policy';
import {
  VideoProfileUnavailableError,
  type GeneratedPoster,
  type TranscodedVideo,
  type VideoSource,
  type VideoTranscoder,
} from './video-transcoder';

/**
 * The default transcoder for deployments without an encoder binary.
 *
 * It never assumes the original upload is a safe playback source: a profile is
 * only emitted when the inspected source provably satisfies every constraint
 * of that profile. Anything requiring a real re-encode is reported as an
 * unavailable profile so the failure stays visible and actionable instead of
 * silently publishing an oversized original.
 */
export class CompatibilityVideoTranscoder implements VideoTranscoder {
  readonly id = 'compatibility';
  readonly canReencode = false;

  private readonly posterPlaceholderEnabled: boolean;

  constructor(options: { posterPlaceholderEnabled?: boolean } = {}) {
    this.posterPlaceholderEnabled = options.posterPlaceholderEnabled ?? true;
  }

  async transcode(source: VideoSource, target: VideoProfileTarget): Promise<TranscodedVideo> {
    if (!target.sourceAlreadyCompliant) {
      throw new VideoProfileUnavailableError(
        target.profile.id,
        describeGap(target),
        { retryable: false },
      );
    }
    return {
      body: source.bytes,
      mimeType: source.inspection.mimeType,
      width: source.inspection.width,
      height: source.inspection.height,
      diagnostics: {
        transcoder: this.id,
        strategy: 'verified-source-passthrough',
        sourceContainer: source.inspection.container,
        sourceWidth: source.inspection.width,
        sourceHeight: source.inspection.height,
        handheldSafeWidth: source.inspection.compatibility.handheldSafeWidth,
      },
    };
  }

  async generatePoster(
    source: VideoSource,
    options: { timeMs: number },
  ): Promise<GeneratedPoster> {
    if (!this.posterPlaceholderEnabled) {
      throw new VideoProfileUnavailableError(
        'poster',
        'frame extraction requires a configured video transcoder',
        { retryable: false },
      );
    }
    // A neutral, deterministic still. It is explicitly labelled as a
    // placeholder so operators can tell it apart from an extracted frame.
    const width = Math.min(source.inspection.width, 1_280);
    const height = Math.max(1, Math.round(width / (source.inspection.width / source.inspection.height)));
    const body = await sharp({
      create: { width, height, channels: 3, background: { r: 17, g: 24, b: 39 } },
    })
      .jpeg({ quality: 78, mozjpeg: true })
      .toBuffer();
    return {
      body,
      mimeType: 'image/jpeg',
      width,
      height,
      diagnostics: {
        transcoder: this.id,
        strategy: 'placeholder',
        frameExtracted: false,
        requestedTimeMs: options.timeMs,
      },
    };
  }
}

function describeGap(target: VideoProfileTarget): string {
  const gaps: string[] = [];
  if (target.requiresResize) {
    gaps.push(`the source must be resized to ${target.outputWidth}x${target.outputHeight}`);
  }
  if (target.requiresFrameRateChange) {
    gaps.push(`the frame rate must be reduced to ${target.profile.maxFrameRate}`);
  }
  if (target.requiresCodecChange) gaps.push('the source encoding must be converted');
  if (target.requiresContainerChange) {
    gaps.push(`the source must be repackaged as ${target.profile.container}`);
  }
  return gaps.join('; ') || 'the source does not satisfy the profile';
}
