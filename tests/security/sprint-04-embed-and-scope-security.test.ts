import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { seedReadyPanorama } from '../fixtures/ready-panorama';
import { bearer, registerIdentity } from '../helpers/api-client';
import { generatedEquirectangularJpeg } from '../helpers/image-fixture';
import {
  startIntegrationTestContext,
  truncateApplicationData,
  type IntegrationTestContext
} from '../helpers/postgres-test-context';

/**
 * Sprint 04 §22 boundaries that the rest of the suite does not reach:
 * the embed-origin allowlist, plan/map media authorization, and the scope
 * separation between the creator API, its signed delivery tokens and the
 * operator-only platform surfaces.
 */
describe.sequential('Sprint 04 — embed origin, plan media and API scope boundaries', () => {
  let context: IntegrationTestContext;
  let panorama: Buffer;

  beforeAll(async () => {
    context = await startIntegrationTestContext();
    panorama = await generatedEquirectangularJpeg();
  }, 60_000);

  afterAll(async () => {
    await context?.stop();
  }, 60_000);

  beforeEach(async () => {
    await truncateApplicationData(context);
  });

  async function seedProject(label: string): Promise<{
    owner: { id: string; accessToken: string };
    auth: { Authorization: string };
    projectId: string;
    assetId: string;
    sceneId: string;
  }> {
    const owner = await registerIdentity(context.app, label);
    const auth = bearer(owner.accessToken);
    const created = await request(context.app)
      .post('/api/v1/projects')
      .set(auth)
      .send({ name: `${label} project` })
      .expect(201);
    const projectId = created.body.data.project.id as string;
    const seeded = await seedReadyPanorama({ ownerId: owner.id, projectId, bytes: panorama });
    const scene = await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes`)
      .set(auth)
      .send({ projectRevision: 1, name: 'Lobby', panoramaAssetId: seeded.assetId })
      .expect(201);
    return {
      owner,
      auth,
      projectId,
      assetId: seeded.assetId,
      sceneId: scene.body.data.scene.id as string
    };
  }

  it('enforces the embed-origin allowlist on every published delivery route', async () => {
    const { auth, projectId } = await seedProject('embed-origin');
    const slug = 'sprint04-embed-origin';
    // The deployment's own CORS allowlist gates cross-origin reads before any
    // experience policy is consulted, so the origin under test here is one
    // that clears that layer: what is being proven is the per-experience
    // decision, not the transport allowlist in front of it.
    const readerOrigin = 'http://client.sphere.test';

    await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(auth)
      .set('Idempotency-Key', randomUUID())
      .send({
        revision: 2,
        slug,
        visibility: 'public',
        embedPolicy: {
          mode: 'allowlist',
          allowedOrigins: ['https://partner.example'],
          allowedApiOrigins: [readerOrigin]
        }
      })
      .expect(201);

    // A direct visit carries no Origin: the allowlist restricts embedding, not
    // the canonical link. Framing itself is enforced by frame-ancestors.
    const direct = await request(context.app).get(`/view/${slug}/manifest`).expect(200);
    expect(direct.headers['content-security-policy'])
      .toContain("frame-ancestors 'self' https://partner.example");
    const manifest = direct.body.data.manifest;
    const sceneId = manifest.scenes[0].id as string;
    const mediaUrl = manifest.scenes[0].panorama.primary.url as string;

    const routes = [
      `/view/${slug}/manifest`,
      `/view/${slug}/scenes/${sceneId}`,
      `/view/${slug}/revisions/1/scene-index`,
      mediaUrl
    ];

    for (const path of routes) {
      const allowed = await request(context.app).get(path).set('Origin', readerOrigin);
      expect(allowed.status, `allowed origin on ${path}`).toBe(200);
    }

    // Narrowing the policy revokes that reader on every surface at once,
    // without recompiling or republishing the experience.
    await request(context.app)
      .put(`/api/v1/projects/${projectId}/embed-policy`)
      .set(auth)
      .send({
        embedPolicy: { mode: 'allowlist', allowedOrigins: ['https://partner.example'] }
      })
      .expect(200);

    for (const path of routes) {
      const denied = await request(context.app).get(path).set('Origin', readerOrigin);
      expect(denied.status, `revoked origin on ${path}`).toBe(403);
      expect(denied.body.error.code, `revoked origin on ${path}`).toBe('EMBED_ORIGIN_DENIED');
      // A direct visit still works: only the cross-origin reader lost access.
      await request(context.app).get(path).expect(200);
    }

    // Turning embedding off closes the experience to framing entirely.
    await request(context.app)
      .put(`/api/v1/projects/${projectId}/embed-policy`)
      .set(auth)
      .send({ embedPolicy: { mode: 'disabled' } })
      .expect(200);
    const unframed = await request(context.app).get(`/view/${slug}/manifest`).expect(403);
    expect(unframed.body.error.code).toBe('EMBED_ORIGIN_DENIED');

    // Only an admin may change where an experience can be embedded.
    const stranger = await registerIdentity(context.app, 'embed-stranger');
    await request(context.app)
      .put(`/api/v1/projects/${projectId}/embed-policy`)
      .set(bearer(stranger.accessToken))
      .send({ embedPolicy: { mode: 'anywhere' } })
      .expect(404);
  }, 120_000);

  it('refuses a plan image the project owner cannot use', async () => {
    const author = await seedProject('plan-author');
    const outsider = await seedProject('plan-outsider');

    // Another creator's panorama is not a plan image this project may adopt,
    // even though the requester owns the project they are editing.
    const foreign = await request(context.app)
      .post(`/api/v1/projects/${author.projectId}/plans`)
      .set(author.auth)
      .send({ projectRevision: 2, name: 'Stolen plan', assetId: outsider.assetId });
    expect(foreign.status).toBe(422);
    expect(foreign.body.error.code).toBe('INVALID_ASSET_REFERENCE');

    // An unknown asset id is refused the same way, so the response cannot be
    // used to tell an existing asset from a missing one.
    const unknown = await request(context.app)
      .post(`/api/v1/projects/${author.projectId}/plans`)
      .set(author.auth)
      .send({ projectRevision: 2, name: 'Phantom plan', assetId: randomUUID() });
    expect(unknown.status).toBe(422);
    expect(unknown.body.error.code).toBe('INVALID_ASSET_REFERENCE');

    // A plan with no image is still a valid authoring step.
    const created = await request(context.app)
      .post(`/api/v1/projects/${author.projectId}/plans`)
      .set(author.auth)
      .send({ projectRevision: 2, name: 'Ground floor' })
      .expect(201);
    const planId = created.body.data.plan.id as string;

    // The same rule applies on update, not only on create.
    const patched = await request(context.app)
      .patch(`/api/v1/projects/${author.projectId}/plans/${planId}`)
      .set(author.auth)
      .send({ projectRevision: 3, assetId: outsider.assetId });
    expect(patched.status).toBe(422);
    expect(patched.body.error.code).toBe('INVALID_ASSET_REFERENCE');

    // And a stranger cannot read or write the project's plans at all.
    const stranger = await registerIdentity(context.app, 'plan-stranger');
    await request(context.app)
      .get(`/api/v1/projects/${author.projectId}/plans`)
      .set(bearer(stranger.accessToken))
      .expect(404);
  }, 120_000);

  it('keeps delivery tokens and operator surfaces out of the creator API scope', async () => {
    const { auth, projectId } = await seedProject('scope-owner');
    const slug = 'sprint04-scope';
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(auth)
      .set('Idempotency-Key', randomUUID())
      .send({ revision: 2, slug, visibility: 'private' })
      .expect(201);

    const manifestResponse = await request(context.app)
      .get(`/view/${slug}/manifest`)
      .set(auth)
      .expect(200);
    const manifest = manifestResponse.body.data.manifest;
    const mediaUrl = manifest.scenes[0].panorama.primary.url as string;
    const [mediaPath, mediaQuery] = mediaUrl.split('?');
    const mediaToken = new URLSearchParams(mediaQuery).get('token')!;
    const telemetryToken = manifest.telemetry.ingestToken as string;

    // A media token is scoped to delivery. It is not a creator credential.
    for (const token of [mediaToken, telemetryToken]) {
      const escalated = await request(context.app)
        .get('/api/v1/projects')
        .set(bearer(token));
      expect(escalated.status).toBe(401);
    }

    // And it is scoped to the one derivative it was minted for: the signature
    // does not travel to another object in the same publication.
    const thumbnailUrl = manifest.scenes[0].panorama.base.url as string;
    const otherPath = thumbnailUrl.split('?')[0]!;
    expect(otherPath).not.toBe(mediaPath);
    const crossObject = await request(context.app).get(`${otherPath}?token=${mediaToken}`);
    expect(crossObject.status).toBe(403);
    expect(crossObject.body.error.code).toBe('MEDIA_ACCESS_DENIED');

    // A creator token is equally not a telemetry session token: reporting
    // against a publication requires the token issued with that manifest.
    const loadEvent = {
      eventId: randomUUID(),
      eventName: 'experience_load_started' as const,
      experienceId: projectId,
      publicationRevision: 1,
      viewerIntegrationVersion: manifest.viewerIntegrationVersion as string,
      sessionId: randomUUID(),
      occurredAt: new Date().toISOString()
    };
    const forgedTelemetry = await request(context.app)
      .post('/api/v1/runtime/events')
      .set('x-telemetry-token', mediaToken)
      .send({ events: [loadEvent] });
    expect(forgedTelemetry.status).toBe(401);
    expect(forgedTelemetry.body.error.code).toBe('TELEMETRY_TOKEN_INVALID');

    // The token issued with this manifest is the one ingestion trusts.
    await request(context.app)
      .post('/api/v1/runtime/events')
      .set('x-telemetry-token', telemetryToken)
      .send({ events: [loadEvent] })
      .expect(202);

    // Operator surfaces are gated on a platform role, not on owning a project.
    const operatorRoutes: [string, string][] = [
      ['get', '/api/v1/platform/viewer-integrations/checks'],
      ['get', '/api/v1/platform/metrics']
    ];
    for (const [method, path] of operatorRoutes) {
      const response = method === 'get'
        ? await request(context.app).get(path).set(auth)
        : await request(context.app).post(path).set(auth).send({});
      expect(response.status, path).toBe(403);
      expect(response.body.error.code, path).toBe('PLATFORM_ADMIN_REQUIRED');
    }
    await request(context.app)
      .post('/api/v1/platform/viewer-integrations/promote')
      .set(auth)
      .send({ viewerIntegrationVersion: 'psv-5.14.3-v1' })
      .expect(403);
    await request(context.app)
      .post('/api/v1/extensions')
      .set(auth)
      .send({
        extensionId: 'attacker.extension',
        version: '1.0.0',
        name: 'Attacker',
        supportedExperienceTypes: ['image360'],
        schema: { fields: {} },
        runtimeModule: 'https://attacker.example/payload.js'
      })
      .expect(403);

    // The read-only catalog stays available to an ordinary creator: that is
    // what the editor offers, and it exposes no runtime module names.
    const catalog = await request(context.app)
      .get('/api/v1/extensions')
      .set(auth)
      .expect(200);
    expect(JSON.stringify(catalog.body)).not.toContain('runtimeModule');
  }, 120_000);
});
