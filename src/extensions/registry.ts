import type {
  ExtensionDefinition,
  ExtensionRegistrySnapshot,
} from './types';

function key(extensionId: string, version: string): string {
  return `${extensionId}@${version}`;
}

/**
 * An immutable registry view. Validation and compilation are pure and take a
 * snapshot rather than reaching into the database themselves.
 */
export function createExtensionRegistrySnapshot(
  definitions: readonly ExtensionDefinition[],
): ExtensionRegistrySnapshot {
  const byKey = new Map(definitions.map((definition) => [
    key(definition.extensionId, definition.version),
    Object.freeze(definition),
  ]));
  const active = Object.freeze(definitions.filter(
    (definition) => definition.status === 'active' || definition.status === 'deprecated',
  ));
  return Object.freeze({
    get: (extensionId: string, version: string) => byKey.get(key(extensionId, version)),
    listActive: () => active,
  });
}

export const EMPTY_EXTENSION_REGISTRY: ExtensionRegistrySnapshot =
  createExtensionRegistrySnapshot([]);

/**
 * Reference extensions shipped with the platform. They exist so the extension
 * contract is exercised end to end without inventing a third-party dependency.
 */
export const BUILT_IN_EXTENSIONS: readonly ExtensionDefinition[] = Object.freeze([
  Object.freeze({
    extensionId: 'platform.measurement-label',
    version: '1.0.0',
    name: 'Measurement label',
    description: 'Shows a measured distance or dimension anchored to the panorama.',
    supportedExperienceTypes: ['image360'] as const,
    schema: {
      fields: {
        label: { type: 'string', required: true, maxLength: 120 },
        value: { type: 'number', required: true, minimum: 0, maximum: 100_000 },
        unit: { type: 'enum', required: true, values: ['m', 'cm', 'mm', 'ft', 'in'] },
        color: { type: 'color' },
      },
      additionalFields: false,
    },
    requiredCapabilities: ['hotspots'] as const,
    runtimeModule: 'extensions/measurement-label',
    securityPolicy: { allowRichText: false, maxPayloadBytes: 4_096 },
    status: 'active',
  } satisfies ExtensionDefinition),
  Object.freeze({
    extensionId: 'platform.progress-comparison',
    version: '1.0.0',
    name: 'Before and after comparison',
    description: 'Compares two prepared images inside the panorama.',
    supportedExperienceTypes: ['image360'] as const,
    schema: {
      fields: {
        beforeAssetId: { type: 'assetId', required: true },
        afterAssetId: { type: 'assetId', required: true },
        caption: { type: 'string', maxLength: 240 },
        orientation: { type: 'enum', values: ['horizontal', 'vertical'] },
      },
      additionalFields: false,
    },
    requiredCapabilities: ['hotspots', 'imageContent'] as const,
    runtimeModule: 'extensions/progress-comparison',
    securityPolicy: { allowRichText: false, maxPayloadBytes: 4_096 },
    status: 'active',
  } satisfies ExtensionDefinition),
]);
