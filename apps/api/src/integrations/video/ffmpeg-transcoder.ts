import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { VideoProfileTarget } from '../../media/video-profile-policy';
import {
  VideoProfileUnavailableError,
  type GeneratedPoster,
  type TranscodedVideo,
  type VideoSource,
  type VideoTranscoder,
} from './video-transcoder';

const execFileAsync = promisify(execFile);

export interface FfmpegTranscoderOptions {
  readonly ffmpegPath: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly extraArguments?: readonly string[];
}

/**
 * Encoder settings live here and in configuration, never in the canonical
 * Experience model. Swapping the ladder or the codec is an infrastructure
 * change that must not require a customer-data migration.
 */
export function buildTranscodeArguments(options: {
  inputPath: string;
  outputPath: string;
  target: VideoProfileTarget;
  extraArguments?: readonly string[];
}): string[] {
  const { target } = options;
  const filters = [`scale=${target.outputWidth}:${target.outputHeight}`];
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-i', options.inputPath,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-vf', filters.join(','),
    ...(target.outputFrameRate === undefined ? [] : ['-r', String(target.outputFrameRate)]),
    '-c:v', target.profile.videoCodec,
    '-b:v', String(target.profile.targetVideoBitrate),
    '-maxrate', String(Math.round(target.profile.targetVideoBitrate * 1.25)),
    '-bufsize', String(target.profile.targetVideoBitrate * 2),
    '-pix_fmt', 'yuv420p',
    '-c:a', target.profile.audioCodec,
    '-b:a', String(target.profile.audioBitrate),
    // Progressive delivery: the player must start without the full download.
    '-movflags', '+faststart',
    ...(options.extraArguments ?? []),
    options.outputPath,
  ];
}

export function buildPosterArguments(options: {
  inputPath: string;
  outputPath: string;
  timeMs: number;
  width: number;
}): string[] {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-ss', (options.timeMs / 1000).toFixed(3),
    '-i', options.inputPath,
    '-frames:v', '1',
    '-vf', `scale=${options.width}:-2`,
    '-q:v', '4',
    options.outputPath,
  ];
}

export class FfmpegVideoTranscoder implements VideoTranscoder {
  readonly id = 'ffmpeg';
  readonly canReencode = true;

  private readonly options: FfmpegTranscoderOptions;

  constructor(options: FfmpegTranscoderOptions) {
    this.options = options;
  }

  async transcode(source: VideoSource, target: VideoProfileTarget): Promise<TranscodedVideo> {
    const extension = source.inspection.container === 'webm' ? '.webm' : '.mp4';
    const result = await this.run({
      source,
      inputExtension: extension,
      outputExtension: '.mp4',
      profileId: target.profile.id,
      buildArguments: (inputPath, outputPath) => buildTranscodeArguments({
        inputPath,
        outputPath,
        target,
        ...(this.options.extraArguments === undefined
          ? {}
          : { extraArguments: this.options.extraArguments }),
      }),
    });
    return {
      body: result,
      mimeType: target.profile.mimeType,
      width: target.outputWidth,
      height: target.outputHeight,
      diagnostics: {
        transcoder: this.id,
        strategy: 'reencode',
        videoCodec: target.profile.videoCodec,
        audioCodec: target.profile.audioCodec,
        targetVideoBitrate: target.profile.targetVideoBitrate,
        ...(target.outputFrameRate === undefined
          ? {}
          : { outputFrameRate: target.outputFrameRate }),
      },
    };
  }

  async generatePoster(
    source: VideoSource,
    options: { timeMs: number },
  ): Promise<GeneratedPoster> {
    const width = Math.min(source.inspection.width, 1_280);
    const height = Math.max(
      1,
      Math.round(width / (source.inspection.width / source.inspection.height)),
    );
    const body = await this.run({
      source,
      inputExtension: source.inspection.container === 'webm' ? '.webm' : '.mp4',
      outputExtension: '.jpg',
      profileId: 'poster',
      buildArguments: (inputPath, outputPath) => buildPosterArguments({
        inputPath,
        outputPath,
        timeMs: options.timeMs,
        width,
      }),
    });
    return {
      body,
      mimeType: 'image/jpeg',
      width,
      height,
      diagnostics: {
        transcoder: this.id,
        strategy: 'frame-extraction',
        frameExtracted: true,
        requestedTimeMs: options.timeMs,
      },
    };
  }

  private async run(options: {
    source: VideoSource;
    inputExtension: string;
    outputExtension: string;
    profileId: string;
    buildArguments: (inputPath: string, outputPath: string) => string[];
  }): Promise<Buffer> {
    const workspace = await mkdtemp(path.join(tmpdir(), 'sphere-video-'));
    const inputPath = path.join(workspace, `source-${randomUUID()}${options.inputExtension}`);
    const outputPath = path.join(workspace, `output-${randomUUID()}${options.outputExtension}`);
    try {
      await writeFile(inputPath, options.source.bytes);
      await execFileAsync(
        this.options.ffmpegPath,
        options.buildArguments(inputPath, outputPath),
        {
          timeout: this.options.timeoutMs ?? 600_000,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        },
      );
      const body = await readFile(outputPath);
      if (body.byteLength === 0) {
        throw new VideoProfileUnavailableError(options.profileId, 'the encoder produced no output');
      }
      const maxOutputBytes = this.options.maxOutputBytes;
      if (maxOutputBytes !== undefined && body.byteLength > maxOutputBytes) {
        throw new VideoProfileUnavailableError(
          options.profileId,
          'the encoded output exceeds the configured derivative size limit',
        );
      }
      return body;
    } catch (error) {
      if (error instanceof VideoProfileUnavailableError) throw error;
      throw new VideoProfileUnavailableError(
        options.profileId,
        'the configured video transcoder failed',
        { retryable: true },
      );
    } finally {
      await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
