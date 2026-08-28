import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { seedReadyPanorama } from '../fixtures/ready-panorama';
import { bearer, registerIdentity, type TestIdentity } from '../helpers/api-client';
import { generatedEquirectangularJpeg, sha256 } from '../helpers/image-fixture';
import {
  startIntegrationTestContext,
  truncateApplicationData,
  type IntegrationTestContext
} from '../helpers/postgres-test-context';

type Bootstrap = {
  project: { id: string; type: string; revision: number; scenes: unknown[] };
  revision: number;
  assets: { id: string }[];
  mediaUrls: { derivativeId: string; url: string; expiresAt: string }[];
  capabilities: { id: string; productFeature: string; resolved: boolean }[];
  compileResult: {
    manifest: Record<string, unknown> | null;
    viewerIntegration: { rendererId: string } | null;
    diagnostics: unknown[];
    contentHash: string | null;
  };
  schemaVersion: number;
  viewerIntegrationVersion: string;
  livePatchContractVersion: string;
  compilerVersion: string;
  editorPolicy: {
    role: string;
    canEdit: boolean;
    tools: { id: string; name: string; state: string; reason?: string }[];
  };
  editorSession: { token: string; expiresAt: string };
};

/** Collects a server-sent event stream until a predicate is satisfied. */
async function readStream(options: {
  port: number;
  path: string;
  headers?: Record<string, string>;
  until: (body: string) => boolean;
  timeoutMs?: number;
}): Promise<{ status: number; body: string; close: () => void }> {
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
          if (options.until(body)) {
            resolve({ status: response.statusCode ?? 0, body, close });
          }
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

function eventNames(body: string): string[] {
  return [...body.matchAll(/^event: (.+)$/gmu)].map((match) => match[1]!.trim());
}

describe.sequential('Sprint 05 live authoring session', () => {
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

  async function seedImageProject(owner: TestIdentity): Promise<{
    projectId: string;
    sceneId: string;
    assetId: string;
    revision: number;
  }> {
    const auth = bearer(owner.accessToken);
    const created = await request(context.app)
      .post('/api/v1/projects')
      .set(auth)
      .send({ name: 'Editor session tour' })
      .expect(201);
    const projectId = created.body.data.project.id as string;
    const seeded = await seedReadyPanorama({ ownerId: owner.id, projectId, bytes: panorama });
    const scene = await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes`)
      .set(auth)
      .send({ projectRevision: 1, name: 'Lobby', panoramaAssetId: seeded.assetId })
      .expect(201);
    return {
      projectId,
      sceneId: scene.body.data.scene.id as string,
      assetId: seeded.assetId,
      revision: scene.body.data.projectRevision as number
    };
  }

  it('returns everything an editor needs to draw in one request', async () => {
    const owner = await registerIdentity(context.app, 'bootstrap-owner');
    const auth = bearer(owner.accessToken);
    const { projectId, sceneId } = await seedImageProject(owner);

    const response = await request(context.app)
      .get(`/api/v1/projects/${projectId}/editor-bootstrap`)
      .set(auth)
      .expect(200);
    const bootstrap = response.body.data as Bootstrap;

    expect(bootstrap.project.id).toBe(projectId);
    expect(bootstrap.project.type).toBe('image360');
    expect(bootstrap.revision).toBe(2);
    expect(bootstrap.assets.length).toBeGreaterThan(0);
    expect(bootstrap.mediaUrls.length).toBeGreaterThan(0);
    expect(bootstrap.mediaUrls[0]!.url).toContain('token=');
    expect(Date.parse(bootstrap.mediaUrls[0]!.expiresAt)).toBeGreaterThan(Date.now());
    expect(bootstrap.compileResult.manifest).not.toBeNull();
    expect(bootstrap.compileResult.viewerIntegration?.rendererId).toBeTruthy();
    expect(bootstrap.compileResult.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(bootstrap.schemaVersion).toBe(1);
    expect(bootstrap.viewerIntegrationVersion).toBeTruthy();
    expect(bootstrap.livePatchContractVersion).toBe('live-patch-1');
    expect(bootstrap.compilerVersion).toBe('experience-compiler-1');
    expect(bootstrap.editorPolicy).toMatchObject({ role: 'owner', canEdit: true });
    expect(bootstrap.editorPolicy.tools.some((tool) => tool.state === 'available')).toBe(true);
    expect(bootstrap.editorSession.token.length).toBeGreaterThan(20);

    // The manifest is renderable: it names the scene the editor just created.
    const manifest = bootstrap.compileResult.manifest!;
    expect((manifest.scenes as { id: string }[])[0]!.id).toBe(sceneId);

    // Tools that belong to 360 video are hidden, not shown broken.
    const timeline = bootstrap.editorPolicy.tools.find((tool) => tool.id === 'videoTimeline');
    expect(timeline?.state).toBe('hidden');
    expect(timeline?.reason).toContain('360 video');
  }, 60_000);

  it('bootstraps a 360 video experience with its timeline tools on offer', async () => {
    const owner = await registerIdentity(context.app, 'bootstrap-video');
    const auth = bearer(owner.accessToken);
    const created = await request(context.app)
      .post('/api/v1/projects')
      .set(auth)
      .send({ name: 'Harbour video', type: 'video360' })
      .expect(201);
    const projectId = created.body.data.project.id as string;

    const response = await request(context.app)
      .get(`/api/v1/projects/${projectId}/editor-bootstrap`)
      .set(auth)
      .expect(200);
    const bootstrap = response.body.data as Bootstrap;

    expect(bootstrap.project.type).toBe('video360');
    // No video is attached yet, so the compile refuses and says why in product
    // language rather than returning a half-built manifest.
    expect(bootstrap.compileResult.manifest).toBeNull();
    expect(bootstrap.compileResult.diagnostics.length).toBeGreaterThan(0);
    const hotspots = bootstrap.editorPolicy.tools.find((tool) => tool.id === 'hotspots');
    expect(hotspots?.state).toBe('hidden');
    const timeline = bootstrap.editorPolicy.tools.find((tool) => tool.id === 'videoTimeline');
    expect(timeline?.state).not.toBe('hidden');
  }, 60_000);

  it('applies a multi-hotspot drag atomically and bumps the revision once', async () => {
    const owner = await registerIdentity(context.app, 'batch-owner');
    const auth = bearer(owner.accessToken);
    const { projectId, sceneId } = await seedImageProject(owner);

    const hotspotIds: string[] = [];
    let revision = 2;
    for (const longitudeDegrees of [10, 20, 30]) {
      const created = await request(context.app)
        .post(`/api/v1/projects/${projectId}/scenes/${sceneId}/hotspots`)
        .set(auth)
        .send({
          projectRevision: revision,
          geometry: { kind: 'point' },
          position: { coordinateSystem: 'spherical_degrees', longitudeDegrees, latitudeDegrees: 0 }
        })
        .expect(201);
      hotspotIds.push(created.body.data.hotspot.id as string);
      revision = created.body.data.projectRevision as number;
    }

    const moved = await request(context.app)
      .patch(`/api/v1/projects/${projectId}/scenes/${sceneId}/hotspots`)
      .set(auth)
      .send({
        projectRevision: revision,
        hotspots: hotspotIds.map((id, index) => ({
          id,
          position: {
            coordinateSystem: 'spherical_degrees',
            longitudeDegrees: -40 + index,
            latitudeDegrees: 5
          }
        }))
      })
      .expect(200);

    // One edit, one revision.
    expect(moved.body.data.projectRevision).toBe(revision + 1);
    const positions = (moved.body.data.hotspots as { position: { longitudeDegrees: number } }[])
      .map((hotspot) => hotspot.position.longitudeDegrees)
      .sort((left, right) => left - right);
    expect(positions).toEqual([-40, -39, -38]);
  }, 60_000);

  it('rejects a whole batch when one entry is invalid, changing nothing', async () => {
    const owner = await registerIdentity(context.app, 'batch-atomic');
    const auth = bearer(owner.accessToken);
    const { projectId, sceneId } = await seedImageProject(owner);

    const created = await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes/${sceneId}/hotspots`)
      .set(auth)
      .send({
        projectRevision: 2,
        geometry: { kind: 'point' },
        position: { coordinateSystem: 'spherical_degrees', longitudeDegrees: 0, latitudeDegrees: 0 }
      })
      .expect(201);
    const hotspotId = created.body.data.hotspot.id as string;
    const revision = created.body.data.projectRevision as number;

    // A hotspot that does not exist in this scene invalidates the batch.
    await request(context.app)
      .patch(`/api/v1/projects/${projectId}/scenes/${sceneId}/hotspots`)
      .set(auth)
      .send({
        projectRevision: revision,
        hotspots: [
          {
            id: hotspotId,
            position: {
              coordinateSystem: 'spherical_degrees',
              longitudeDegrees: 44,
              latitudeDegrees: 0
            }
          },
          {
            id: randomUUID(),
            position: {
              coordinateSystem: 'spherical_degrees',
              longitudeDegrees: 45,
              latitudeDegrees: 0
            }
          }
        ]
      })
      .expect(404)
      .expect(({ body }) => expect(body.error.code).toBe('HOTSPOT_NOT_FOUND'));

    const scene = await request(context.app)
      .get(`/api/v1/projects/${projectId}/scenes/${sceneId}`)
      .set(auth)
      .expect(200);
    // Neither the moved hotspot nor the revision changed.
    expect(scene.body.data.scene.hotspots[0].position.longitudeDegrees).toBe(0);
    const project = await request(context.app)
      .get(`/api/v1/projects/${projectId}`)
      .set(auth)
      .expect(200);
    expect(project.body.data.project.revision).toBe(revision);
  }, 60_000);

  it('refuses a batch built against a stale revision', async () => {
    const owner = await registerIdentity(context.app, 'batch-stale');
    const auth = bearer(owner.accessToken);
    const { projectId, sceneId } = await seedImageProject(owner);
    const created = await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes/${sceneId}/hotspots`)
      .set(auth)
      .send({
        projectRevision: 2,
        geometry: { kind: 'point' },
        position: { coordinateSystem: 'spherical_degrees', longitudeDegrees: 0, latitudeDegrees: 0 }
      })
      .expect(201);

    await request(context.app)
      .patch(`/api/v1/projects/${projectId}/scenes/${sceneId}/hotspots`)
      .set(auth)
      .send({
        projectRevision: 1,
        hotspots: [{
          id: created.body.data.hotspot.id as string,
          position: {
            coordinateSystem: 'spherical_degrees',
            longitudeDegrees: 12,
            latitudeDegrees: 0
          }
        }]
      })
      .expect(409)
      .expect(({ body }) => expect(body.error).toMatchObject({
        code: 'REVISION_CONFLICT',
        details: { expectedRevision: 1, currentRevision: 3 }
      }));
  }, 60_000);

  it('reissues expiring media URLs without recompiling', async () => {
    const owner = await registerIdentity(context.app, 'media-refresh');
    const auth = bearer(owner.accessToken);
    const { projectId } = await seedImageProject(owner);

    const bootstrap = await request(context.app)
      .get(`/api/v1/projects/${projectId}/editor-bootstrap`)
      .set(auth)
      .expect(200);
    const derivativeIds = (bootstrap.body.data as Bootstrap).mediaUrls
      .map((entry) => entry.derivativeId);

    const refreshed = await request(context.app)
      .post('/api/v1/media/tokens')
      .set(auth)
      .send({ derivativeIds })
      .expect(200);
    const media = refreshed.body.data.media as { derivativeId: string; url: string }[];
    expect(media).toHaveLength(derivativeIds.length);

    // Each reissued URL actually fetches the media it names.
    for (const entry of media) {
      await request(context.app).get(entry.url).expect(200);
    }
  }, 60_000);

  it('streams processing, revision and publication events to a connected editor', async () => {
    const owner = await registerIdentity(context.app, 'stream-owner');
    const auth = bearer(owner.accessToken);
    const { projectId } = await seedImageProject(owner);
    const bootstrap = await request(context.app)
      .get(`/api/v1/projects/${projectId}/editor-bootstrap`)
      .set(auth)
      .expect(200);
    const sessionToken = (bootstrap.body.data as Bootstrap).editorSession.token;

    const streamPath = `/api/v1/projects/${projectId}/events?token=${encodeURIComponent(sessionToken)}`;
    const streaming = readStream({
      port,
      path: streamPath,
      until: (body) => body.includes('publication.completed')
    });
    // Let the stream open before the writes it should report.
    await new Promise((resolve) => setTimeout(resolve, 150));

    const scene = await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes`)
      .set(auth)
      .send({
        projectRevision: 2,
        name: 'Courtyard',
        panoramaAssetId: (bootstrap.body.data as Bootstrap).assets[0]!.id
      })
      .expect(201);
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(auth)
      .set('Idempotency-Key', `stream-${randomUUID()}`)
      .send({
        revision: scene.body.data.projectRevision as number,
        slug: `stream-tour-${randomUUID().slice(0, 8)}`,
        visibility: 'public'
      })
      .expect(201);

    const stream = await streaming;
    stream.close();
    expect(stream.status).toBe(200);
    expect(stream.body).toContain(': open');
    expect(eventNames(stream.body)).toContain('project.revision.changed');
    expect(eventNames(stream.body)).toContain('publication.completed');
    // The actor travels with the event so a client can ignore its own writes.
    expect(stream.body).toContain(`"actorUserId":"${owner.id}"`);
  }, 60_000);

  it('resumes from Last-Event-ID without duplicating or dropping events', async () => {
    const owner = await registerIdentity(context.app, 'stream-resume');
    const auth = bearer(owner.accessToken);
    const { projectId, sceneId } = await seedImageProject(owner);
    const bootstrap = await request(context.app)
      .get(`/api/v1/projects/${projectId}/editor-bootstrap`)
      .set(auth)
      .expect(200);
    const sessionToken = (bootstrap.body.data as Bootstrap).editorSession.token;
    const streamPath = `/api/v1/projects/${projectId}/events?token=${encodeURIComponent(sessionToken)}`;

    // Two writes while nobody is listening.
    let revision = 2;
    for (const longitudeDegrees of [5, 15]) {
      const created = await request(context.app)
        .post(`/api/v1/projects/${projectId}/scenes/${sceneId}/hotspots`)
        .set(auth)
        .send({
          projectRevision: revision,
          geometry: { kind: 'point' },
          position: { coordinateSystem: 'spherical_degrees', longitudeDegrees, latitudeDegrees: 0 }
        })
        .expect(201);
      revision = created.body.data.projectRevision as number;
    }

    // Resuming from the first event replays exactly the second.
    const resumed = await readStream({
      port,
      path: streamPath,
      headers: { 'Last-Event-ID': '1' },
      until: (body) => body.includes('id: 2')
    });
    resumed.close();
    expect(resumed.body).not.toContain('id: 1\n');
    expect(resumed.body).toContain('id: 2');
    expect(eventNames(resumed.body)).toEqual(['project.revision.changed']);
  }, 60_000);

  it('streams asset processing progress, readiness and failure', async () => {
    const owner = await registerIdentity(context.app, 'stream-assets');
    const auth = bearer(owner.accessToken);
    const created = await request(context.app)
      .post('/api/v1/projects')
      .set(auth)
      .send({ name: 'Asset events' })
      .expect(201);
    const projectId = created.body.data.project.id as string;

    const streaming = readStream({
      port,
      path: `/api/v1/projects/${projectId}/events`,
      headers: { Authorization: `Bearer ${owner.accessToken}` },
      until: (body) => body.includes('asset.ready')
    });
    await new Promise((resolve) => setTimeout(resolve, 150));

    const upload = await request(context.app)
      .post('/api/v1/assets/uploads')
      .set(auth)
      .send({
        projectId,
        filename: 'lobby.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: panorama.length,
        checksumSha256: sha256(panorama)
      })
      .expect(201);
    await request(context.app)
      .put(upload.body.data.upload.url as string)
      .set(auth)
      .set('Content-Type', 'image/jpeg')
      .send(panorama)
      .expect(200);
    await request(context.app)
      .post(`/api/v1/assets/${upload.body.data.asset.id as string}/complete`)
      .set(auth)
      .set('Idempotency-Key', `complete-${randomUUID()}`)
      .send({ uploadSessionId: upload.body.data.upload.sessionId as string })
      .expect(202);
    const { drainMediaJobs } = await import('../../apps/api/src/services/media-worker-service');
    await drainMediaJobs();

    const stream = await streaming;
    stream.close();
    const delivered = eventNames(stream.body);
    expect(delivered).toContain('asset.processing.progress');
    expect(delivered).toContain('asset.ready');

    // A failure is reported the same way. A square image is a valid JPEG but
    // not a panorama, so it is accepted at upload and refused at processing.
    const square = await sharp({
      create: { width: 128, height: 128, channels: 3, background: { r: 10, g: 10, b: 10 } }
    }).jpeg({ quality: 82 }).toBuffer();
    const failing = await request(context.app)
      .post('/api/v1/assets/uploads')
      .set(auth)
      .send({
        projectId,
        filename: 'not-a-panorama.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: square.length,
        checksumSha256: sha256(square)
      })
      .expect(201);
    await request(context.app)
      .put(failing.body.data.upload.url as string)
      .set(auth)
      .set('Content-Type', 'image/jpeg')
      .send(square)
      .expect(200);
    await request(context.app)
      .post(`/api/v1/assets/${failing.body.data.asset.id as string}/complete`)
      .set(auth)
      .set('Idempotency-Key', `complete-${randomUUID()}`)
      .send({ uploadSessionId: failing.body.data.upload.sessionId as string })
      .expect(202);

    const failureStream = readStream({
      port,
      path: `/api/v1/projects/${projectId}/events`,
      headers: { Authorization: `Bearer ${owner.accessToken}` },
      until: (body) => body.includes('asset.failed')
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    await drainMediaJobs();

    const { Asset } = await import('../../apps/api/src/models');
    const failedAsset = await Asset.findByPk(failing.body.data.asset.id as string);
    expect(failedAsset?.processingStatus).toBe('failed');
    const failureEvents = await failureStream;
    failureEvents.close();
    expect(eventNames(failureEvents.body)).toContain('asset.failed');
  }, 90_000);

  it('keeps every polling path working when the stream is refused', async () => {
    const owner = await registerIdentity(context.app, 'stream-degraded');
    const auth = bearer(owner.accessToken);
    const { projectId, assetId } = await seedImageProject(owner);

    // A caller with no stream still learns everything by polling.
    await request(context.app)
      .get(`/api/v1/projects/${projectId}`)
      .set(auth)
      .expect(200)
      .expect(({ body }) => expect(body.data.project.revision).toBe(2));
    await request(context.app)
      .get(`/api/v1/assets/${assetId}`)
      .set(auth)
      .expect(200)
      .expect(({ body }) => expect(body.data.asset.processingStatus).toBe('ready'));
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/preview-manifest`)
      .set(auth)
      .send({ revision: 2 })
      .expect(200);
  }, 60_000);
});
