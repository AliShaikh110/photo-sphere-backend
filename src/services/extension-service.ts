import { Op } from 'sequelize';
import { AppError, notFound } from '../errors/app-error';
import {
  BUILT_IN_EXTENSIONS,
  createExtensionRegistrySnapshot,
  type ExtensionDefinition,
  type ExtensionRegistrySnapshot,
  type ExtensionSchema,
  type ExtensionSecurityPolicy,
  type ExtensionStatus,
} from '../extensions';
import { Extension } from '../models';
import type { CapabilityId } from '../capabilities/types';
import type { JsonObject, JsonValue, ProjectType } from '../models/model.types';
import { recordAudit } from './audit-service';

/**
 * The registry changes rarely and is read on every compile, so it is cached
 * briefly. The TTL is short enough that enabling or disabling an extension
 * takes effect without a deployment.
 */
const REGISTRY_CACHE_TTL_MS = 30_000;

let cachedSnapshot: { snapshot: ExtensionRegistrySnapshot; expiresAt: number } | undefined;

function toDefinition(row: Extension): ExtensionDefinition {
  return {
    extensionId: row.extensionId,
    version: row.version,
    name: row.name,
    ...(row.description === null ? {} : { description: row.description }),
    supportedExperienceTypes: (row.supportedExperienceTypes as JsonValue[])
      .filter((value): value is ProjectType => value === 'image360' || value === 'video360'),
    schema: row.schema as unknown as ExtensionSchema,
    requiredCapabilities: (row.requiredCapabilities as JsonValue[])
      .filter((value): value is CapabilityId => typeof value === 'string') as CapabilityId[],
    runtimeModule: row.runtimeModule,
    securityPolicy: row.securityPolicy as unknown as ExtensionSecurityPolicy,
    status: row.status,
  };
}

export function invalidateExtensionRegistryCache(): void {
  cachedSnapshot = undefined;
}

/**
 * Registered extensions plus the platform's own reference extensions. A
 * database row always wins, so a built-in can be superseded or disabled.
 */
export async function loadExtensionRegistry(): Promise<ExtensionRegistrySnapshot> {
  const nowMs = Date.now();
  if (cachedSnapshot && cachedSnapshot.expiresAt > nowMs) {
    return cachedSnapshot.snapshot;
  }
  const rows = await Extension.findAll({
    where: { status: { [Op.in]: ['active', 'deprecated', 'draft', 'disabled'] } },
    order: [['extensionId', 'ASC'], ['version', 'ASC']]
  });
  const stored = rows.map(toDefinition);
  const storedKeys = new Set(stored.map((definition) => `${definition.extensionId}@${definition.version}`));
  const definitions = [
    ...stored,
    ...BUILT_IN_EXTENSIONS.filter(
      (definition) => !storedKeys.has(`${definition.extensionId}@${definition.version}`)
    )
  ];
  const snapshot = createExtensionRegistrySnapshot(definitions);
  cachedSnapshot = { snapshot, expiresAt: nowMs + REGISTRY_CACHE_TTL_MS };
  return snapshot;
}

function serializeExtension(definition: ExtensionDefinition): Record<string, unknown> {
  return {
    extensionId: definition.extensionId,
    version: definition.version,
    name: definition.name,
    ...(definition.description === undefined ? {} : { description: definition.description }),
    supportedExperienceTypes: definition.supportedExperienceTypes,
    schema: definition.schema,
    requiredCapabilities: definition.requiredCapabilities,
    status: definition.status
    // runtimeModule and securityPolicy stay internal: they are integration
    // details, not part of the creator-facing extension contract.
  };
}

export async function listExtensions(): Promise<Record<string, unknown>[]> {
  const snapshot = await loadExtensionRegistry();
  return snapshot.listActive().map(serializeExtension);
}

export async function getExtension(
  extensionId: string,
  version: string
): Promise<Record<string, unknown>> {
  const snapshot = await loadExtensionRegistry();
  const definition = snapshot.get(extensionId, version);
  if (!definition || definition.status === 'disabled' || definition.status === 'draft') {
    throw notFound('extension', `${extensionId}@${version}`);
  }
  return serializeExtension(definition);
}

export type ExtensionRegistrationInput = {
  extensionId: string;
  version: string;
  name: string;
  description?: string;
  supportedExperienceTypes: ProjectType[];
  schema: Record<string, unknown>;
  requiredCapabilities: string[];
  runtimeModule: string;
  securityPolicy?: Record<string, unknown>;
  status?: ExtensionStatus;
};

/** Registering a new version never mutates one an existing publication pinned. */
export async function registerExtension(
  input: ExtensionRegistrationInput,
  actorUserId: string
): Promise<Record<string, unknown>> {
  const existing = await Extension.findOne({
    where: { extensionId: input.extensionId, version: input.version }
  });
  if (existing) {
    throw new AppError('EXTENSION_VERSION_EXISTS', 'That extension version already exists.', {
      status: 409,
      entityId: `${input.extensionId}@${input.version}`,
      path: 'version'
    });
  }
  const created = await Extension.create({
    extensionId: input.extensionId,
    version: input.version,
    name: input.name,
    description: input.description ?? null,
    supportedExperienceTypes: input.supportedExperienceTypes as JsonValue[],
    schema: input.schema as JsonObject,
    requiredCapabilities: input.requiredCapabilities as JsonValue[],
    runtimeModule: input.runtimeModule,
    securityPolicy: (input.securityPolicy ?? {}) as JsonObject,
    status: input.status ?? 'draft'
  });
  invalidateExtensionRegistryCache();
  await recordAudit({
    action: 'extension.status_changed',
    actorUserId,
    entityType: 'extension',
    entityId: `${created.extensionId}@${created.version}`,
    metadata: { status: created.status, registered: true }
  });
  return serializeExtension(toDefinition(created));
}

export async function setExtensionStatus(
  extensionId: string,
  version: string,
  status: ExtensionStatus,
  actorUserId: string
): Promise<Record<string, unknown>> {
  const row = await Extension.findOne({ where: { extensionId, version } });
  if (!row) throw notFound('extension', `${extensionId}@${version}`);
  const previousStatus = row.status;
  await row.update({ status });
  invalidateExtensionRegistryCache();
  await recordAudit({
    action: 'extension.status_changed',
    actorUserId,
    entityType: 'extension',
    entityId: `${extensionId}@${version}`,
    metadata: { previousStatus, status }
  });
  return serializeExtension(toDefinition(row));
}
