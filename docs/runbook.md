# Backend Operations Runbook

This runbook covers development, deployment, migrations, the durable media
worker, private local storage, health/observability, verification, and common
Sprint 01 incidents.

## Deployment shape

The backend has three durable components:

1. The Express API.
2. PostgreSQL, which stores canonical data, publications, idempotency records,
   telemetry, and the durable media-job queue.
3. Private file storage rooted at <code>STORAGE_ROOT</code>, which stores
   immutable originals, derivatives, and metadata sidecars.

The media worker can run inside the API process or as a separate process. Both
modes claim the same PostgreSQL-backed jobs.

Local filesystem storage is suitable for local development and a durable
single-host deployment. It is not a shared multi-host object store. When the API
and external worker run separately, they must see the same durable
<code>STORAGE_ROOT</code> volume. Do not deploy it on ephemeral/serverless
filesystems. Horizontal or serverless production deployment requires another
implementation of the storage-provider interface backed by shared object
storage; canonical asset IDs and database records do not need to change.

## First-time local setup

~~~powershell
npm ci
Copy-Item .env.example .env
docker compose up -d postgres
npm run db:migrate:dev
npm run dev
~~~

Use an existing PostgreSQL instance instead of Docker when preferred; update
<code>DATABASE_URL</code> first.

The backend-only development server exposes manifest JSON but not the player UI.
To exercise direct/embed/QR targets locally, run or proxy a frontend runtime
shell at <code>/view/:slug</code> and configure <code>PUBLIC_BASE_URL</code> to
that externally reachable origin.

Verify:

~~~powershell
Invoke-RestMethod http://localhost:4000/health/live
Invoke-RestMethod http://localhost:4000/health/ready
~~~

## Environment variables

The following inventory mirrors <code>.env.example</code>.

| Variable | Example/default | Purpose and operational notes |
| --- | --- | --- |
| <code>NODE_ENV</code> | <code>development</code> | <code>development</code>, <code>test</code>, or <code>production</code>. |
| <code>PORT</code> | <code>4000</code> | API listen port. |
| <code>DATABASE_URL</code> | <code>postgres://sphere:sphere@127.0.0.1:5432/sphere</code> | PostgreSQL connection string. Treat credentials as secret. |
| <code>JWT_SECRET</code> | replacement placeholder | HMAC secret for access tokens; minimum 32 characters. Use a secret manager in production. |
| <code>JWT_EXPIRES_IN</code> | <code>1h</code> | Access-token lifetime accepted by the JWT library. |
| <code>PUBLIC_BASE_URL</code> | <code>http://localhost:4000</code> | Externally routed platform/player origin used for share targets. Production routing must provide the frontend shell at <code>/view/:slug</code> and route its manifest request to this backend. No trailing slash is required. |
| <code>CORS_ORIGINS</code> | <code>http://localhost:3000</code> | Comma-separated allowed creator/editor origins. Do not use a wildcard with credentials. |
| <code>STORAGE_ROOT</code> | <code>./storage</code> | Durable private storage directory. Mount and back up this path in production. |
| <code>MAX_IMAGE_UPLOAD_BYTES</code> | <code>52428800</code> | Maximum original image bytes; default 50 MiB. |
| <code>MAX_IMAGE_PIXELS</code> | <code>80000000</code> | Sharp input-pixel ceiling protecting against decompression bombs; default 80 million pixels. |
| <code>MAX_VIDEO_UPLOAD_BYTES</code> | <code>1073741824</code> | Maximum original 360 video bytes; default 1 GiB. Raise deliberately: uploads are buffered in memory during validation and inspection. |
| <code>MAX_VIDEO_DURATION_MS</code> | <code>1800000</code> | Rejects over-long sources during inspection; default 30 minutes. |
| <code>MAX_VIDEO_DERIVATIVE_BYTES</code> | <code>1073741824</code> | Ceiling on a single generated playback derivative. |
| <code>VIDEO_TRANSCODER</code> | <code>auto</code> | <code>auto</code>, <code>ffmpeg</code>, or <code>compatibility</code>. See "Video transcoding" below. |
| <code>FFMPEG_PATH</code> | unset | Absolute path to an <code>ffmpeg</code> binary. Required when <code>VIDEO_TRANSCODER=ffmpeg</code>. |
| <code>VIDEO_TRANSCODE_TIMEOUT_MS</code> | <code>600000</code> | Per-invocation encoder timeout. |
| <code>VIDEO_POSTER_PLACEHOLDER_ENABLED</code> | <code>true</code> | Allows a clearly labelled placeholder poster when no encoder can extract a frame. Set false to require a real frame. |
| <code>VIDEO_POSTER_TIME_MS</code> | <code>1000</code> | Timestamp used for poster frame extraction. |
| <code>VIDEO_DESKTOP_MAX_WIDTH</code> | <code>8192</code> | Desktop playback profile width ceiling. |
| <code>VIDEO_DESKTOP_MAX_FRAME_RATE</code> | <code>60</code> | Desktop playback profile frame-rate ceiling. |
| <code>VIDEO_DESKTOP_TARGET_BITRATE</code> | <code>16000000</code> | Desktop playback profile target bitrate. |
| <code>VIDEO_MOBILE_MAX_WIDTH</code> | <code>4096</code> | Handheld profile width ceiling. The renderer documents 4096 as the handheld limit for 360 video; the platform clamps this value to that ceiling. |
| <code>VIDEO_MOBILE_MAX_FRAME_RATE</code> | <code>30</code> | Handheld profile frame-rate ceiling. |
| <code>VIDEO_MOBILE_TARGET_BITRATE</code> | <code>6000000</code> | Handheld profile target bitrate. |
| <code>VIDEO_AUDIO_BITRATE</code> | <code>128000</code> | Audio bitrate for generated playback profiles. |
| <code>VIDEO_CODEC</code> | <code>h264</code> | Encoder video codec passed to the transcoder integration. |
| <code>VIDEO_AUDIO_CODEC</code> | <code>aac</code> | Encoder audio codec passed to the transcoder integration. |
| <code>UPLOAD_SESSION_TTL_SECONDS</code> | <code>3600</code> | Time allowed to PUT an upload before session expiry. |
| <code>SIGNED_MEDIA_TTL_SECONDS</code> | <code>900</code> | Lifetime of signed preview/private-publication derivative URLs. |
| <code>TELEMETRY_TOKEN_TTL_SECONDS</code> | <code>21600</code> | Lifetime of the runtime-telemetry ingest token issued with a published manifest. Must outlast a viewing session, since <code>experience_exited</code> is reported against the token served at load. |
| <code>MEDIA_WORKER_MODE</code> | <code>embedded</code> | <code>embedded</code>, <code>external</code>, or <code>disabled</code>. |
| <code>MEDIA_WORKER_POLL_MS</code> | <code>1000</code> | Delay between durable queue polls when no immediate job is available. |
| <code>MEDIA_JOB_LEASE_SECONDS</code> | <code>900</code> | Running-job lease; stale work is recovered after this interval. |
| <code>LOG_LEVEL</code> | <code>info</code> | Pino level: fatal, error, warn, info, debug, trace, or silent. |
| <code>TRUST_PROXY</code> | <code>false</code> | Set true only behind a trusted proxy that correctly replaces forwarding headers. |
| <code>AUTO_MIGRATE</code> | <code>false</code> | Runs pending migrations at process startup when true. Keep false in production and migrate as a controlled release step. |
| <code>VIEWER_INTEGRATION_VERSION</code> | <code>psv-5.14.3-adapter-1</code> | Pinned compiler/renderer adapter identity embedded in manifests and telemetry. |

Configuration is validated at startup. The process fails fast on malformed
values or any shipped/development JWT placeholder in production.

## Secrets

- Never commit <code>.env</code>.
- Supply <code>DATABASE_URL</code> and <code>JWT_SECRET</code> through the
  deployment secret manager.
- Restrict database credentials to the application database.
- Restrict filesystem permissions on <code>STORAGE_ROOT</code> to the service
  account.
- Rotating <code>JWT_SECRET</code> invalidates existing access tokens. Schedule
  rotation and expect creators/private viewers to sign in again.

## Database migrations

Migrations are ordered, transactional where PostgreSQL permits, and tracked by
Umzug/Sequelize.

### Normal deployment

1. Back up the database.
2. Build and deploy artifacts without starting new replicas, or build a
   dedicated migration artifact. The production migrator is compiled into
   <code>dist/</code>:

   ~~~powershell
   npm run build
   ~~~

3. Apply migrations once from that exact release artifact:

   ~~~powershell
   npm run db:migrate
   ~~~

4. Start/restart API and worker processes.
5. Confirm readiness and inspect startup logs.

Keep <code>AUTO_MIGRATE=false</code> when multiple replicas might start
concurrently. Do not use Sequelize <code>sync</code> as a production migration
mechanism. CI follows the same build-then-migrate order. During local
TypeScript development, <code>npm run db:migrate:dev</code> does not require a
pre-existing <code>dist/</code> directory.

### Development rollback

The following reverts only the most recently applied migration:

~~~powershell
npm run db:migrate:undo:dev
~~~

Use <code>npm run db:migrate:undo</code> only when reverting from a built release
artifact.

Run this only against a disposable development/test database unless an approved
production recovery plan explicitly calls for it. Prefer forward-fix migrations
after a production deployment.

### Migration failure

1. Stop the rollout; do not start code that requires an unapplied schema.
2. Capture the request/process logs and migration error.
3. Inspect the migration tracking table and PostgreSQL transaction state.
4. Restore the pre-migration backup if the failed change escaped its transaction
   and cannot be safely forward-fixed.
5. Correct and test the migration against a fresh database and a representative
   restored copy before retrying.

## API process

Development:

~~~powershell
npm run dev
~~~

Production:

~~~powershell
npm run build
npm start
~~~

Send SIGTERM or the platform's normal stop signal and allow the process grace
time to stop accepting requests and close database/worker resources. Do not
force-kill during an active publish or migration unless required for safety;
idempotency permits callers to retry ambiguous mutations.

### Health probes

- <code>/health/live</code> indicates process liveness.
- <code>/health/ready</code> verifies PostgreSQL authentication, required
  migration metadata/base schema, and read/write access to
  <code>STORAGE_ROOT</code>.

Use liveness only to restart a wedged process. Use readiness to remove an
instance from service during dependency failure or startup.

## Media worker

### Embedded mode

~~~dotenv
MEDIA_WORKER_MODE=embedded
~~~

Starting the API also starts a worker loop. This is the simplest one-process
topology. API restarts briefly pause processing, but queued jobs remain durable.

### External mode

~~~dotenv
MEDIA_WORKER_MODE=external
~~~

Start the API and a separately supervised worker:

~~~powershell
npm run dev
npm run dev:worker
~~~

For compiled production artifacts:

~~~powershell
npm start
npm run worker
~~~

Both processes require the same <code>DATABASE_URL</code>, configuration policy,
and storage volume. Scale external workers only after confirming database claim
locking and storage throughput under representative panorama sizes.

The worker consumes both media-processing jobs and the durable
<code>storage_deletion_jobs</code> outbox. Storage cleanup uses the same lease
duration, per-claim token fencing, expired-claim recovery, and idempotent
redelivery principles as media processing.

### Worker lease recovery

Workers claim queued rows with PostgreSQL row locking and assign a new UUID
<code>lease_token</code>. Heartbeats and final status writes compare that token,
so a stale worker cannot finish a claim after another worker has recovered it.
The database also enforces at most one <code>queued</code> or
<code>running</code> job per asset and a unique asset/derivative-version pair.
A running row whose <code>locked_at</code> heartbeat is older than
<code>MEDIA_JOB_LEASE_SECONDS</code> is considered abandoned and is
automatically returned to the queue during the next poll. The default lease is
900 seconds. The worker refreshes the heartbeat after inspection and while
persisting derivatives. A recovered job records a retryable
<code>PROCESSING_TIMEOUT</code> diagnostic. Derivative storage keys and catalog
uniqueness make replay safe after a process crash.

If the expired job has already exhausted <code>max_attempts</code>, recovery
atomically marks the job and its non-ready asset failed instead of requeueing
it. A fresh reprocess request is then required.

Monitor representative media-processing duration. Normal jobs should finish
comfortably inside the lease; investigate CPU, memory, or storage I/O when jobs
approach it before increasing worker concurrency or input limits.

### Disabled mode

<code>MEDIA_WORKER_MODE=disabled</code> prevents job consumption. Completed
uploads remain queued/non-ready. Use this only for targeted diagnostics,
migration jobs, or tests that drive the worker explicitly.

### Queue inspection

Use read-only queries first:

~~~sql
SELECT status, stage, count(*) AS jobs
FROM media_jobs
GROUP BY status, stage
ORDER BY status, stage;

SELECT id, asset_id, type, stage, status, attempt, max_attempts,
       derivative_version, available_at, locked_at, lease_token, updated_at
FROM media_jobs
WHERE status IN ('queued', 'running', 'failed')
ORDER BY updated_at ASC
LIMIT 100;

SELECT id, asset_id, status, attempt, available_at, locked_at,
       lease_token, completed_at, updated_at
FROM storage_deletion_jobs
WHERE status IN ('queued', 'running')
ORDER BY updated_at ASC
LIMIT 100;
~~~

Do not manually mark a job successful or an asset ready. Successful status
requires a complete, persisted derivative catalog. Prefer normal retry/reprocess
paths so state-machine and idempotency rules remain intact.

## Video transcoding

Video metadata inspection is built in and needs no external binary: the platform
reads MP4/WebM container structure directly for dimensions, duration, frame
rate, codecs, audio presence, rotation and 360 projection markers.

Producing playback derivatives is delegated to a transcoder integration selected
by <code>VIDEO_TRANSCODER</code>:

| Mode | Behavior |
| --- | --- |
| <code>ffmpeg</code> | Uses <code>FFMPEG_PATH</code> to re-encode profiles and extract poster frames. |
| <code>compatibility</code> | Emits a profile only when the inspected source provably satisfies every constraint of that profile, and generates a labelled placeholder poster. |
| <code>auto</code> (default) | Uses ffmpeg when <code>FFMPEG_PATH</code> resolves to an existing file, otherwise the compatibility provider. |

The compatibility provider never publishes an oversized original as a handheld
profile. If a source needs a genuine re-encode, that profile is reported as
unavailable with an actionable reason rather than being silently substituted.
A deployment that ingests sources wider than
<code>VIDEO_MOBILE_MAX_WIDTH</code> should configure ffmpeg; otherwise handheld
visitors of those experiences will have no compatible profile.

Operational signals to watch:

- <code>media_job_stages</code> rows with <code>status = 'failed'</code> and a
  <code>derivative_kind</code> of <code>mobileVideoProfile</code> indicate
  handheld delivery gaps.
- The <code>video_profile_selected</code> and
  <code>video_playback_failed</code> runtime events show what visitors actually
  received and where playback broke, keyed by publication revision and viewer
  integration version.

## Private local storage

<code>STORAGE_ROOT</code> contains immutable originals, versioned derivatives,
and small metadata sidecars. It must:

- live outside any statically served web directory;
- be writable only by the service account;
- be durable across API/worker restarts and deployments;
- be shared by API and external worker processes;
- have sufficient free space for originals plus multiple derivative versions;
- be backed up consistently with database metadata.

Never expose the directory through a generic file server. Runtime access goes
through short-lived signed logical routes for preview/private manifests or
project/publication-revision-scoped routes for a current public manifest.
Storage keys are backend-generated and path traversal checked.

### Backup and restore

Database rows and stored files form one logical asset catalog. Back up both with
compatible retention:

1. Quiesce destructive maintenance and record a backup timestamp.
2. Take a PostgreSQL backup.
3. Snapshot/copy the durable storage volume.
4. Record application, schema, manifest, and viewer-integration versions.
5. Regularly test restoration into an isolated environment.

On restore, apply only migrations appropriate to the restored application
version. Verify several source objects, derivative checksums, private authorized
access, and current publication manifests before reopening traffic.

## Structured logging and correlation

Pino emits structured request/application logs. Use the
<code>X-Request-ID</code> response header (also present as
<code>requestId</code> in error envelopes) to find the matching request. Logs
should include safe identities and categories where useful:

- request ID, method, route, status, latency;
- authenticated user/project/asset IDs;
- media job ID, stage, attempt, and stable failure category;
- publication and project revisions;
- manifest and viewer integration versions;
- database, storage, compiler, and authorization failure categories.

Never log bearer tokens, passwords, JWT secrets, full private URLs, or image
bytes. Avoid logging unrestricted authored HTML or telemetry payloads.

## Verification

### Fast pre-commit gate

~~~powershell
npm run lint
npm run typecheck
npm test
npm run build
~~~

Equivalent aggregate command:

~~~powershell
npm run test:all
~~~

### Complete release gate

Use a dedicated PostgreSQL database whose name clearly identifies it as test
data. Never point this sequence at production.

~~~powershell
$env:NODE_ENV = 'test'
$env:DATABASE_URL = 'postgres://sphere:sphere@127.0.0.1:5432/sphere_test'
$env:JWT_SECRET = 'test-only-secret-at-least-32-characters'
npm run build
npm run db:migrate
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:security
npm run test:coverage
~~~

This matches CI's build-then-migrate order. Substitute
<code>npm run db:migrate:dev</code> only when explicitly testing the TypeScript
migrator locally.

Required integration coverage includes real PostgreSQL migration compatibility,
authorization/ownership, revision conflicts, duplicate idempotent delivery,
durable job retry, media fixtures, compiler determinism, failed-republish
preservation, private access, and runtime-event deduplication.

## Incident playbooks

### Readiness fails or PostgreSQL is unavailable

1. Check <code>/health/live</code>. If it passes while readiness fails, keep the
   process running and investigate the dependency before restarting repeatedly.
2. Verify network/DNS, PostgreSQL service health, credentials, connection limits,
   disk space, and active migrations.
3. Confirm the required migration exists in <code>SequelizeMeta</code>, the base
   tables exist, and <code>STORAGE_ROOT</code> can be created, read, and written
   by the service account.
4. Inspect structured logs for connection/storage errors by time and instance.
5. Restore dependencies, then verify readiness and a safe authenticated read.
6. Media jobs remain in PostgreSQL and resume after connectivity returns.

### Media queue grows

1. Run the queue-inspection queries above.
2. Confirm at least one worker is running in embedded or external mode.
3. Confirm the worker and API use the same database and storage root.
4. Inspect oldest job stage/error and host CPU, memory, filesystem space, and I/O.
5. Restart a failed worker normally; queued work is durable.
6. Allow the next poll to recover a running job only after its configured worker
   lease has expired; do not manually duplicate it.
7. Scale external workers cautiously if work is valid and infrastructure is
   healthy.

### A video playback profile is unavailable

1. Read <code>GET /api/v1/assets/:assetId</code> and inspect
   <code>processingStages</code> and
   <code>metadata.unavailablePlaybackProfiles</code>.
2. A failed <code>transcodeMobile</code> stage whose reason mentions resizing
   means the source exceeds the handheld ceiling and the deployment has no
   re-encoding transcoder. Configure <code>FFMPEG_PATH</code>.
3. Regenerate only the affected profile:
   <code>POST /api/v1/assets/:assetId/reprocess</code> with
   <code>{ "profiles": ["mobile"] }</code> and an <code>Idempotency-Key</code>.
   This writes a new derivative version for that profile alone; the logical
   asset ID and the other profiles are unchanged, so published experiences keep
   working throughout.
4. Republish the experience to move published manifests onto the new profile.
5. If <code>finalize</code> failed with <code>VIDEO_PROFILE_UNAVAILABLE</code>,
   no publishable profile exists at all and the asset is <code>failed</code>;
   fix the transcoder configuration, then reprocess the whole asset.

### Asset is stuck or failed

1. Read the owner-visible asset state and correlate its asset/job IDs in logs.
2. Confirm the source object exists and its byte size/checksum match metadata.
3. Identify the stable failure category: upload validation, decode, dimensions,
   XMP, processing, storage, or database.
4. Correct the underlying infrastructure/policy issue.
5. Invoke the authenticated reprocess endpoint with a new
   <code>Idempotency-Key</code>. The asset ID remains unchanged.
6. Do not directly set <code>processing_status='ready'</code>.

### Storage volume is low or unavailable

1. Stop accepting new uploads if continued writes risk corruption.
2. Verify mount presence, ownership, permissions, free bytes, inode/file count,
   and I/O errors.
3. Preserve immutable originals and all derivatives referenced by current
   publications.
4. Expand/restore the volume or move data with a verified storage-provider
   migration.
5. Inspect <code>storage_deletion_jobs</code>. Queued cleanup automatically
   retries with capped backoff after storage recovers; do not delete its rows
   while their status is queued or running.
6. Reprocess missing non-current derivatives only after catalog reconciliation.

Do not delete files by age alone; database references and immutable publications
are the source of retention truth.

### Publish fails

1. Confirm the previous successful slug still resolves; failed publish must not
   change the current pointer.
2. Use the request ID, project revision, and publication attempt to inspect logs.
3. Run the project validation endpoint for entity/path-specific findings.
4. Resolve non-ready assets, broken references, invalid URLs/content, slug
   conflicts, storage, or database failures.
5. If the response was lost or ambiguous, retry the unchanged request with its
   original idempotency key. A recorded compiler failure replays the same safe
   error and does not add another <code>publish_failed</code> row.
6. After correcting the draft or intentionally retrying a known failure, use a
   new idempotency key for the new publish intent.
7. Never repair a failure by overwriting the previous compiled manifest.

### Private manifest or logical media unexpectedly fails

1. For a private manifest, confirm a valid owner bearer token is present.
2. For private/preview derivative media, inspect whether the signed
   <code>token</code> query parameter is present, bound to the requested
   derivative, and still within <code>SIGNED_MEDIA_TTL_SECONDS</code>. An owner
   bearer token is the alternative authorization path.
3. For unauthenticated public media, verify the URL contains the exact project
   ID and publication revision and that the derivative is referenced by the
   current public manifest. Retired or private publications do not grant access.
4. Verify <code>JWT_SECRET</code> is consistent across API replicas and was not
   unexpectedly rotated; rotation invalidates both access and media tokens.
5. Confirm proxies preserve the <code>token</code> query parameter and do not
   cache protected responses, which use <code>private, no-store</code>.

### Retired public media remains visible

1. Request the old revision-scoped URL directly from the origin. It must return
   HTTP 403 once the publication is retired or the current publication is
   private.
2. Check whether the response came from a browser or intermediary cache. Public
   derivative responses are fresh for at most 60 seconds and then must
   revalidate; already-cached bytes cannot be recalled before that window ends.
3. Confirm the public manifest response uses
   <code>public, max-age=0, must-revalidate</code> and the public derivative uses
   <code>public, max-age=60, must-revalidate</code>.
4. Purge the deployment CDN when incident policy requires revocation faster than
   the normal bounded cache interval.

### Suspected private-media exposure

1. Restrict public access to the host/storage volume immediately.
2. Preserve logs and deployment/storage configuration for investigation.
3. Rotate <code>JWT_SECRET</code> if bearer tokens may be compromised.
4. Verify no static mount, reverse-proxy alias, directory listing, or raw storage
   URL bypasses the protected <code>/api/v1/media/:derivativeId</code> or scoped
   public publication-media authorization.
5. Audit media-token validation, manifest visibility, current-publication state,
   and compiler-owned derivative-reference checks.
6. Treat confirmed unauthorized access as a security incident under the
   organization's response process.

## Production checklist

- <code>NODE_ENV=production</code>.
- Unique strong <code>JWT_SECRET</code> from a secret manager.
- TLS terminates at a trusted proxy; <code>TRUST_PROXY</code> matches topology.
- Explicit <code>CORS_ORIGINS</code> and correct <code>PUBLIC_BASE_URL</code>.
- Least-privilege PostgreSQL account, backups, monitoring, and tested restore.
- <code>AUTO_MIGRATE=false</code>; migration is a separate release step.
- Durable, private, capacity-monitored <code>STORAGE_ROOT</code>.
- API and external worker share the same storage when external mode is used.
- API and worker are supervised and shut down gracefully.
- Readiness/liveness probes and structured log collection enabled.
- Upload byte/pixel policy and private-media authorization reviewed.
- Database and storage clocks synchronized.
- Sprint unit, integration, security, migration, and build gates pass.
