# Sphere Backend

Backend for the No-Code 360° Experience Platform. Sprint 01 implements the
renderer-independent 360° image workflow:

authenticate → create project → upload panorama → process derivatives → edit
scenes and point hotspots → preview → publish → share.

Canonical Experience data is stored independently of Photo Sphere Viewer.
Preview and publish pass through the same compiler; only the versioned viewer
integration adapter emits renderer-specific configuration.

## Stack

- Node.js 22 and TypeScript
- Express 5 REST API
- PostgreSQL 17 and Sequelize 6
- Sharp for image inspection and derivatives
- Bearer JWT authentication
- PostgreSQL-backed durable media and storage-cleanup jobs
- Private local filesystem storage for development and the Sprint 01 runtime
- Vitest, Supertest, ESLint, and TypeScript checks

The local storage provider is behind a storage interface. Source files and
derivatives are never exposed through a static directory. Preview and private
publication manifests use short-lived signed logical media URLs; public
publication manifests use revision-scoped media routes that are authorized
against the current publication.

## Prerequisites

- Node.js 22.x
- npm 10 or newer
- PostgreSQL 17, either installed locally or started with Docker Compose

## Quick start

1. Install dependencies and create local configuration.

   ~~~powershell
   npm ci
   Copy-Item .env.example .env
   ~~~

2. Start PostgreSQL. Skip this command when using an existing database matching
   <code>DATABASE_URL</code>.

   ~~~powershell
   docker compose up -d postgres
   ~~~

3. Apply migrations from TypeScript and start the development API.

   ~~~powershell
   npm run db:migrate:dev
   npm run dev
   ~~~

The production migration commands execute compiled files in <code>dist/</code>.
Run <code>npm run build</code> before <code>npm run db:migrate</code> in a
release workflow; CI uses that order.

The default API listens on <code>http://localhost:4000</code>. Readiness and
liveness checks are available at:

- <code>GET /health/live</code>
- <code>GET /health/ready</code>

## Media worker

<code>MEDIA_WORKER_MODE</code> controls how durable database jobs are consumed:

- <code>embedded</code> (default): the API process also polls and executes media
  jobs. This is convenient for local development and a single-process deployment.
- <code>external</code>: the API only enqueues jobs. Run a separately supervised
  worker with <code>npm run dev:worker</code> in development or
  <code>npm run worker</code> after building.
- <code>disabled</code>: enqueueing remains available but no worker runs. Use
  only for controlled diagnostics or tests.

The worker transitions assets through
<code>uploaded → inspecting → processing → ready | failed</code>. Jobs and
derivative identities are durable and retry-safe; restarting the API or worker
does not discard queued work. A per-claim lease token prevents a stale worker
from finalizing a job after another worker has recovered it, and the database
permits at most one queued/running job for an asset.

Logical asset deletion transactionally enqueues every original/derivative key
in a durable cleanup outbox before removing catalog rows. The same worker
retries idempotent physical deletion, so a temporary storage outage cannot turn
a committed delete into an unrecoverable orphan.

## Authentication and request conventions

Register or sign in through <code>/api/v1/auth</code>, then send the access token
on protected routes:

~~~http
Authorization: Bearer ACCESS_TOKEN
~~~

Project and editor mutations use optimistic concurrency. Send the last revision
read from the API as <code>revision</code> for project-level operations or
<code>projectRevision</code> for scene/hotspot operations. A stale value returns
<code>409 REVISION_CONFLICT</code> and does not overwrite newer work.

Upload completion, reprocessing, and publishing require a caller-generated
<code>Idempotency-Key</code> header. Repeating the same operation with the same
key and payload returns the original outcome without duplicating side effects.

## Image upload flow

The API uses an upload-session protocol instead of multipart form data.

1. <code>POST /api/v1/assets/uploads</code> with <code>mediaType</code>, filename,
   MIME type, byte size, optional project ID, and optional SHA-256 checksum.
   <code>mediaType</code> accepts <code>panorama_image</code>, <code>image</code>,
   or <code>logo</code> and defaults to <code>panorama_image</code>.
2. Send the original bytes to the returned local target:
   <code>PUT /api/v1/assets/uploads/:uploadSessionId/content</code>. The request
   body is the raw image and must use the declared <code>Content-Type</code>.
3. Call <code>POST /api/v1/assets/:assetId/complete</code> with
   <code>{ "uploadSessionId": "..." }</code> and an
   <code>Idempotency-Key</code>.
4. Poll <code>GET /api/v1/assets/:assetId</code> until
   <code>processingStatus</code> is <code>ready</code> or <code>failed</code>.

Filename extensions are not trusted. The raw PUT validates byte count, optional
checksum, file signature/MIME policy, and extension consistency. Asynchronous
inspection then validates decodability, orientation-aware dimensions, and the
configured pixel limit. Panorama assets additionally require supported
equirectangular geometry and valid GPano/XMP crop metadata. All three media
types receive the baseline image derivatives used by the compiler.

## Commands

| Command | Purpose |
| --- | --- |
| <code>npm run dev</code> | Run the API with TypeScript watch mode. |
| <code>npm run dev:worker</code> | Run an external worker with TypeScript watch mode. |
| <code>npm run build</code> | Compile production JavaScript to <code>dist/</code>. |
| <code>npm start</code> | Run the compiled API. |
| <code>npm run worker</code> | Run the compiled external media worker. |
| <code>npm run db:migrate</code> | Apply migrations from compiled <code>dist/</code>; run <code>npm run build</code> first. |
| <code>npm run db:migrate:undo</code> | Revert the most recent migration from compiled <code>dist/</code>. |
| <code>npm run db:migrate:dev</code> | Apply migrations directly from TypeScript during development. |
| <code>npm run db:migrate:undo:dev</code> | Revert the most recent migration directly from TypeScript. |
| <code>npm run lint</code> | Run ESLint. |
| <code>npm run typecheck</code> | Type-check without emitting files. |
| <code>npm test</code> | Run all Vitest tests once. |
| <code>npm run test:unit</code> | Run unit tests. |
| <code>npm run test:integration</code> | Run API/database integration tests. |
| <code>npm run test:security</code> | Run security-focused tests. |
| <code>npm run test:coverage</code> | Run tests with V8 coverage. |
| <code>npm run test:all</code> | Run lint, typecheck, tests, and build. |

Integration tests must use a dedicated PostgreSQL test database. Do not point
test or migration-undo commands at a database containing valuable data.

## API response shape

Successful JSON responses use:

~~~json
{
  "success": true,
  "data": {},
  "message": "Request completed."
}
~~~

<code>message</code> is present when an operation has a useful acknowledgement.
Every response echoes its correlation value in the <code>X-Request-ID</code>
header; error envelopes also include it in JSON.

Errors use a stable, client-safe envelope:

~~~json
{
  "error": {
    "code": "ASSET_NOT_READY",
    "message": "The panorama is still processing.",
    "entityId": "...",
    "path": "scenes[0].panoramaAssetId",
    "retryable": true,
    "details": {},
    "requestId": "..."
  }
}
~~~

Internal stack traces, database details, and storage keys are not returned.

## Documentation

- [API contract](docs/backend-api.md)
- [Canonical and persistence schema](docs/backend-schema.md)
- [Operations runbook](docs/runbook.md)
- [Product requirements](docs/prd.md)
- [Product architecture](docs/product_architecture.md)
- [Backend TRD](docs/trd.md)
- [Sprint 01 execution plan](docs/sprint/sprint-01-backend-foundation-image-mvp.md)

## Sprint 01 boundaries

Sprint 01 creates <code>image360</code> projects, generates thumbnail,
low-resolution-base, and standard-web image derivatives, and supports canonical
point hotspots. Multi-scene storage is already supported, but tour authoring,
360° video processing, tiled panoramas, map/plan, immersive modes, advanced
geometry authoring, and creator analytics dashboards belong to later sprints.

MVP operational assumptions are explicit: private manifests are owner-only,
their media references are short-lived signed URLs, publication visibility is
public/private, upload targets are served by this API, and the local storage
directory is durable and shared with any external worker. Public derivative
URLs include the project and publication revision; once that publication is
retired or replaced by a private one, the origin denies the old URL. The public
media cache lifetime is bounded to 60 seconds. Multi-host deployments must
replace the local provider with shared private object storage behind the
existing storage interface.

The generated <code>/view/:slug</code> direct/embed/QR target belongs to the
frontend player shell or deployment reverse proxy. This backend exposes the
shell's bootstrap JSON at <code>/view/:slug/manifest</code>; a backend-only local
run does not render the player page.
