import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The shared package set, in dependency order.
 *
 * Order matters twice: a build failure names the lowest broken package rather
 * than the one that merely imports it, and a publish that is interrupted has
 * always left the registry in a state where every published package's
 * dependencies are already there.
 */
export const PUBLISHED_PACKAGES = Object.freeze([
  'telemetry-contract',
  'capability-registry',
  'experience-schema',
  'viewer-integration',
  'experience-compiler',
  'live-patch'
]);

/** The npm scope every published package and both private apps live under. */
export const PACKAGE_SCOPE = '@alishaikh110';

/** The registry the set is published to. */
export const PACKAGE_REGISTRY = 'https://npm.pkg.github.com';

/**
 * Third-party runtime code the set is allowed to depend on.
 *
 * Sprint 05B asked for no runtime dependencies at all. Two are unavoidable
 * without changing compiled output, which the sprint puts out of scope:
 * `sanitize-html` runs inside the compiler's output path, and
 * `telemetry-contract` publishes zod schemas as its wire contract. Both are
 * browser-safe and neither reaches a Node built-in. The allowlist is exact, so
 * a seventh dependency fails `packages:check` rather than arriving unnoticed.
 */
export const ALLOWED_RUNTIME_DEPENDENCIES = Object.freeze({
  'experience-schema': Object.freeze(['sanitize-html'])
});

/** Third-party code a consumer resolves, declared as a peer rather than bundled. */
export const ALLOWED_PEER_DEPENDENCIES = Object.freeze({
  'telemetry-contract': Object.freeze(['zod'])
});

export const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

export function packageDirectory(name) {
  return path.join(repositoryRoot, 'packages', name);
}

export function manifestPath(name) {
  return path.join(packageDirectory(name), 'package.json');
}

export function readManifest(name) {
  return JSON.parse(readFileSync(manifestPath(name), 'utf8'));
}

/** The version the set currently sits at, or an error when they disagree. */
export function lockstepVersion() {
  const versions = new Map(
    PUBLISHED_PACKAGES.map((name) => [name, readManifest(name).version])
  );
  const distinct = new Set(versions.values());
  if (distinct.size !== 1) {
    const detail = [...versions]
      .map(([name, version]) => `  ${PACKAGE_SCOPE}/${name} ${version}`)
      .join('\n');
    throw new Error(`The package set is not in lockstep:\n${detail}`);
  }
  return [...distinct][0];
}

/** `experience-compiler` -> `EXPERIENCE_COMPILER`. */
export function constantPrefix(name) {
  return name.replace(/-/gu, '_').toUpperCase();
}
