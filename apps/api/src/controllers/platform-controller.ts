import type { Request, Response } from 'express';

import { CAPABILITY_REGISTRY } from '@sphere/capability-registry';
import { config } from '../config';
import { isDualFisheyeIngestEnabled } from '../integrations/ingest';
import { isLiveSourceEnabled } from '../integrations/live';
import { metricsContract, metricsSnapshot } from '../observability';
import { referenceExperiences } from '../reference';
import {
  getViewerIntegrationRollout,
  listViewerIntegrationChecks,
  promoteViewerIntegration,
  rollbackViewerIntegration,
  runViewerIntegrationCheck,
  setViewerIntegrationRollout,
  viewerIntegrationCatalog
} from '../services/viewer-integration-service';
import { browserDirectPolicy } from '../security/browser-direct-policy';
import { sendData } from '../utils/http-response';
import {
  viewerIntegrationCheckQuerySchema,
  viewerIntegrationCheckSchema,
  viewerIntegrationPromotionSchema,
  viewerIntegrationRolloutSchema
} from '../validators/request-schemas';

function userId(request: Request): string {
  return request.auth!.userId;
}

/**
 * What this build can do, in product terms. Renderer module names stay out of
 * the response: they are integration detail, not a public API field.
 */
export async function capabilities(_request: Request, response: Response): Promise<void> {
  sendData(response, {
    capabilities: Object.values(CAPABILITY_REGISTRY).map((capability) => ({
      id: capability.id,
      productFeature: capability.productFeature,
      availability: capability.availability,
      dependencies: capability.dependencies,
      incompatibilities: capability.incompatibilities,
      deviceRequirements: capability.deviceRequirements,
      deviceRequirementResolution: capability.deviceRequirementResolution,
      mediaRequirements: capability.mediaRequirements,
      lazyLoadable: capability.lazyLoadModule !== null,
      fallback: capability.fallback === null
        ? null
        : { behavior: capability.fallback.behavior, alternatives: capability.fallback.alternatives }
    })),
    providers: {
      dualFisheyeIngest: isDualFisheyeIngestEnabled() ? 'enabled' : 'unavailable',
      liveSource: isLiveSourceEnabled() ? 'enabled' : 'unavailable'
    }
  });
}

/**
 * The browser-direct access policy, as configured in this deployment.
 *
 * Operators need to see which origins may reach media, the event stream and
 * telemetry without reading the source, because getting one of those wrong is
 * how an experience becomes embeddable somewhere it should not be.
 */
export async function browserAccessPolicy(
  _request: Request,
  response: Response
): Promise<void> {
  sendData(response, browserDirectPolicy());
}

export async function viewerIntegrations(_request: Request, response: Response): Promise<void> {
  const rollout = await getViewerIntegrationRollout();
  sendData(response, { rollout, versions: viewerIntegrationCatalog() });
}

export async function referenceSuite(_request: Request, response: Response): Promise<void> {
  sendData(response, {
    experiences: referenceExperiences().map((experience) => ({
      id: experience.id,
      title: experience.title,
      covers: experience.covers,
      experienceType: experience.project.type,
      visibility: experience.visibility,
      expectations: experience.expectations.map((expectation) => ({
        id: expectation.id,
        description: expectation.description
      }))
    }))
  });
}

export async function listChecks(request: Request, response: Response): Promise<void> {
  const query = viewerIntegrationCheckQuerySchema.parse(request.query ?? {});
  const checks = await listViewerIntegrationChecks(query.viewerIntegrationVersion);
  sendData(response, { checks });
}

export async function runCheck(request: Request, response: Response): Promise<void> {
  const input = viewerIntegrationCheckSchema.parse(request.body ?? {});
  const check = await runViewerIntegrationCheck(input.viewerIntegrationVersion, userId(request));
  sendData(response, { check }, { status: 201, message: 'Reference experience suite completed.' });
}

export async function setRollout(request: Request, response: Response): Promise<void> {
  const input = viewerIntegrationRolloutSchema.parse(request.body ?? {});
  const result = await setViewerIntegrationRollout(input, userId(request));
  sendData(response, result, { message: 'Rollout updated.' });
}

export async function promote(request: Request, response: Response): Promise<void> {
  const input = viewerIntegrationPromotionSchema.parse(request.body ?? {});
  const result = await promoteViewerIntegration(input.viewerIntegrationVersion, userId(request));
  sendData(response, result, { message: 'Viewer integration promoted.' });
}

export async function rollback(request: Request, response: Response): Promise<void> {
  const input = viewerIntegrationPromotionSchema.parse(request.body ?? {});
  const result = await rollbackViewerIntegration(input.viewerIntegrationVersion, userId(request));
  sendData(response, result, { message: 'Viewer integration rolled back.' });
}

/** The metric contract dashboards and alerts are written against. */
export async function metrics(_request: Request, response: Response): Promise<void> {
  response.setHeader('cache-control', 'private, no-store');
  sendData(response, {
    contract: metricsContract(),
    snapshot: metricsSnapshot(),
    process: {
      nodeEnv: config.nodeEnv,
      viewerIntegrationVersion: config.viewerIntegrationVersion,
      uptimeSeconds: Math.round(process.uptime())
    }
  });
}
