import { CAPABILITY_REGISTRY_PACKAGE_NAME, CAPABILITY_REGISTRY_PACKAGE_VERSION } from '@alishaikh110/capability-registry';
import { EXPERIENCE_COMPILER_PACKAGE_NAME, EXPERIENCE_COMPILER_PACKAGE_VERSION } from '@alishaikh110/experience-compiler';
import {
  EXPERIENCE_SCHEMA_PACKAGE_NAME,
  EXPERIENCE_SCHEMA_PACKAGE_VERSION,
  SHARED_PACKAGE_NAMES,
  type SharedPackageContract
} from '@alishaikh110/experience-schema';
import { LIVE_PATCH_PACKAGE_NAME, LIVE_PATCH_PACKAGE_VERSION } from '@alishaikh110/live-patch';
import { TELEMETRY_CONTRACT_PACKAGE_NAME, TELEMETRY_CONTRACT_PACKAGE_VERSION } from '@alishaikh110/telemetry-contract';
import { VIEWER_INTEGRATION_PACKAGE_NAME, VIEWER_INTEGRATION_PACKAGE_VERSION } from '@alishaikh110/viewer-integration';

/**
 * What this backend requires of the packages a frontend is built against.
 *
 * The versions below are read from the packages this process actually loaded,
 * so the contract cannot claim a release that was never deployed. The floor is
 * declared here by hand, because it is a judgement about which older frontends
 * this backend is still willing to serve — not a fact about the build.
 */

/**
 * The oldest package release this backend will serve.
 *
 * Raise it in the same change that publishes a major, and only then. The rule
 * that decides it is in the runbook under "Shared package versioning": a
 * change in compiled output, a change in a property's live-patch class, a
 * `schemaVersion` increment or a retired viewer integration is a major, and
 * every major raises this floor to itself. A minor or a patch never does.
 *
 * Leaving it behind a major is the failure this whole mechanism exists to
 * prevent: the frontend keeps an outdated classification table, its live
 * mutations stop matching what the compiler does, and the preview diverges
 * from what publishes without anything failing.
 */
export const MINIMUM_COMPATIBLE_PACKAGE_VERSION = '1.0.0';

export const SHARED_PACKAGE_REGISTRY = 'https://npm.pkg.github.com';
export const SHARED_PACKAGE_SCOPE = '@alishaikh110';

/** The version of every shared package this process is running. */
export const BACKEND_PACKAGE_VERSIONS: Readonly<Record<string, string>> = Object.freeze({
  [TELEMETRY_CONTRACT_PACKAGE_NAME]: TELEMETRY_CONTRACT_PACKAGE_VERSION,
  [CAPABILITY_REGISTRY_PACKAGE_NAME]: CAPABILITY_REGISTRY_PACKAGE_VERSION,
  [EXPERIENCE_SCHEMA_PACKAGE_NAME]: EXPERIENCE_SCHEMA_PACKAGE_VERSION,
  [VIEWER_INTEGRATION_PACKAGE_NAME]: VIEWER_INTEGRATION_PACKAGE_VERSION,
  [EXPERIENCE_COMPILER_PACKAGE_NAME]: EXPERIENCE_COMPILER_PACKAGE_VERSION,
  [LIVE_PATCH_PACKAGE_NAME]: LIVE_PATCH_PACKAGE_VERSION
});

/**
 * The contract `/editor-bootstrap` reports.
 *
 * A frontend passes this and its own installed versions to
 * `assertSharedPackageCompatibility` before it renders anything.
 */
export function sharedPackageContract(): SharedPackageContract {
  return {
    registry: SHARED_PACKAGE_REGISTRY,
    scope: SHARED_PACKAGE_SCOPE,
    minimumCompatibleVersion: MINIMUM_COMPATIBLE_PACKAGE_VERSION,
    backendPackageVersions: BACKEND_PACKAGE_VERSIONS
  };
}

/** Every package name the contract covers, in the order the set is released. */
export const SHARED_PACKAGE_CONTRACT_NAMES = SHARED_PACKAGE_NAMES;
