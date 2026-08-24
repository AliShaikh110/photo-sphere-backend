import { AppError } from '../errors/app-error';
import { HANDHELD_MAX_VIDEO_WIDTH } from '../runtime/video-playback-policy';
import {
  detectVideoContainer,
  readVideoContainer,
  type VideoContainerFormat,
  type VideoTrackSummary,
} from './video-container';

export type SupportedVideoMime = 'video/mp4' | 'video/webm';

export const VIDEO_MIME_BY_CONTAINER: Readonly<Record<VideoContainerFormat, SupportedVideoMime>> =
  Object.freeze({ mp4: 'video/mp4', webm: 'video/webm' });

/**
 * Product-level video facts. Codec strings are retained for internal
 * diagnostics and playback policy; they never reach canonical project data.
 */
export interface VideoInspection {
  readonly container: VideoContainerFormat;
  readonly mimeType: SupportedVideoMime;
  readonly sizeBytes: number;
  readonly width: number;
  readonly height: number;
  readonly aspectRatio: number;
  readonly durationMs: number;
  readonly frameRate?: number;
  readonly bitrateBitsPerSecond: number;
  readonly videoCodec?: string;
  readonly audioPresent: boolean;
  readonly audioCodec?: string;
  readonly rotationDegrees: number;
  readonly stereoMode: 'mono' | 'top-bottom' | 'left-right';
  readonly projection: 'equirectangular' | 'cubemap' | 'unknown';
  readonly is360: boolean;
  readonly projectionSource: 'container-metadata' | 'aspect-ratio' | 'none';
  readonly compatibility: VideoCompatibilityFlags;
}

export interface VideoCompatibilityFlags {
  /**
   * The renderer documents that 360 video wider than 4096 pixels may fail to
   * display on handheld devices, so this is a delivery constraint rather than
   * a cosmetic hint.
   */
  readonly handheldSafeWidth: boolean;
  readonly progressiveContainer: boolean;
  readonly webVideoCodec: boolean;
  readonly webAudioCodec: boolean;
  readonly upright: boolean;
}

export { HANDHELD_MAX_VIDEO_WIDTH } from '../runtime/video-playback-policy';

const WEB_VIDEO_CODECS = new Set(['avc1', 'avc3', 'hvc1', 'hev1', 'av01', 'vp08', 'vp09']);
const WEB_VIDEO_CODEC_IDS = new Set(['V_VP8', 'V_VP9', 'V_AV1', 'V_MPEG4/ISO/AVC']);
const WEB_AUDIO_CODECS = new Set(['mp4a', 'opus', 'Opus', 'ec-3', 'ac-3']);
const WEB_AUDIO_CODEC_IDS = new Set(['A_OPUS', 'A_VORBIS', 'A_AAC']);

export function inspectVideo(options: {
  bytes: Buffer;
  mimeType: SupportedVideoMime;
  require360: boolean;
  maxDurationMs?: number;
}): VideoInspection {
  const container = detectVideoContainer(options.bytes);
  if (container === undefined) {
    throw new AppError('UNSUPPORTED_VIDEO_TYPE', 'Only MP4 and WebM videos are supported.', {
      status: 422,
    });
  }
  const summary = readVideoContainer(options.bytes);
  if (summary === undefined) {
    throw new AppError('VIDEO_DECODE_FAILED', 'The video container could not be read safely.', {
      status: 422,
      details: { category: 'container_unreadable' },
    });
  }

  const videoTrack = summary.tracks.find((track) => track.kind === 'video');
  const audioTrack = summary.tracks.find((track) => track.kind === 'audio');
  if (videoTrack === undefined || !isPositive(videoTrack.width) || !isPositive(videoTrack.height)) {
    throw new AppError('VIDEO_METADATA_MISSING', 'The video dimensions could not be determined.', {
      status: 422,
    });
  }

  const durationMs = summary.durationMs ?? videoTrack.durationMs;
  if (!isPositive(durationMs)) {
    throw new AppError('VIDEO_DURATION_UNKNOWN', 'The video duration could not be determined.', {
      status: 422,
    });
  }
  if (options.maxDurationMs !== undefined && durationMs > options.maxDurationMs) {
    throw new AppError('VIDEO_TOO_LONG', 'The video exceeds the configured duration limit.', {
      status: 422,
      details: { maxDurationMs: options.maxDurationMs, durationMs },
    });
  }

  const rotationDegrees = videoTrack.rotationDegrees ?? 0;
  const rotated = rotationDegrees === 90 || rotationDegrees === 270;
  const width = rotated ? videoTrack.height : videoTrack.width;
  const height = rotated ? videoTrack.width : videoTrack.height;
  const aspectRatio = width / height;
  const frameRate = videoTrack.frameCount === undefined
    ? undefined
    : roundTo(videoTrack.frameCount / (durationMs / 1000), 3);

  const projectionSource: VideoInspection['projectionSource'] = videoTrack.projection !== undefined
    ? 'container-metadata'
    : Math.abs(aspectRatio - 2) <= 0.08
      ? 'aspect-ratio'
      : 'none';
  const projection: VideoInspection['projection'] = videoTrack.projection
    ?? (projectionSource === 'aspect-ratio' ? 'equirectangular' : 'unknown');
  const is360 = projection === 'equirectangular' || projection === 'cubemap';

  if (options.require360 && !is360) {
    throw new AppError('VIDEO_360_NOT_DETECTED', 'The file is not a supported 360 video.', {
      status: 422,
      details: { width, height, aspectRatio: roundTo(aspectRatio, 4) },
    });
  }

  return Object.freeze({
    container,
    mimeType: VIDEO_MIME_BY_CONTAINER[container],
    sizeBytes: options.bytes.byteLength,
    width,
    height,
    aspectRatio: roundTo(aspectRatio, 4),
    durationMs,
    ...(frameRate === undefined ? {} : { frameRate }),
    bitrateBitsPerSecond: Math.round(options.bytes.byteLength * 8 / (durationMs / 1000)),
    ...(videoTrack.codec === undefined ? {} : { videoCodec: videoTrack.codec }),
    audioPresent: audioTrack !== undefined,
    ...(audioTrack?.codec === undefined ? {} : { audioCodec: audioTrack.codec }),
    rotationDegrees,
    stereoMode: videoTrack.stereoMode ?? 'mono',
    projection,
    is360,
    projectionSource,
    compatibility: Object.freeze({
      handheldSafeWidth: width <= HANDHELD_MAX_VIDEO_WIDTH,
      progressiveContainer: container === 'mp4' || container === 'webm',
      webVideoCodec: isWebVideoCodec(videoTrack.codec),
      webAudioCodec: audioTrack === undefined || isWebAudioCodec(audioTrack.codec),
      upright: rotationDegrees === 0,
    }),
  });
}

/** The subset persisted on the logical asset for editor and compiler use. */
export function videoInspectionMetadata(inspection: VideoInspection): Record<string, unknown> {
  return {
    container: inspection.container,
    mimeType: inspection.mimeType,
    width: inspection.width,
    height: inspection.height,
    aspectRatio: inspection.aspectRatio,
    durationMs: inspection.durationMs,
    ...(inspection.frameRate === undefined ? {} : { frameRate: inspection.frameRate }),
    bitrate: inspection.bitrateBitsPerSecond,
    sizeBytes: inspection.sizeBytes,
    ...(inspection.videoCodec === undefined ? {} : { codec: inspection.videoCodec }),
    audioPresent: inspection.audioPresent,
    ...(inspection.audioCodec === undefined ? {} : { audioCodec: inspection.audioCodec }),
    rotationDegrees: inspection.rotationDegrees,
    stereoMode: inspection.stereoMode,
    is360: inspection.is360,
    projectionSource: inspection.projectionSource,
    compatibility: { ...inspection.compatibility },
  };
}

function isWebVideoCodec(codec: string | undefined): boolean {
  if (codec === undefined) return false;
  return WEB_VIDEO_CODECS.has(codec) || WEB_VIDEO_CODEC_IDS.has(codec);
}

function isWebAudioCodec(codec: string | undefined): boolean {
  if (codec === undefined) return true;
  return WEB_AUDIO_CODECS.has(codec) || WEB_AUDIO_CODEC_IDS.has(codec);
}

function isPositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export type { VideoContainerFormat, VideoTrackSummary };
