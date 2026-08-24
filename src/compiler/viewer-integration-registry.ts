import {
  PhotoSphereViewerIntegrationAdapter,
  PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION
} from './viewer-integration-adapter';
import type { ViewerIntegrationAdapter } from './types';

export type ViewerIntegrationStatus = 'active' | 'candidate' | 'retired';

export interface ViewerIntegrationRegistration {
  readonly version: string;
  readonly rendererId: string;
  /** The renderer release this adapter is written and tested against. */
  readonly pinnedRendererVersion: string;
  readonly status: ViewerIntegrationStatus;
  readonly notes: string;
  create(): ViewerIntegrationAdapter;
}

/**
 * Every viewer integration version this build can actually emit.
 *
 * A rollout may only target a version listed here, so an operator cannot label
 * output with a version whose adapter does not exist. Publications keep the
 * version string they were compiled with, which is why retired entries stay
 * meaningful to telemetry long after they stop being selectable.
 */
export const VIEWER_INTEGRATION_REGISTRY: readonly ViewerIntegrationRegistration[] = Object.freeze([
  Object.freeze({
    version: PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION,
    rendererId: 'photo-sphere-viewer',
    pinnedRendererVersion: '5.14.3',
    status: 'active' as ViewerIntegrationStatus,
    notes: 'Adds spatial map/plan, advanced overlay geometry, motion and stereo configuration.',
    create: (): ViewerIntegrationAdapter =>
      new PhotoSphereViewerIntegrationAdapter(PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION)
  })
]);

const registrationsByVersion = new Map(
  VIEWER_INTEGRATION_REGISTRY.map((registration) => [registration.version, registration])
);

export function listViewerIntegrationVersions(): readonly ViewerIntegrationRegistration[] {
  return VIEWER_INTEGRATION_REGISTRY;
}

export function isSupportedViewerIntegrationVersion(version: string): boolean {
  return registrationsByVersion.has(version);
}

export function viewerIntegrationRegistration(
  version: string
): ViewerIntegrationRegistration | undefined {
  return registrationsByVersion.get(version);
}

/** The version used when nothing is configured or rolled out. */
export function defaultViewerIntegrationVersion(): string {
  return (
    VIEWER_INTEGRATION_REGISTRY.find((registration) => registration.status === 'active')?.version
    ?? PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION
  );
}

export function createViewerIntegrationAdapter(version: string): ViewerIntegrationAdapter {
  const registration = registrationsByVersion.get(version);
  if (registration === undefined) {
    throw new Error(`Unsupported viewer integration version: ${version}`);
  }
  return registration.create();
}
