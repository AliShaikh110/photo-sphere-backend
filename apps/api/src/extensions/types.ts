import type { CanonicalProjectType, JsonObject } from '../domain/types';
import type { CapabilityId } from '../capabilities/types';

export const EXTENSION_STATUSES = ['draft', 'active', 'deprecated', 'disabled'] as const;
export type ExtensionStatus = (typeof EXTENSION_STATUSES)[number];

export const EXTENSION_FIELD_TYPES = [
  'string',
  'richText',
  'number',
  'integer',
  'boolean',
  'assetId',
  'sceneId',
  'url',
  'color',
  'enum',
  'stringArray',
] as const;
export type ExtensionFieldType = (typeof EXTENSION_FIELD_TYPES)[number];

/**
 * A deliberately small, declarative field language. Custom interactions must be
 * describable without shipping executable validation, so payloads can be
 * checked by the platform rather than by extension-supplied code.
 */
export interface ExtensionFieldSchema {
  readonly type: ExtensionFieldType;
  readonly required?: boolean;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly values?: readonly string[];
  readonly maxItems?: number;
  readonly description?: string;
}

export interface ExtensionSchema {
  readonly fields: Readonly<Record<string, ExtensionFieldSchema>>;
  /** Reject any payload key the schema does not declare. */
  readonly additionalFields?: false;
}

export interface ExtensionSecurityPolicy {
  /** Hosts a field of type `url` may point at; empty means the global policy applies. */
  readonly allowedUrlHosts?: readonly string[];
  readonly allowRichText?: boolean;
  readonly maxPayloadBytes?: number;
}

/**
 * A registered, versioned custom interaction contract. The runtime module is
 * allow-listed here so a publication can never name arbitrary client code.
 */
export interface ExtensionDefinition {
  readonly extensionId: string;
  readonly version: string;
  readonly name: string;
  readonly description?: string;
  readonly supportedExperienceTypes: readonly CanonicalProjectType[];
  readonly schema: ExtensionSchema;
  readonly requiredCapabilities: readonly CapabilityId[];
  readonly runtimeModule: string;
  readonly securityPolicy: ExtensionSecurityPolicy;
  readonly status: ExtensionStatus;
}

/** An immutable view of the registry, safe to hand to pure validation code. */
export interface ExtensionRegistrySnapshot {
  get(extensionId: string, version: string): ExtensionDefinition | undefined;
  listActive(): readonly ExtensionDefinition[];
}

export interface ExtensionPayloadIssue {
  readonly field: string;
  readonly code:
    | 'EXTENSION_FIELD_REQUIRED'
    | 'EXTENSION_FIELD_TYPE_INVALID'
    | 'EXTENSION_FIELD_VALUE_INVALID'
    | 'EXTENSION_FIELD_UNKNOWN'
    | 'EXTENSION_PAYLOAD_TOO_LARGE';
  readonly message: string;
}

export interface ExtensionPayloadValidation {
  readonly valid: boolean;
  readonly issues: readonly ExtensionPayloadIssue[];
  readonly sanitizedPayload: JsonObject;
}
