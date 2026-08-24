import { sanitizePlainText, sanitizeRichHtml } from '../security/html-sanitizer';
import { validateSafeUrl } from '../security/url-validator';
import type { JsonObject, JsonValue } from '../domain/types';
import type {
  ExtensionDefinition,
  ExtensionFieldSchema,
  ExtensionPayloadIssue,
  ExtensionPayloadValidation,
} from './types';

const DEFAULT_MAX_PAYLOAD_BYTES = 16 * 1024;
const DEFAULT_MAX_STRING_LENGTH = 2_000;
const DEFAULT_MAX_ITEMS = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const COLOR_PATTERN = /^#[\da-f]{6}$/iu;

/**
 * Validates and normalizes a custom-interaction payload against its registered
 * extension schema. Nothing from the payload is executed or trusted: strings
 * pass through the platform sanitizers and URLs through the platform policy.
 */
export function validateExtensionPayload(
  extension: ExtensionDefinition,
  payload: unknown,
): ExtensionPayloadValidation {
  const issues: ExtensionPayloadIssue[] = [];
  const record = asRecord(payload);
  if (record === undefined) {
    return {
      valid: false,
      issues: [{
        field: '',
        code: 'EXTENSION_FIELD_TYPE_INVALID',
        message: 'The custom interaction payload must be an object.',
      }],
      sanitizedPayload: {},
    };
  }

  const maxBytes = extension.securityPolicy.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
  if (Buffer.byteLength(JSON.stringify(record)) > maxBytes) {
    return {
      valid: false,
      issues: [{
        field: '',
        code: 'EXTENSION_PAYLOAD_TOO_LARGE',
        message: 'The custom interaction payload is too large.',
      }],
      sanitizedPayload: {},
    };
  }

  const sanitized: Record<string, JsonValue> = {};
  for (const [field, schema] of Object.entries(extension.schema.fields)) {
    const value = record[field];
    if (value === undefined || value === null) {
      if (schema.required === true) {
        issues.push({
          field,
          code: 'EXTENSION_FIELD_REQUIRED',
          message: `${field} is required.`,
        });
      }
      continue;
    }
    const converted = convertField(extension, field, schema, value, issues);
    if (converted !== undefined) {
      sanitized[field] = converted;
    }
  }

  if (extension.schema.additionalFields !== undefined) {
    for (const key of Object.keys(record)) {
      if (!Object.prototype.hasOwnProperty.call(extension.schema.fields, key)) {
        issues.push({
          field: key,
          code: 'EXTENSION_FIELD_UNKNOWN',
          message: `${key} is not part of this custom interaction.`,
        });
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues: Object.freeze(issues),
    sanitizedPayload: sanitized as JsonObject,
  };
}

function convertField(
  extension: ExtensionDefinition,
  field: string,
  schema: ExtensionFieldSchema,
  value: unknown,
  issues: ExtensionPayloadIssue[],
): JsonValue | undefined {
  switch (schema.type) {
    case 'string':
      return convertString(field, schema, value, issues, false);
    case 'richText':
      if (extension.securityPolicy.allowRichText !== true) {
        return convertString(field, schema, value, issues, false);
      }
      return convertString(field, schema, value, issues, true);
    case 'number':
    case 'integer':
      return convertNumber(field, schema, value, issues);
    case 'boolean':
      if (typeof value !== 'boolean') {
        issues.push(typeIssue(field, 'a true or false value'));
        return undefined;
      }
      return value;
    case 'assetId':
    case 'sceneId':
      if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
        issues.push(typeIssue(field, 'a valid identifier'));
        return undefined;
      }
      return value;
    case 'color':
      if (typeof value !== 'string' || !COLOR_PATTERN.test(value)) {
        issues.push(typeIssue(field, 'a colour such as #112233'));
        return undefined;
      }
      return value;
    case 'url':
      return convertUrl(extension, field, value, issues);
    case 'enum':
      if (typeof value !== 'string' || !(schema.values ?? []).includes(value)) {
        issues.push({
          field,
          code: 'EXTENSION_FIELD_VALUE_INVALID',
          message: `${field} must be one of: ${(schema.values ?? []).join(', ')}.`,
        });
        return undefined;
      }
      return value;
    case 'stringArray':
      return convertStringArray(field, schema, value, issues);
  }
}

function convertString(
  field: string,
  schema: ExtensionFieldSchema,
  value: unknown,
  issues: ExtensionPayloadIssue[],
  rich: boolean,
): JsonValue | undefined {
  if (typeof value !== 'string') {
    issues.push(typeIssue(field, 'text'));
    return undefined;
  }
  const maxLength = schema.maxLength ?? DEFAULT_MAX_STRING_LENGTH;
  if (value.length > maxLength) {
    issues.push({
      field,
      code: 'EXTENSION_FIELD_VALUE_INVALID',
      message: `${field} must be ${maxLength} characters or fewer.`,
    });
    return undefined;
  }
  return rich ? sanitizeRichHtml(value) : sanitizePlainText(value);
}

function convertNumber(
  field: string,
  schema: ExtensionFieldSchema,
  value: unknown,
  issues: ExtensionPayloadIssue[],
): JsonValue | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push(typeIssue(field, 'a number'));
    return undefined;
  }
  if (schema.type === 'integer' && !Number.isInteger(value)) {
    issues.push(typeIssue(field, 'a whole number'));
    return undefined;
  }
  if ((schema.minimum !== undefined && value < schema.minimum)
    || (schema.maximum !== undefined && value > schema.maximum)) {
    issues.push({
      field,
      code: 'EXTENSION_FIELD_VALUE_INVALID',
      message: `${field} is outside the allowed range.`,
    });
    return undefined;
  }
  return value;
}

function convertUrl(
  extension: ExtensionDefinition,
  field: string,
  value: unknown,
  issues: ExtensionPayloadIssue[],
): JsonValue | undefined {
  const allowedHosts = extension.securityPolicy.allowedUrlHosts ?? [];
  const validated = validateSafeUrl(value, {
    allowInternalRelative: true,
    ...(allowedHosts.length === 0 ? {} : { allowedHosts }),
  });
  if (!validated.valid) {
    issues.push({
      field,
      code: 'EXTENSION_FIELD_VALUE_INVALID',
      message: validated.message,
    });
    return undefined;
  }
  return validated.normalizedUrl;
}

function convertStringArray(
  field: string,
  schema: ExtensionFieldSchema,
  value: unknown,
  issues: ExtensionPayloadIssue[],
): JsonValue | undefined {
  if (!Array.isArray(value)) {
    issues.push(typeIssue(field, 'a list of text values'));
    return undefined;
  }
  if (value.length > (schema.maxItems ?? DEFAULT_MAX_ITEMS)) {
    issues.push({
      field,
      code: 'EXTENSION_FIELD_VALUE_INVALID',
      message: `${field} contains too many entries.`,
    });
    return undefined;
  }
  const entries: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      issues.push(typeIssue(field, 'a list of text values'));
      return undefined;
    }
    entries.push(sanitizePlainText(entry));
  }
  return entries;
}

function typeIssue(field: string, expectation: string): ExtensionPayloadIssue {
  return {
    field,
    code: 'EXTENSION_FIELD_TYPE_INVALID',
    message: `${field} must be ${expectation}.`,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
