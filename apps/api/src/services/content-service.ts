import { AppError } from '../errors/app-error';
import type { JsonObject } from '../models/model.types';
import { sanitizePlainText, sanitizeRichHtml, validateSafeUrl } from '@alishaikh110/experience-schema';

function safeExternalUrl(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const result = validateSafeUrl(value, { allowInternalRelative: true });
  if (!result.valid) {
    throw new AppError(result.code, result.message, { status: 422, path });
  }
  return result.normalizedUrl;
}

export function sanitizeRequiredPlainText(value: unknown, path: string): string {
  const sanitized = sanitizePlainText(value).trim();
  if (!sanitized) {
    throw new AppError('VALIDATION_FAILED', 'A text value is required.', { status: 422, path });
  }
  return sanitized;
}

export function sanitizeProjectSettings(input: Record<string, unknown>): JsonObject {
  const output = structuredClone(input) as Record<string, unknown>;
  if (output.appearance && typeof output.appearance === 'object') {
    const appearance = output.appearance as Record<string, unknown>;
    for (const key of ['hotspotStyle', 'typography']) {
      if (appearance[key] !== undefined) appearance[key] = sanitizePlainText(appearance[key]);
    }
  }
  if (output.information && typeof output.information === 'object') {
    const information = output.information as Record<string, unknown>;
    if (information.title !== undefined) information.title = sanitizePlainText(information.title);
    if (information.description !== undefined) information.description = sanitizePlainText(information.description);
    if (information.bodyHtml !== undefined) information.bodyHtml = sanitizeRichHtml(information.bodyHtml);
    const url = safeExternalUrl(information.externalUrl, 'settings.information.externalUrl');
    if (url === undefined) delete information.externalUrl;
    else information.externalUrl = url;
  }
  return output as JsonObject;
}

export function sanitizeBranding(input: Record<string, unknown>): JsonObject {
  const output = structuredClone(input) as Record<string, unknown>;
  if (output.companyName !== undefined) output.companyName = sanitizePlainText(output.companyName);
  if (output.welcomeMessage !== undefined) output.welcomeMessage = sanitizeRichHtml(output.welcomeMessage);
  if (output.loadingMessage !== undefined) output.loadingMessage = sanitizeRichHtml(output.loadingMessage);
  return output as JsonObject;
}

export function sanitizeHotspotContent(input: Record<string, unknown>): JsonObject {
  const output = structuredClone(input) as Record<string, unknown>;
  for (const key of ['title', 'description', 'tooltip', 'buttonLabel']) {
    if (output[key] !== undefined) output[key] = sanitizePlainText(output[key]);
  }
  if (output.bodyHtml !== undefined) output.bodyHtml = sanitizeRichHtml(output.bodyHtml);
  const url = safeExternalUrl(output.externalUrl, 'content.externalUrl');
  if (url === undefined) delete output.externalUrl;
  else output.externalUrl = url;
  return output as JsonObject;
}

/**
 * Timed content passes through exactly the same trust boundary as scene
 * hotspot content: there is no separate sanitizer for the video timeline.
 */
export function sanitizeTimelineContent(input: Record<string, unknown>): JsonObject {
  const output = sanitizeHotspotContent(input) as Record<string, unknown>;
  if (output.ctaLabel !== undefined) {
    const label = sanitizePlainText(output.ctaLabel).trim();
    if (label) output.ctaLabel = label;
    else delete output.ctaLabel;
  }
  const ctaUrl = safeExternalUrl(output.ctaUrl, 'content.ctaUrl');
  if (ctaUrl === undefined) delete output.ctaUrl;
  else output.ctaUrl = ctaUrl;
  return output as JsonObject;
}

export function sanitizeTimelineAction(input: Record<string, unknown>): JsonObject {
  return sanitizeHotspotAction(input);
}

export function sanitizeHotspotAppearance(input: Record<string, unknown>): JsonObject {
  const output = structuredClone(input) as Record<string, unknown>;
  if (output.label !== undefined) {
    const label = sanitizePlainText(output.label).trim();
    if (label) output.label = label;
    else delete output.label;
  }
  return output as JsonObject;
}

export function sanitizeHotspotAction(input: Record<string, unknown>): JsonObject {
  const output = structuredClone(input) as Record<string, unknown>;
  if (output.kind === 'openUrl') {
    const url = safeExternalUrl(output.url, 'action.url');
    if (url === undefined) {
      throw new AppError('URL_REQUIRED', 'A URL is required.', { status: 422, path: 'action.url' });
    }
    output.url = url;
  }
  return output as JsonObject;
}
