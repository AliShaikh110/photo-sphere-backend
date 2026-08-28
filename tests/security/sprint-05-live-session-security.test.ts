import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { seedReadyPanorama } from '../fixtures/ready-panorama';
import { bearer, registerIdentity, type TestIdentity } from '../helpers/api-client';
import { generatedEquirectangularJpeg } from '../helpers/image-fixture';
import {
  startIntegrationTestContext,
  truncateApplicationData,
  type IntegrationTestContext
} from '../helpers/postgres-test-context';

type StreamResult = { status: number; body: string; close: () => void };

async function readStream(options: {
  port: number;
  path: string;
  headers?: Record<string, string>;
  until: (body: string) => boolean;
  timeoutMs?: number;
}): Promise<StreamResult> {
  return new Promise((resolve, reject) => {
    let body = '';
    const clientRequest = http.get(
      { port: options.port, path: options.path, headers: options.headers ?? {} },
      (response) => {
        response.setEncoding('utf8');
        const close = (): void => {
          clientRequest.destroy();
        };
        if ((response.statusCode ?? 0) !== 200) {
          response.on('data', (chunk: string) => {
            body += chunk;
          });
          response.on('end', () => resolve({ status: response.statusCode ?? 0, body, close }));
          return;
        }
        response.on('data', (chunk: string) => {
          body += chunk;
          if (options.until(body)) resolve({ status: 200, body, close });
        });
        response.on('error', reject);
      }
    );
    clientRequest.on('error', reject);
    setTimeout(() => {
      clientRequest.destroy();
      reject(new Error(`Timed out waiting for the event stream. Received: ${body}`));
    }, options.timeoutMs ?? 8_000).unref();
  });
}

/**
 * The live authoring session adds three browser-direct paths and one new
 * credential. Each one has to grant exactly what the caller already had, and
 * nothing more.
 */
describe.sequential('Sprint 05 live session security boundaries', () => {
  let context: IntegrationTestContext;
  let panorama: Buffer;
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    context = await startIntegrationTestContext();
    panorama = await generatedEquirectangularJpeg();
    server = context.app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    port = (server.address() as AddressInfo).port;
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await context?.stop();
  }, 60_000);

  beforeEach(async () => {
    await truncateApplicationData(context);
  });

  async function seedProject(owner: TestIdentity, name = 'Guarded tour'): Promise<{
    projectId: string;
    standardWebDerivativeId: string;
  }> {
    const auth = bearer(owner.accessToken);
    const created = await request(context.app)
      .post('/api/v1/projects')
      .set(auth)
      .send({ name })
      .expect(201);
    const projectId = created.body.data.project.id as string;
    const seeded = await seedReadyPanorama({ ownerId: owner.id, projectId, bytes: panorama });
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes`)
      .set(auth)
      .send({ projectRevision: 1, name: 'Lobby', panoramaAssetId: seeded.assetId })
      .expect(201);
    return { projectId, standardWebDerivativeId: seeded.standardWebDerivativeId };
  }

  it('bootstraps for a collaborator at their own role and hides nothing else', async () => {
    const owner = await registerIdentity(context.app, 'policy-owner');
    const viewer = await registerIdentity(context.app, 'policy-viewer');
    const editor = await registerIdentity(context.app, 'policy-editor');
    const stranger = await registerIdentity(context.app, 'policy-stranger');
    const { projectId } = await seedProject(owner);

    for (const [identity, role] of [[viewer, 'viewer'], [editor, 'editor']] as const) {
      await request(context.app)
        .post(`/api/v1/projects/${projectId}/access`)
        .set(bearer(owner.accessToken))
        .send({ email: identity.email, role })
        .expect(201);
    }

    const asViewer = await request(context.app)
      .get(`/api/v1/projects/${projectId}/editor-bootstrap`)
      .set(bearer(viewer.accessToken))
      .expect(200);
    expect(asViewer.body.data.editorPolicy).toMatchObject({ role: 'viewer', canEdit: false });
    expect(asViewer.body.data.editorPolicy.readOnlyReason).toContain('view-only');
    const viewerTools = asViewer.body.data.editorPolicy.tools as { state: string }[];
    expect(viewerTools.some((tool) => tool.state === 'available')).toBe(false);

    const asEditor = await request(context.app)
      .get(`/api/v1/projects/${projectId}/editor-bootstrap`)
      .set(bearer(editor.accessToken))
      .expect(200);
    expect(asEditor.body.data.editorPolicy).toMatchObject({ role: 'editor', canEdit: true });

    const asOwner = await request(context.app)
      .get(`/api/v1/projects/${projectId}/editor-bootstrap`)
      .set(bearer(owner.accessToken))
      .expect(200);
    expect(asOwner.body.data.editorPolicy).toMatchObject({ role: 'owner', canEdit: true });

    // No access is indistinguishable from no project.
    await request(context.app)
      .get(`/api/v1/projects/${projectId}/editor-bootstrap`)
      .set(bearer(stranger.accessToken))
      .expect(404)
      .expect(({ body }) => expect(body.error.code).toBe('PROJECT_NOT_FOUND'));
    await request(context.app)
      .get(`/api/v1/projects/${projectId}/editor-bootstrap`)
      .expect(401);
  }, 60_000);

  it('refuses to edit hotspots in a batch for a viewer', async () => {
    const owner = await registerIdentity(context.app, 'batch-owner-guard');
    const viewer = await registerIdentity(context.app, 'batch-viewer-guard');
    const { projectId } = await seedProject(owner);
    const scenes = await request(context.app)
      .get(`/api/v1/projects/${projectId}/scenes`)
      .set(bearer(owner.accessToken))
      .expect(200);
    const sceneId = scenes.body.data.scenes[0].id as string;
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/access`)
      .set(bearer(owner.accessToken))
      .send({ email: viewer.email, role: 'viewer' })
      .expect(201);

    await request(context.app)
      .patch(`/api/v1/projects/${projectId}/scenes/${sceneId}/hotspots`)
      .set(bearer(viewer.accessToken))
      .send({
        projectRevision: 2,
        hotspots: [{
          id: randomUUID(),
          position: {
            coordinateSystem: 'spherical_degrees',
            longitudeDegrees: 0,
            latitudeDegrees: 0
          }
        }]
      })
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('PROJECT_ACCESS_DENIED'));
  }, 60_000);

  it('re-checks authorization for every derivative a refresh names', async () => {
    const owner = await registerIdentity(context.app, 'refresh-owner');
    const attacker = await registerIdentity(context.app, 'refresh-attacker');
    const victim = await seedProject(owner, 'Private tour');
    const attackerProject = await seedProject(attacker, 'Attacker tour');

    // Its own media refreshes.
    await request(context.app)
      .post('/api/v1/media/tokens')
      .set(bearer(attacker.accessToken))
      .send({ derivativeIds: [attackerProject.standardWebDerivativeId] })
      .expect(200);

    // Someone else's does not, even mixed in with its own.
    await request(context.app)
      .post('/api/v1/media/tokens')
      .set(bearer(attacker.accessToken))
      .send({
        derivativeIds: [
          attackerProject.standardWebDerivativeId,
          victim.standardWebDerivativeId
        ]
      })
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('MEDIA_ACCESS_DENIED'));

    await request(context.app)
      .post('/api/v1/media/tokens')
      .send({ derivativeIds: [victim.standardWebDerivativeId] })
      .expect(401);
  }, 60_000);

  it('rejects an expired media URL and an expired editing session', async () => {
    const owner = await registerIdentity(context.app, 'expiry-owner');
    const { projectId } = await seedProject(owner);
    const { config } = await import('../../apps/api/src/config');
    const mediaTtl = config.signedMediaTtlSeconds;
    const sessionTtl = config.editorSessionTtlSeconds;

    let expiredMediaUrl: string;
    let expiredSessionToken: string;
    try {
      // Mint credentials that were already expired when they were issued.
      (config as { signedMediaTtlSeconds: number }).signedMediaTtlSeconds = -30;
      (config as { editorSessionTtlSeconds: number }).editorSessionTtlSeconds = -30;
      const bootstrap = await request(context.app)
        .get(`/api/v1/projects/${projectId}/editor-bootstrap`)
        .set(bearer(owner.accessToken))
        .expect(200);
      expiredMediaUrl = bootstrap.body.data.mediaUrls[0].url as string;
      expiredSessionToken = bootstrap.body.data.editorSession.token as string;
    } finally {
      (config as { signedMediaTtlSeconds: number }).signedMediaTtlSeconds = mediaTtl;
      (config as { editorSessionTtlSeconds: number }).editorSessionTtlSeconds = sessionTtl;
    }

    await request(context.app)
      .get(expiredMediaUrl)
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('MEDIA_ACCESS_DENIED'));

    const stream = await readStream({
      port,
      path: `/api/v1/projects/${projectId}/events?token=${encodeURIComponent(expiredSessionToken)}`,
      until: () => true
    });
    stream.close();
    expect(stream.status).toBe(401);
    expect(stream.body).toContain('EDITOR_SESSION_INVALID');
  }, 60_000);

  it('will not open one project stream with another project session token', async () => {
    const owner = await registerIdentity(context.app, 'scope-owner');
    const first = await seedProject(owner, 'First tour');
    const second = await seedProject(owner, 'Second tour');
    const bootstrap = await request(context.app)
      .get(`/api/v1/projects/${first.projectId}/editor-bootstrap`)
      .set(bearer(owner.accessToken))
      .expect(200);
    const token = bootstrap.body.data.editorSession.token as string;

    const stream = await readStream({
      port,
      path: `/api/v1/projects/${second.projectId}/events?token=${encodeURIComponent(token)}`,
      until: () => true
    });
    stream.close();
    expect(stream.status).toBe(401);
    expect(stream.body).toContain('EDITOR_SESSION_INVALID');
  }, 60_000);

  it('refuses a stream to someone with no access, and refuses an anonymous one', async () => {
    const owner = await registerIdentity(context.app, 'stream-guard-owner');
    const stranger = await registerIdentity(context.app, 'stream-guard-stranger');
    const { projectId } = await seedProject(owner);

    const anonymous = await readStream({
      port,
      path: `/api/v1/projects/${projectId}/events`,
      until: () => true
    });
    anonymous.close();
    expect(anonymous.status).toBe(401);

    const denied = await readStream({
      port,
      path: `/api/v1/projects/${projectId}/events`,
      headers: { Authorization: `Bearer ${stranger.accessToken}` },
      until: () => true
    });
    denied.close();
    expect(denied.status).toBe(404);
    expect(denied.body).toContain('PROJECT_NOT_FOUND');
  }, 60_000);

  it('bounds how many streams one editor may hold open', async () => {
    const owner = await registerIdentity(context.app, 'stream-limit-owner');
    const { projectId } = await seedProject(owner);
    const { config } = await import('../../apps/api/src/config');
    const perUser = config.eventStream.maxConnectionsPerUser;
    const open: StreamResult[] = [];
    try {
      (config.eventStream as { maxConnectionsPerUser: number }).maxConnectionsPerUser = 2;
      for (let index = 0; index < 2; index += 1) {
        open.push(await readStream({
          port,
          path: `/api/v1/projects/${projectId}/events`,
          headers: { Authorization: `Bearer ${owner.accessToken}` },
          until: (body) => body.includes(': open')
        }));
      }
      const refused = await readStream({
        port,
        path: `/api/v1/projects/${projectId}/events`,
        headers: { Authorization: `Bearer ${owner.accessToken}` },
        until: () => true
      });
      refused.close();
      expect(refused.status).toBe(429);
      expect(refused.body).toContain('EVENT_STREAM_LIMIT_REACHED');
    } finally {
      for (const stream of open) stream.close();
      (config.eventStream as { maxConnectionsPerUser: number }).maxConnectionsPerUser = perUser;
    }
  }, 60_000);

  it('degrades to polling when the stream is turned off', async () => {
    const owner = await registerIdentity(context.app, 'stream-off-owner');
    const { projectId } = await seedProject(owner);
    const { config } = await import('../../apps/api/src/config');
    try {
      (config.eventStream as { enabled: boolean }).enabled = false;
      const refused = await readStream({
        port,
        path: `/api/v1/projects/${projectId}/events`,
        headers: { Authorization: `Bearer ${owner.accessToken}` },
        until: () => true
      });
      refused.close();
      expect(refused.status).toBe(503);
      expect(refused.body).toContain('EVENT_STREAM_DISABLED');

      // Everything the stream would have said is still readable by polling.
      await request(context.app)
        .get(`/api/v1/projects/${projectId}`)
        .set(bearer(owner.accessToken))
        .expect(200);
      await request(context.app)
        .get(`/api/v1/projects/${projectId}/scenes`)
        .set(bearer(owner.accessToken))
        .expect(200);
      await request(context.app)
        .post(`/api/v1/projects/${projectId}/preview-manifest`)
        .set(bearer(owner.accessToken))
        .send({ revision: 2 })
        .expect(200);
      await request(context.app)
        .get(`/api/v1/projects/${projectId}/publications`)
        .set(bearer(owner.accessToken))
        .expect(200);
    } finally {
      (config.eventStream as { enabled: boolean }).enabled = true;
    }
  }, 60_000);

  it('publishes the server result when a client hash disagrees, without failing', async () => {
    const owner = await registerIdentity(context.app, 'hash-drift-owner');
    const { projectId } = await seedProject(owner);
    const published = await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(bearer(owner.accessToken))
      .set('Idempotency-Key', `drift-${randomUUID()}`)
      .send({
        revision: 2,
        slug: `drift-tour-${randomUUID().slice(0, 8)}`,
        visibility: 'public',
        // Advisory only: a wrong hash must not change or block the publish.
        contentHash: 'f'.repeat(64)
      })
      .expect(201);
    expect(published.body.data.publication.status).toBe('published');

    const manifest = await request(context.app)
      .get(`/view/${published.body.data.publication.slug as string}/manifest`)
      .expect(200);
    expect(manifest.body.data.manifest.experienceId).toBe(projectId);
  }, 60_000);
});
