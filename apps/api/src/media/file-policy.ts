import path from 'node:path';
import { AppError } from '../errors/app-error';
import { detectVideoContainer } from './video-container';

export type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

const extensionByMime: Record<SupportedImageMime, readonly string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp']
};

export function detectImageMime(bytes: Buffer): SupportedImageMime | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return undefined;
}

function normalizeClientMime(mimeType: string): string {
  const lower = mimeType.toLowerCase().split(';', 1)[0]?.trim() ?? '';
  return lower === 'image/jpg' ? 'image/jpeg' : lower;
}

export type ValidatedImage = {
  mimeType: SupportedImageMime;
  extension: '.jpg' | '.png' | '.webp';
  sizeBytes: number;
};

export function validateImageUpload(options: {
  bytes: Buffer;
  filename: string;
  claimedMimeType: string;
  maxBytes: number;
}): ValidatedImage {
  if (options.bytes.byteLength === 0) {
    throw new AppError('EMPTY_UPLOAD', 'The uploaded file is empty.', { status: 422 });
  }
  if (options.bytes.byteLength > options.maxBytes) {
    throw new AppError('UPLOAD_TOO_LARGE', 'The image exceeds the configured upload limit.', {
      status: 413,
      details: { maxBytes: options.maxBytes }
    });
  }
  const actualMime = detectImageMime(options.bytes);
  if (!actualMime) {
    throw new AppError('UNSUPPORTED_IMAGE_TYPE', 'Only JPEG, PNG, and WebP images are supported.', {
      status: 422
    });
  }
  const claimed = normalizeClientMime(options.claimedMimeType);
  if (claimed !== actualMime) {
    throw new AppError('UPLOAD_MIME_MISMATCH', 'The file content does not match its declared media type.', {
      status: 422,
      details: { declaredMimeType: claimed, detectedMimeType: actualMime }
    });
  }
  const extension = path.extname(options.filename).toLowerCase();
  if (!extensionByMime[actualMime].includes(extension)) {
    throw new AppError('UPLOAD_EXTENSION_MISMATCH', 'The file extension does not match the image content.', {
      status: 422,
      details: { detectedMimeType: actualMime }
    });
  }
  return {
    mimeType: actualMime,
    extension: actualMime === 'image/jpeg' ? '.jpg' : actualMime === 'image/png' ? '.png' : '.webp',
    sizeBytes: options.bytes.byteLength
  };
}

export type SupportedVideoMime = 'video/mp4' | 'video/webm';

const videoExtensionByMime: Record<SupportedVideoMime, readonly string[]> = {
  'video/mp4': ['.mp4', '.m4v'],
  'video/webm': ['.webm']
};

export type ValidatedVideo = {
  mimeType: SupportedVideoMime;
  extension: '.mp4' | '.webm';
  sizeBytes: number;
};

function normalizeClientVideoMime(mimeType: string): string {
  const lower = mimeType.toLowerCase().split(';', 1)[0]?.trim() ?? '';
  return lower === 'video/x-m4v' || lower === 'video/quicktime' ? 'video/mp4' : lower;
}

/**
 * Container signature validation. A renamed file is never trusted by its
 * extension or its declared media type alone.
 */
export function validateVideoUpload(options: {
  bytes: Buffer;
  filename: string;
  claimedMimeType: string;
  maxBytes: number;
}): ValidatedVideo {
  if (options.bytes.byteLength === 0) {
    throw new AppError('EMPTY_UPLOAD', 'The uploaded file is empty.', { status: 422 });
  }
  if (options.bytes.byteLength > options.maxBytes) {
    throw new AppError('UPLOAD_TOO_LARGE', 'The video exceeds the configured upload limit.', {
      status: 413,
      details: { maxBytes: options.maxBytes }
    });
  }
  const container = detectVideoContainer(options.bytes);
  if (!container) {
    throw new AppError('UNSUPPORTED_VIDEO_TYPE', 'Only MP4 and WebM videos are supported.', {
      status: 422
    });
  }
  const actualMime: SupportedVideoMime = container === 'mp4' ? 'video/mp4' : 'video/webm';
  const claimed = normalizeClientVideoMime(options.claimedMimeType);
  if (claimed !== actualMime) {
    throw new AppError('UPLOAD_MIME_MISMATCH', 'The file content does not match its declared media type.', {
      status: 422,
      details: { declaredMimeType: claimed, detectedMimeType: actualMime }
    });
  }
  const extension = path.extname(options.filename).toLowerCase();
  if (!videoExtensionByMime[actualMime].includes(extension)) {
    throw new AppError('UPLOAD_EXTENSION_MISMATCH', 'The file extension does not match the video content.', {
      status: 422,
      details: { detectedMimeType: actualMime }
    });
  }
  return {
    mimeType: actualMime,
    extension: actualMime === 'video/mp4' ? '.mp4' : '.webm',
    sizeBytes: options.bytes.byteLength
  };
}

export function safeUploadFilename(filename: string): string {
  const basename = path.basename(filename).normalize('NFKC');
  const cleaned = basename.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 160);
  return cleaned || 'image.jpg';
}
