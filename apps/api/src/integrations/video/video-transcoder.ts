import type { VideoProfileTarget } from '../../media/video-profile-policy';
import type { VideoInspection } from '../../media/video-processor';

export interface VideoSource {
  readonly assetId: string;
  readonly bytes: Buffer;
  readonly inspection: VideoInspection;
}

export interface TranscodedVideo {
  readonly body: Buffer;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  /** Vendor/tool detail for processing diagnostics only, never project data. */
  readonly diagnostics: Record<string, string | number | boolean>;
}

export interface GeneratedPoster {
  readonly body: Buffer;
  readonly mimeType: 'image/jpeg';
  readonly width: number;
  readonly height: number;
  readonly diagnostics: Record<string, string | number | boolean>;
}

export class VideoProfileUnavailableError extends Error {
  readonly code = 'VIDEO_PROFILE_UNAVAILABLE';
  readonly profileId: string;
  readonly reason: string;
  readonly retryable: boolean;

  constructor(profileId: string, reason: string, options: { retryable?: boolean } = {}) {
    super(`No compatible ${profileId} playback profile could be produced: ${reason}`);
    this.name = 'VideoProfileUnavailableError';
    this.profileId = profileId;
    this.reason = reason;
    this.retryable = options.retryable ?? false;
  }
}

export interface VideoTranscoder {
  readonly id: string;
  /** True when this transcoder can re-encode, not merely validate and copy. */
  readonly canReencode: boolean;
  transcode(source: VideoSource, target: VideoProfileTarget): Promise<TranscodedVideo>;
  generatePoster(source: VideoSource, options: { timeMs: number }): Promise<GeneratedPoster>;
}
