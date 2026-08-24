import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { bearer, registerIdentity } from '../helpers/api-client';
import { generatedEquirectangularJpeg, sha256 } from '../helpers/image-fixture';
import {
  startIntegrationTestContext,
  truncateApplicationData,
  type IntegrationTestContext
} from '../helpers/postgres-test-context';

describe.sequential('Sprint 01 HTTP integration', () => {
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

  it('registers and authenticates users while enforcing project ownership and revisions', async () => {
    const password = 'correct-horse-battery-staple';
    const email = `owner-${randomUUID()}@example.test`;

    await request(context.app)
      .get('/api/v1/projects')
      .expect(401)
      .expect(({ body }) => expect(body.error.code).toBe('AUTHENTICATION_REQUIRED'));

    const registration = await request(context.app)
      .post('/api/v1/auth/register')
      .send({ email: email.toUpperCase(), password, displayName: '<b>Owner</b>' })
      .expect(201);
    const ownerToken = registration.body.data.accessToken as string;
    expect(registration.body.data.user).toMatchObject({ email, displayName: 'Owner', status: 'active' });
    expect(JSON.stringify(registration.body)).not.toContain('passwordHash');

    await request(context.app)
      .post('/api/v1/auth/register')
      .send({ email, password, displayName: 'Duplicate' })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('EMAIL_ALREADY_REGISTERED'));

    await request(context.app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'wrong-password' })
      .expect(401)
      .expect(({ body }) => expect(body.error.code).toBe('INVALID_CREDENTIALS'));

    const login = await request(context.app)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    expect(login.body.data.accessToken).toEqual(expect.any(String));

    const projectResponse = await request(context.app)
      .post('/api/v1/projects')
      .set(bearer(ownerToken))
      .send({
        type: 'image360',
        name: '<b>Lobby</b> Tour',
        settings: {
          information: {
            title: '<b>Lobby</b>',
            description: '<img src=x onerror=alert(1)>Description',
            bodyHtml: '<p onclick="steal()">Welcome</p><script>alert(1)</script>',
            externalUrl: 'https://EXAMPLE.com/tours'
          }
        },
        branding: { welcomeMessage: '<strong>Hello</strong><img src=x onerror=alert(1)>' }
      })
      .expect(201);
    const projectId = projectResponse.body.data.project.id as string;
    expect(projectResponse.body.data.project).toMatchObject({
      id: projectId,
      name: 'Lobby Tour',
      revision: 1,
      settings: {
        information: {
          title: 'Lobby',
          description: 'Description',
          bodyHtml: '<p>Welcome</p>',
          externalUrl: 'https://example.com/tours'
        }
      },
      branding: { welcomeMessage: '<strong>Hello</strong>' }
    });

    const other = await registerIdentity(context.app, 'other-owner');
    await request(context.app)
      .get(`/api/v1/projects/${projectId}`)
      .set(bearer(other.accessToken))
      .expect(404);
    await request(context.app)
      .patch(`/api/v1/projects/${projectId}`)
      .set(bearer(other.accessToken))
      .send({ revision: 1, name: 'Stolen' })
      .expect(404);

    const ownerList = await request(context.app)
      .get('/api/v1/projects')
      .set(bearer(ownerToken))
      .expect(200);
    expect(ownerList.body.data.projects).toHaveLength(1);
    const otherList = await request(context.app)
      .get('/api/v1/projects')
      .set(bearer(other.accessToken))
      .expect(200);
    expect(otherList.body.data.projects).toEqual([]);

    const renamed = await request(context.app)
      .patch(`/api/v1/projects/${projectId}`)
      .set(bearer(ownerToken))
      .send({ revision: 1, name: 'Renamed Lobby' })
      .expect(200);
    expect(renamed.body.data.project).toMatchObject({ name: 'Renamed Lobby', revision: 2 });

    await request(context.app)
      .patch(`/api/v1/projects/${projectId}`)
      .set(bearer(ownerToken))
      .send({ revision: 1, name: 'Stale Save' })
      .expect(409)
      .expect(({ body }) => {
        expect(body.error).toMatchObject({
          code: 'REVISION_CONFLICT',
          details: { expectedRevision: 1, currentRevision: 2 }
        });
      });

    await request(context.app)
      .patch(`/api/v1/projects/${projectId}`)
      .set(bearer(ownerToken))
      .send({ revision: 2_147_483_648, name: 'Out of database range' })
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('VALIDATION_FAILED'));

    await request(context.app)
      .patch(`/api/v1/projects/${projectId}`)
      .set(bearer(ownerToken))
      .send({
        revision: 2,
        settings: { information: { externalUrl: 'javascript:alert(document.cookie)' } }
      })
      .expect(422)
      .expect(({ body }) => expect(body.error).toMatchObject({
        code: 'URL_SCHEME_NOT_ALLOWED',
        path: 'settings.information.externalUrl'
      }));

    const unchanged = await request(context.app)
      .get(`/api/v1/projects/${projectId}`)
      .set(bearer(ownerToken))
      .expect(200);
    expect(unchanged.body.data.project).toMatchObject({ name: 'Renamed Lobby', revision: 2 });
  });

  it('runs upload, authoring, validation, publication, access control, and telemetry end to end', async ({ skip }) => {
    if (context.databaseKind !== 'postgres') {
      skip('Media-job row locks and the production migration require real PostgreSQL.');
    }

    const owner = await registerIdentity(context.app, 'publisher');
    const other = await registerIdentity(context.app, 'viewer');
    const auth = bearer(owner.accessToken);

    const projectResponse = await request(context.app)
      .post('/api/v1/projects')
      .set(auth)
      .send({ name: 'Panorama Experience', type: 'image360' })
      .expect(201);
    const projectId = projectResponse.body.data.project.id as string;

    await request(context.app)
      .post('/api/v1/assets/uploads')
      .set(auth)
      .send({ filename: 'too-large.jpg', mimeType: 'image/jpeg', sizeBytes: 1024 * 1024 + 1 })
      .expect(413)
      .expect(({ body }) => expect(body.error.code).toBe('UPLOAD_TOO_LARGE'));

    await request(context.app)
      .post('/api/v1/assets/uploads')
      .set(bearer(other.accessToken))
      .send({ projectId, filename: 'not-yours.jpg', mimeType: 'image/jpeg', sizeBytes: panorama.length })
      .expect(404);

    const sizeSession = await request(context.app)
      .post('/api/v1/assets/uploads')
      .set(auth)
      .send({ filename: 'size.jpg', mimeType: 'image/jpeg', sizeBytes: panorama.length + 1 })
      .expect(201);
    await request(context.app)
      .put(sizeSession.body.data.upload.url as string)
      .set(auth)
      .set('Content-Type', 'image/jpeg')
      .send(panorama)
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('UPLOAD_SIZE_MISMATCH'));

    const mimeSession = await request(context.app)
      .post('/api/v1/assets/uploads')
      .set(auth)
      .send({ filename: 'mismatch.png', mimeType: 'image/png', sizeBytes: panorama.length })
      .expect(201);
    await request(context.app)
      .put(mimeSession.body.data.upload.url as string)
      .set(auth)
      .set('Content-Type', 'image/png')
      .send(panorama)
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('UPLOAD_MIME_MISMATCH'));

    const signatureSession = await request(context.app)
      .post('/api/v1/assets/uploads')
      .set(auth)
      .send({ filename: 'fake.jpg', mimeType: 'image/jpeg', sizeBytes: panorama.length })
      .expect(201);
    await request(context.app)
      .put(signatureSession.body.data.upload.url as string)
      .set(auth)
      .set('Content-Type', 'image/jpeg')
      .send(Buffer.alloc(panorama.length, 0x41))
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('UNSUPPORTED_IMAGE_TYPE'));

    const uploadSession = await request(context.app)
      .post('/api/v1/assets/uploads')
      .set(auth)
      .send({
        filename: '../lobby panorama.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: panorama.length,
        checksumSha256: sha256(panorama)
      })
      .expect(201);
    const assetId = uploadSession.body.data.asset.id as string;
    const uploadUrl = uploadSession.body.data.upload.url as string;
    const uploadSessionId = uploadSession.body.data.upload.sessionId as string;
    expect(uploadSession.body.data.asset.filename).toBe('lobby_panorama.jpg');

    await request(context.app)
      .put(uploadUrl)
      .set(auth)
      .set('Content-Type', 'image/jpeg')
      .send(panorama)
      .expect(200)
      .expect(({ body }) => expect(body.data).toMatchObject({ assetId, uploadSessionId, status: 'uploaded' }));

    await request(context.app)
      .post(`/api/v1/assets/${assetId}/complete`)
      .set(auth)
      .send({ uploadSessionId })
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED'));

    const completionKey = `complete-${randomUUID()}`;
    const completed = await request(context.app)
      .post(`/api/v1/assets/${assetId}/complete`)
      .set(auth)
      .set('Idempotency-Key', completionKey)
      .send({ uploadSessionId })
      .expect(202)
      .expect('Idempotency-Replayed', 'false');
    const replayedCompletion = await request(context.app)
      .post(`/api/v1/assets/${assetId}/complete`)
      .set(auth)
      .set('Idempotency-Key', completionKey)
      .send({ uploadSessionId })
      .expect(202)
      .expect('Idempotency-Replayed', 'true');
    expect(replayedCompletion.body.data).toEqual(completed.body.data);

    const { MediaJob } = await import('../../src/models');
    expect(await MediaJob.count({ where: { assetId } })).toBe(1);
    const { drainMediaJobs } = await import('../../src/services/media-worker-service');
    await expect(drainMediaJobs()).resolves.toBe(1);
    await expect(drainMediaJobs()).resolves.toBe(0);

    const readyAssetResponse = await request(context.app)
      .get(`/api/v1/assets/${assetId}`)
      .set(auth)
      .expect(200);
    const readyAsset = readyAssetResponse.body.data.asset as {
      processingStatus: string;
      projection: string;
      metadata: { width: number; height: number; is360: boolean };
      derivatives: Array<{ id: string; kind: string; width: number; height: number }>;
    };
    expect(readyAsset).toMatchObject({
      processingStatus: 'ready',
      projection: 'equirectangular',
      metadata: { width: 256, height: 128, is360: true }
    });
    expect(readyAsset.derivatives.map((item) => item.kind).sort()).toEqual([
      'lowResolutionBase',
      'standardWeb',
      'thumbnail'
    ]);
    const standardWeb = readyAsset.derivatives.find((item) => item.kind === 'standardWeb')!;

    const sceneResponse = await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes`)
      .set(auth)
      .send({
        projectRevision: 1,
        name: 'Main Scene',
        panoramaAssetId: assetId,
        initialView: { headingDegrees: 5, pitchDegrees: 2, horizontalFovDegrees: 80 }
      })
      .expect(201);
    const sceneId = sceneResponse.body.data.scene.id as string;
    expect(sceneResponse.body.data).toMatchObject({
      projectRevision: 2,
      scene: { id: sceneId, isPrimary: true, panoramaAssetId: assetId }
    });

    const patchedScene = await request(context.app)
      .patch(`/api/v1/projects/${projectId}/scenes/${sceneId}`)
      .set(auth)
      .send({ projectRevision: 2, name: 'Updated Main Scene' })
      .expect(200);
    expect(patchedScene.body.data).toMatchObject({ projectRevision: 3, scene: { name: 'Updated Main Scene' } });

    const disposableScene = await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes`)
      .set(auth)
      .send({ projectRevision: 3, name: 'Disposable Scene', panoramaAssetId: assetId })
      .expect(201);
    const disposableSceneId = disposableScene.body.data.scene.id as string;
    await request(context.app)
      .delete(`/api/v1/projects/${projectId}/scenes/${disposableSceneId}`)
      .set(auth)
      .send({ projectRevision: 4 })
      .expect(200)
      .expect(({ body }) => expect(body.data).toMatchObject({ deleted: true, projectRevision: 5 }));

    await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes/${sceneId}/hotspots`)
      .set(auth)
      .send({
        projectRevision: 5,
        geometry: { kind: 'point' },
        position: { longitudeDegrees: 10, latitudeDegrees: 5 },
        action: { kind: 'openUrl', url: 'javascript:alert(1)' }
      })
      .expect(422)
      .expect(({ body }) => expect(body.error).toMatchObject({
        code: 'URL_SCHEME_NOT_ALLOWED',
        path: 'action.url'
      }));

    const hotspotResponse = await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes/${sceneId}/hotspots`)
      .set(auth)
      .send({
        projectRevision: 5,
        geometry: { kind: 'point' },
        position: { longitudeDegrees: 10, latitudeDegrees: 5 },
        content: {
          title: '<img src=x onerror=alert(1)>Information',
          bodyHtml: '<p onclick="steal()">Safe body</p><script>alert(1)</script>',
          externalUrl: 'https://EXAMPLE.com/details'
        },
        action: { kind: 'openUrl', url: 'https://EXAMPLE.com/open' }
      })
      .expect(201);
    const hotspotId = hotspotResponse.body.data.hotspot.id as string;
    expect(hotspotResponse.body.data).toMatchObject({
      projectRevision: 6,
      hotspot: {
        id: hotspotId,
        geometry: { kind: 'point' },
        content: {
          title: 'Information',
          bodyHtml: '<p>Safe body</p>',
          externalUrl: 'https://example.com/details'
        },
        action: { kind: 'openUrl', url: 'https://example.com/open' }
      }
    });

    const patchedHotspot = await request(context.app)
      .patch(`/api/v1/projects/${projectId}/scenes/${sceneId}/hotspots/${hotspotId}`)
      .set(auth)
      .send({
        projectRevision: 6,
        position: { longitudeDegrees: -20, latitudeDegrees: 12 },
        content: { title: 'Patched' }
      })
      .expect(200);
    expect(patchedHotspot.body.data).toMatchObject({
      projectRevision: 7,
      hotspot: { position: { longitudeDegrees: -20, latitudeDegrees: 12 }, content: { title: 'Patched' } }
    });

    await request(context.app)
      .delete(`/api/v1/projects/${projectId}/scenes/${sceneId}/hotspots/${hotspotId}`)
      .set(auth)
      .send({ projectRevision: 7 })
      .expect(200)
      .expect(({ body }) => expect(body.data).toMatchObject({ deleted: true, projectRevision: 8 }));

    const finalHotspot = await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes/${sceneId}/hotspots`)
      .set(auth)
      .send({
        projectRevision: 8,
        geometry: { kind: 'point' },
        position: { longitudeDegrees: 0, latitudeDegrees: 0 },
        appearance: { label: '<img src=x onerror=steal()>Enter' },
        content: { title: 'Welcome', bodyHtml: '<strong>Enter</strong>' },
        action: { kind: 'showInformation' }
      })
      .expect(201);
    expect(finalHotspot.body.data).toMatchObject({
      projectRevision: 9,
      hotspot: { appearance: { label: 'Enter' } }
    });

    const sceneRead = await request(context.app)
      .get(`/api/v1/projects/${projectId}/scenes/${sceneId}`)
      .set(auth)
      .expect(200);
    expect(sceneRead.body.data.scene).toMatchObject({ name: 'Updated Main Scene' });
    expect(sceneRead.body.data.scene.hotspots).toHaveLength(1);

    const validation = await request(context.app)
      .post(`/api/v1/projects/${projectId}/validate`)
      .set(auth)
      .send({ revision: 9 })
      .expect(200);
    expect(validation.body.data).toMatchObject({ valid: true, issues: [] });

    const preview = await request(context.app)
      .post(`/api/v1/projects/${projectId}/preview-manifest`)
      .set(auth)
      .send({ revision: 9 })
      .expect(200);
    expect(preview.body.data.manifest).toMatchObject({
      experienceId: projectId,
      projectRevision: 9,
      publicationRevision: null,
      target: 'preview',
      scenes: [{ id: sceneId, panorama: { assetId, primary: { access: 'protected' } } }]
    });
    expect(JSON.stringify(preview.body.data.manifest)).not.toContain('<script');

    const publishKey = `publish-${randomUUID()}`;
    const publicPublication = await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(auth)
      .set('Idempotency-Key', publishKey)
      .send({ revision: 9, slug: 'public-panorama', visibility: 'public' })
      .expect(201)
      .expect('Idempotency-Replayed', 'false');
    const publicPublicationId = publicPublication.body.data.publication.id as string;
    expect(publicPublication.body.data.publication).toMatchObject({
      id: publicPublicationId,
      publicationRevision: 1,
      slug: 'public-panorama',
      visibility: 'public',
      isCurrent: true
    });

    const publicReplay = await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(auth)
      .set('Idempotency-Key', publishKey)
      .send({ revision: 9, slug: 'public-panorama', visibility: 'public' })
      .expect(201)
      .expect('Idempotency-Replayed', 'true');
    expect(publicReplay.body.data).toEqual(publicPublication.body.data);

    await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(auth)
      .set('Idempotency-Key', publishKey)
      .send({ revision: 9, slug: 'different-request', visibility: 'public' })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('IDEMPOTENCY_KEY_REUSED'));

    const publicManifest = await request(context.app)
      .get('/view/public-panorama/manifest')
      .expect(200)
      .expect('Cache-Control', /public/)
      .expect(({ body }) => expect(body.data).toMatchObject({
        manifest: { experienceId: projectId, publicationRevision: 1, visibility: 'public' },
        publication: { id: publicPublicationId, isCurrent: true }
      }));
    const publicMediaUrl = publicManifest.body.data.manifest.scenes[0].panorama.primary.url as string;
    expect(publicMediaUrl).toBe(`/api/v1/publications/${projectId}/1/media/${standardWeb.id}`);
    await request(context.app)
      .get(publicMediaUrl)
      .expect(200)
      .expect('Content-Type', /image\/jpeg/)
      .expect('Cache-Control', /public/);

    const privatePublication = await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(auth)
      .set('Idempotency-Key', `publish-${randomUUID()}`)
      .send({ revision: 9, slug: 'private-panorama', visibility: 'private' })
      .expect(201);
    const privatePublicationId = privatePublication.body.data.publication.id as string;
    expect(privatePublication.body.data.publication).toMatchObject({
      publicationRevision: 2,
      visibility: 'private',
      isCurrent: true
    });

    await request(context.app).get('/view/public-panorama/manifest').expect(404);
    await request(context.app)
      .get('/view/private-panorama/manifest')
      .expect(401)
      .expect(({ body }) => expect(body.error.code).toBe('PRIVATE_PUBLICATION_ACCESS_DENIED'));
    await request(context.app)
      .get('/view/private-panorama/manifest')
      .set(bearer(other.accessToken))
      .expect(403);
    const privateManifest = await request(context.app)
      .get('/view/private-panorama/manifest')
      .set(auth)
      .expect(200)
      .expect('Cache-Control', /private, no-store/);
    const protectedMediaUrl = privateManifest.body.data.manifest.scenes[0].panorama.primary.url as string;
    expect(protectedMediaUrl).toContain(`/api/v1/media/${standardWeb.id}?token=`);
    await request(context.app)
      .get(protectedMediaUrl)
      .expect(200)
      .expect('Cache-Control', /private, no-store/);

    // The private revision never embeds the old public cache key, and origin
    // authorization revokes the retired public revision.
    await request(context.app).get(publicMediaUrl).expect(403);

    await request(context.app).get(`/api/v1/media/${standardWeb.id}`).expect(403);
    await request(context.app)
      .get(`/api/v1/media/${standardWeb.id}`)
      .set(bearer(other.accessToken))
      .expect(403);
    await request(context.app)
      .get(`/api/v1/media/${standardWeb.id}`)
      .set(auth)
      .expect(200)
      .expect('Cache-Control', /private, no-store/);

    const changed = await request(context.app)
      .patch(`/api/v1/projects/${projectId}`)
      .set(auth)
      .send({ revision: 9, name: 'Broken Next Revision' })
      .expect(200);
    expect(changed.body.data.project.revision).toBe(10);

    const { Asset, Publication, RuntimeEvent } = await import('../../src/models');
    const failedReprocessKey = `reprocess-failure-${randomUUID()}`;
    await request(context.app)
      .post(`/api/v1/assets/${assetId}/reprocess`)
      .set(auth)
      .set('Idempotency-Key', failedReprocessKey)
      .expect(202);
    const expiringJob = await MediaJob.findOne({
      where: { assetId, type: 'reprocess', status: 'queued' },
      order: [['derivativeVersion', 'DESC']]
    });
    expect(expiringJob).not.toBeNull();
    await expiringJob!.update({
      status: 'running',
      attempt: expiringJob!.maxAttempts,
      lockedAt: new Date(Date.now() - 30 * 60 * 1000),
      leaseToken: randomUUID(),
      startedAt: new Date(Date.now() - 31 * 60 * 1000)
    });
    await expect(drainMediaJobs({ maxJobs: 1 })).resolves.toBe(0);
    await expiringJob!.reload();
    expect(expiringJob).toMatchObject({
      status: 'failed',
      derivativeVersion: 2,
      leaseToken: null
    });
    expect(await Asset.findByPk(assetId)).toMatchObject({
      processingStatus: 'failed',
      processingError: expect.objectContaining({ category: 'PROCESSING_TIMEOUT', retryable: false })
    });
    const failedPublishKey = `failed-publish-${randomUUID()}`;
    const failedPublish = await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(auth)
      .set('Idempotency-Key', failedPublishKey)
      .send({ revision: 10, slug: 'broken-panorama', visibility: 'public' })
      .expect(422)
      .expect('Idempotency-Replayed', 'false')
      .expect(({ body }) => expect(body.error.code).toBe('EXPERIENCE_VALIDATION_FAILED'));

    const failedPublishReplay = await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(auth)
      .set('Idempotency-Key', failedPublishKey)
      .send({ revision: 10, slug: 'broken-panorama', visibility: 'public' })
      .expect(422)
      .expect('Idempotency-Replayed', 'true');
    expect(failedPublishReplay.body.error).toMatchObject({
      code: failedPublish.body.error.code,
      message: failedPublish.body.error.message,
      retryable: failedPublish.body.error.retryable,
      details: failedPublish.body.error.details
    });

    expect(await Publication.count({ where: { projectId } })).toBe(3);
    expect(await Publication.findOne({
      where: { projectId, publicationRevision: 3 }
    })).toMatchObject({ status: 'publish_failed', isCurrent: false, slug: 'broken-panorama' });
    const currentPublication = await Publication.findOne({ where: { projectId, isCurrent: true } });
    expect(currentPublication).toMatchObject({
      id: privatePublicationId,
      publicationRevision: 2,
      slug: 'private-panorama',
      status: 'published'
    });
    await request(context.app)
      .get('/view/private-panorama/manifest')
      .set(auth)
      .expect(200)
      .expect(({ body }) => expect(body.data.publication.id).toBe(privatePublicationId));

    const successfulReprocessKey = `reprocess-success-${randomUUID()}`;
    const successfulReprocess = await request(context.app)
      .post(`/api/v1/assets/${assetId}/reprocess`)
      .set(auth)
      .set('Idempotency-Key', successfulReprocessKey)
      .expect(202)
      .expect('Idempotency-Replayed', 'false');
    await request(context.app)
      .post(`/api/v1/assets/${assetId}/reprocess`)
      .set(auth)
      .set('Idempotency-Key', successfulReprocessKey)
      .expect(202)
      .expect('Idempotency-Replayed', 'true')
      .expect(({ body }) => expect(body.data).toEqual(successfulReprocess.body.data));
    await expect(drainMediaJobs({ maxJobs: 1 })).resolves.toBe(1);
    const recoveredAsset = await request(context.app)
      .get(`/api/v1/assets/${assetId}`)
      .set(auth)
      .expect(200);
    expect(recoveredAsset.body.data.asset).toMatchObject({ processingStatus: 'ready' });
    expect(recoveredAsset.body.data.asset.derivatives).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'standardWeb', version: 3 })
    ]));
    expect(await MediaJob.findOne({
      where: { assetId, derivativeVersion: 3 }
    })).toMatchObject({ status: 'succeeded', leaseToken: null });

    const eventId = randomUUID();
    const telemetryEvent = {
      eventId,
      eventName: 'first_panorama_visible',
      experienceId: projectId,
      publicationRevision: 2,
      viewerIntegrationVersion: 'psv-5.14.3-adapter-1',
      sessionId: 'session-12345678',
      deviceContext: { platform: 'integration-test' },
      payload: { elapsedMs: 123 },
      occurredAt: new Date().toISOString()
    };
    await request(context.app)
      .post('/api/v1/runtime/events')
      .send({ ...telemetryEvent, eventId: randomUUID(), viewerIntegrationVersion: 'wrong-adapter' })
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('VIEWER_INTEGRATION_VERSION_MISMATCH'));
    await request(context.app)
      .post('/api/v1/runtime/events')
      .send(telemetryEvent)
      .expect(202)
      .expect(({ body }) => expect(body.data).toEqual({ accepted: 1, duplicates: 0 }));
    await request(context.app)
      .post('/api/v1/runtime/events')
      .send({ events: [telemetryEvent] })
      .expect(202)
      .expect(({ body }) => expect(body.data).toEqual({ accepted: 0, duplicates: 1 }));
    expect(await RuntimeEvent.count({ where: { eventId } })).toBe(1);

    const sameBatchEvent = { ...telemetryEvent, eventId: randomUUID(), eventName: 'experience_exited' };
    await request(context.app)
      .post('/api/v1/runtime/events')
      .send({ events: [sameBatchEvent, sameBatchEvent] })
      .expect(202)
      .expect(({ body }) => expect(body.data).toEqual({ accepted: 1, duplicates: 1 }));
    expect(await RuntimeEvent.count({ where: { eventId: sameBatchEvent.eventId } })).toBe(1);

    const concurrentEvent = {
      ...telemetryEvent,
      eventId: randomUUID(),
      eventName: 'hotspot_clicked'
    };
    const concurrentResponses = await Promise.all([
      request(context.app).post('/api/v1/runtime/events').send(concurrentEvent).expect(202),
      request(context.app).post('/api/v1/runtime/events').send(concurrentEvent).expect(202)
    ]);
    expect(concurrentResponses.reduce(
      (total, response) => total + Number(response.body.data.accepted),
      0
    )).toBe(1);
    expect(concurrentResponses.reduce(
      (total, response) => total + Number(response.body.data.duplicates),
      0
    )).toBe(1);
    expect(await RuntimeEvent.count({ where: { eventId: concurrentEvent.eventId } })).toBe(1);
  }, 60_000);

  it('applies the production migration constraints on real PostgreSQL', async ({ skip }) => {
    if (context.databaseKind !== 'postgres') {
      skip('The pg-mem fallback intentionally uses model sync instead of production migrations.');
    }
    const [tables] = await context.database.sequelize.query(
      "SELECT table_name AS \"tableName\" FROM information_schema.tables WHERE table_schema = 'public'"
    );
    const names = new Set((tables as Array<{ tableName: string }>).map((row) => row.tableName));
    expect([...names]).toEqual(expect.arrayContaining([
      'users',
      'projects',
      'assets',
      'scenes',
      'hotspots',
      'publications',
      'runtime_events'
    ]));
  });
});
