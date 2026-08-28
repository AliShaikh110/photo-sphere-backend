import {
  CAPABILITY_REGISTRY,
  VIDEO_CAPABILITY_IDS,
  type CapabilityId,
  type CapabilityResolutionResult
} from '@sphere/capability-registry';
import {
  DEFAULT_MEDIA_DELIVERY_POLICY,
  COMPILER_VERSION,
  formatMediaLocation,
  preflightExperience,
  tryCompile,
  type CanonicalAsset,
  type CompilerInput
} from '@sphere/experience-compiler';
import { CANONICAL_SCHEMA_VERSION } from '@sphere/experience-schema';
import { LIVE_PATCH_CONTRACT_VERSION, LIVE_PATCH_CLASSIFICATIONS } from '@sphere/live-patch';

import { createEditorSessionToken, createMediaToken } from '../auth/tokens';
import { config } from '../config';
import type { JsonObject } from '../models/model.types';
import { incrementMetric, observeMetric } from '../observability';
import { requireProjectRole } from './access-service';
import { loadCompilableExperience } from './experience-service';
import { loadExtensionRegistry } from './extension-service';
import { resolveViewerIntegrationVersion } from './viewer-integration-service';

/**
 * Everything an editor needs to draw a live preview, in one request.
 *
 * An editor that has to fetch the project, its capabilities, its assets and a
 * preview manifest in sequence cannot draw a pixel until four round trips have
 * completed. That blank screen is a backend problem, and this is the fix.
 */

/**
 * Which experience type each capability belongs to.
 *
 * A tool that cannot exist in this kind of experience is hidden rather than
 * shown broken, so the sets have to match what the compiler actually resolves
 * per type. A few belong to both, because a hotspot and a timed interaction
 * open the same kinds of content.
 */
const VIDEO_ONLY_CAPABILITIES = new Set<string>(VIDEO_CAPABILITY_IDS);
const SHARED_CAPABILITIES = new Set<string>(['externalLink', 'imageContent', 'videoContent']);

/** Capabilities that describe delivery rather than something a creator uses. */
const DELIVERY_CAPABILITIES = new Set<string>([
  'basicPanorama',
  'tiledPanorama',
  'highResolution',
  'cubemapPanorama',
  'video360'
]);

function appliesToExperience(capabilityId: string, experienceType: string): boolean {
  if (SHARED_CAPABILITIES.has(capabilityId)) return true;
  return VIDEO_ONLY_CAPABILITIES.has(capabilityId)
    ? experienceType === 'video360'
    : experienceType !== 'video360';
}

export type EditorToolState = 'available' | 'unavailable' | 'hidden';

export interface EditorTool {
  readonly id: CapabilityId;
  readonly name: string;
  readonly state: EditorToolState;
  readonly reason?: string;
}

function capabilityReason(
  resolution: CapabilityResolutionResult,
  capabilityId: CapabilityId
): string | undefined {
  const fallback = resolution.fallbacks.find((entry) => entry.capabilityId === capabilityId);
  if (fallback !== undefined) return fallback.message;
  const issue = resolution.issues.find((entry) => entry.capabilityIds.includes(capabilityId));
  return issue?.message;
}

/**
 * Capabilities as a creator sees them: what the experience can do, what it
 * cannot, and why. Renderer module names never appear here.
 */
function describeCapabilities(
  resolution: CapabilityResolutionResult,
  experienceType: string
): Record<string, unknown>[] {
  const resolved = new Set<string>(resolution.capabilities);
  return Object.values(CAPABILITY_REGISTRY).map((definition) => {
    const applies = appliesToExperience(definition.id, experienceType);
    const available = resolved.has(definition.id);
    const reason = capabilityReason(resolution, definition.id);
    return {
      id: definition.id,
      productFeature: definition.productFeature,
      availability: definition.availability,
      appliesToExperience: applies,
      resolved: available,
      deviceRequirements: definition.deviceRequirements,
      deviceRequirementResolution: definition.deviceRequirementResolution,
      ...(reason === undefined ? {} : { reason }),
      fallback: definition.fallback === null
        ? null
        : { behavior: definition.fallback.behavior, alternatives: definition.fallback.alternatives }
    };
  });
}

/**
 * Which tools an editor may offer, and why one is not on offer.
 *
 * A tool the experience type does not have is hidden rather than shown broken;
 * a tool the project cannot resolve yet is shown unavailable with the product
 * reason, because "why can't I do this" is a question the editor should answer
 * without a support ticket.
 */
function buildEditorPolicy(
  resolution: CapabilityResolutionResult,
  experienceType: string,
  canEdit: boolean,
  readOnlyReason: string
): EditorTool[] {
  return Object.values(CAPABILITY_REGISTRY)
    .filter((definition) => !DELIVERY_CAPABILITIES.has(definition.id))
    .map((definition): EditorTool => {
      const applies = appliesToExperience(definition.id, experienceType);
      if (definition.availability === 'reserved') {
        return {
          id: definition.id,
          name: definition.productFeature,
          state: 'hidden',
          reason: 'This feature is not offered in this release.'
        };
      }
      if (!applies) {
        return {
          id: definition.id,
          name: definition.productFeature,
          state: 'hidden',
          reason: experienceType === 'video360'
            ? 'This tool belongs to 360 image experiences.'
            : 'This tool belongs to 360 video experiences.'
        };
      }
      if (!canEdit) {
        return {
          id: definition.id,
          name: definition.productFeature,
          state: 'unavailable',
          reason: readOnlyReason
        };
      }
      // A tool is offered unless this project asked for it and it could not be
      // resolved. A capability the project simply has not used yet is not a
      // reason to grey out the tool that would use it.
      const reason = capabilityReason(resolution, definition.id);
      if (reason === undefined) {
        return { id: definition.id, name: definition.productFeature, state: 'available' };
      }
      return {
        id: definition.id,
        name: definition.productFeature,
        state: 'unavailable',
        reason
      };
    });
}

interface SignedMediaUrl {
  readonly assetId: string;
  readonly derivativeId: string;
  readonly kind: string;
  readonly url: string;
  readonly expiresAt: string;
}

/**
 * Fetchable URLs for the media this editing session will draw.
 *
 * They expire, and renewing them is a separate route rather than another
 * compile, because a long editing session should not have to rebuild an
 * experience to keep showing the pictures already on screen.
 */
export function signMediaUrls(
  assets: readonly CanonicalAsset[],
  experienceId: string,
  expiresAt: string,
  limit: number
): { readonly mediaUrls: SignedMediaUrl[]; readonly truncated: boolean } {
  const mediaUrls: SignedMediaUrl[] = [];
  let truncated = false;
  for (const asset of assets) {
    for (const derivative of asset.derivatives) {
      if (mediaUrls.length >= limit) {
        truncated = true;
        break;
      }
      const path = formatMediaLocation(DEFAULT_MEDIA_DELIVERY_POLICY, {
        access: 'protected',
        experienceId,
        assetId: asset.id,
        derivativeId: derivative.id
      });
      const token = createMediaToken({ derivativeId: derivative.id });
      mediaUrls.push({
        assetId: asset.id,
        derivativeId: derivative.id,
        kind: derivative.kind,
        url: `${path}?token=${encodeURIComponent(token)}`,
        expiresAt
      });
    }
    if (truncated) break;
  }
  return { mediaUrls, truncated };
}

export async function editorBootstrap(
  projectId: string,
  actorUserId: string
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  const access = await requireProjectRole(projectId, actorUserId, 'viewer');
  const loaded = await loadCompilableExperience({
    projectId,
    actorUserId,
    requiredRole: 'viewer'
  });
  const viewerIntegrationVersion = await resolveViewerIntegrationVersion(projectId);
  const extensions = await loadExtensionRegistry();
  const compileInput: CompilerInput = {
    project: loaded.inputProject,
    assets: loaded.assets,
    target: 'preview',
    extensions,
    viewerIntegrationVersion,
    policy: {
      media: DEFAULT_MEDIA_DELIVERY_POLICY,
      tour: config.tourStrategyPolicy
    }
  };
  const preflight = preflightExperience({
    project: loaded.inputProject,
    assets: loaded.assets,
    target: 'preview',
    extensions
  });
  const outcome = tryCompile(compileInput);

  const canEdit = access.role !== 'viewer';
  const readOnlyReason = 'You have view-only access to this experience.';
  // Media the editor will draw: everything attached to this project. Anything
  // else in the creator's library is signed on demand through the refresh
  // route rather than shipped in every bootstrap.
  const projectAssets = loaded.assets.filter((asset) => asset.projectId === projectId);
  const expiresAt = new Date(Date.now() + config.signedMediaTtlSeconds * 1000).toISOString();
  const signed = signMediaUrls(
    projectAssets,
    projectId,
    expiresAt,
    config.mediaTokenRefreshMax
  );

  const compileResult = outcome.ok
    ? {
      manifest: outcome.result.manifest as unknown as JsonObject,
      viewerIntegration: outcome.result.viewerIntegration,
      sceneIndex: outcome.result.sceneIndex,
      diagnostics: outcome.result.diagnostics,
      // Hashed before any URL is signed, so a client that compiles the same
      // canonical data locally computes the same value.
      contentHash: outcome.result.contentHash
    }
    : {
      manifest: null,
      viewerIntegration: null,
      sceneIndex: [],
      diagnostics: outcome.diagnostics,
      contentHash: null
    };

  observeMetric('editor.bootstrap.duration', Date.now() - startedAt, {
    experienceType: loaded.project.type
  });
  incrementMetric('editor.session_token.issued', { role: access.role });

  return {
    project: {
      id: loaded.project.id,
      type: loaded.project.type,
      name: loaded.project.name,
      schemaVersion: loaded.project.schemaVersion,
      revision: loaded.project.revision,
      settings: loaded.inputProject.settings,
      branding: loaded.inputProject.branding,
      scenes: loaded.inputProject.scenes,
      ...(loaded.inputProject.plans === undefined ? {} : { plans: loaded.inputProject.plans }),
      ...(loaded.inputProject.timeline === undefined
        ? {}
        : { timeline: loaded.inputProject.timeline }),
      ...(loaded.project.type === 'video360'
        ? { videoAssetId: loaded.project.videoAssetId }
        : {}),
      publication: loaded.project.publicationMetadata
    },
    revision: loaded.project.revision,
    assets: loaded.assets,
    mediaUrls: signed.mediaUrls,
    mediaUrlsTruncated: signed.truncated,
    capabilities: describeCapabilities(preflight.capabilityResolution, loaded.project.type),
    compileResult,
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    viewerIntegrationVersion,
    livePatchContractVersion: LIVE_PATCH_CONTRACT_VERSION,
    livePatchClassifications: LIVE_PATCH_CLASSIFICATIONS,
    compilerVersion: COMPILER_VERSION,
    editorPolicy: {
      role: access.role,
      canEdit,
      ...(canEdit ? {} : { readOnlyReason }),
      tools: buildEditorPolicy(
        preflight.capabilityResolution,
        loaded.project.type,
        canEdit,
        readOnlyReason
      )
    },
    editorSession: {
      // Scoped to this project and short lived, so browser-direct media, event
      // and telemetry calls never carry the creator's bearer token.
      token: createEditorSessionToken({ projectId, userId: actorUserId, role: access.role }),
      expiresAt: new Date(Date.now() + config.editorSessionTtlSeconds * 1000).toISOString()
    }
  };
}
