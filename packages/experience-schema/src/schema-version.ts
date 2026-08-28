/**
 * The canonical Experience schema version.
 *
 * Every stored project records the version it was written against, and a
 * compiled manifest carries it through, so a player can tell which contract a
 * published experience was built to.
 */
export const CANONICAL_SCHEMA_VERSION = 1 as const;
export type CanonicalSchemaVersion = typeof CANONICAL_SCHEMA_VERSION;
