import { existsSync } from 'node:fs';

import { config } from '../../config';
import { CompatibilityVideoTranscoder } from './compatibility-transcoder';
import { FfmpegVideoTranscoder } from './ffmpeg-transcoder';
import type { VideoTranscoder } from './video-transcoder';

export * from './video-transcoder';
export { CompatibilityVideoTranscoder } from './compatibility-transcoder';
export {
  FfmpegVideoTranscoder,
  buildPosterArguments,
  buildTranscodeArguments,
} from './ffmpeg-transcoder';

export function createVideoTranscoder(
  options: {
    mode?: 'auto' | 'ffmpeg' | 'compatibility';
    ffmpegPath?: string;
    transcodeTimeoutMs?: number;
    maxDerivativeBytes?: number;
    posterPlaceholderEnabled?: boolean;
  } = {},
): VideoTranscoder {
  const mode = options.mode ?? config.videoTranscoderMode;
  const ffmpegPath = options.ffmpegPath ?? config.ffmpegPath;
  const useFfmpeg = mode === 'ffmpeg'
    || (mode === 'auto' && ffmpegPath !== undefined && existsSync(ffmpegPath));
  if (useFfmpeg) {
    if (ffmpegPath === undefined) {
      throw new Error('FFMPEG_PATH must be configured when VIDEO_TRANSCODER is set to ffmpeg.');
    }
    return new FfmpegVideoTranscoder({
      ffmpegPath,
      timeoutMs: options.transcodeTimeoutMs ?? config.videoTranscodeTimeoutMs,
      maxOutputBytes: options.maxDerivativeBytes ?? config.maxVideoDerivativeBytes,
    });
  }
  return new CompatibilityVideoTranscoder({
    posterPlaceholderEnabled: options.posterPlaceholderEnabled
      ?? config.videoPosterPlaceholderEnabled,
  });
}

export const videoTranscoder: VideoTranscoder = createVideoTranscoder();
