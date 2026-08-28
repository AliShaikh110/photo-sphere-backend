# Backend Operations Runbook

This runbook covers development, deployment, migrations, the durable media
worker, private local storage, the live authoring session's push channel,
health/observability, verification, and common incidents.

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
Copy-Item .env.example .env.local
docker compose up -d postgres
npm run db:migrate:dev
npm run dev
~~~

Use an existing PostgreSQL instance instead of Docker when preferred; update
the <code>DB_*</code> settings first.

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
| <code>DB_HOST</code> | <code>127.0.0.1</code> | PostgreSQL host. |
| <code>DB_PORT</code> | <code>5432</code> | PostgreSQL port. |
| <code>DB_NAME</code> | <code>sphere</code> | Application database name. |
| <code>DB_USER</code> | <code>sphere</code> | Application database role. |
| <code>DB_PASSWORD</code> | <code>sphere</code> | Password for that role. Treat as secret. |
| <code>DB_SSL</code> | <code>false</code> | Set to <code>true</code> for a managed host that requires TLS. |
| <code>DATABASE_URL</code> | unset | Optional single-string override. When set it wins over every <code>DB_*</code> setting above; use it only where a host hands out a connection string. |
| <code>JWT_SECRET</code> | replacement placeholder | HMAC secret for access tokens; minimum 32 characters. Use a secret manager in production. |
| <code>JWT_EXPIRES_IN</code> | <code>1h</code> | Access-token lifetime accepted by the JWT library. |
| <code>PUBLIC_BASE_URL</code> | <code>http://localhost:4000</code> | Externally routed platform/player origin used for share targets. Production routing must provide the frontend shell at <code>/view/:slug</code> and route its manifest request to this backend. No trailing slash is required. |
| <code>CORS_ORIGINS</code> | <code>http://localhost:3000</code> | Comma-separated allowed creator/editor origins, and the default for every browser-direct group below. Do not use a wildcard with credentials. |
| <code>EDITOR_ORIGINS</code> | unset | Origins allowed to reach media and the event stream directly. Defaults to <code>CORS_ORIGINS</code>. |
| <code>PLAYER_ORIGINS</code> | unset | Origins allowed to reach media and telemetry directly. Defaults to <code>CORS_ORIGINS</code>. |
| <code>EMBED_ORIGINS</code> | empty | Origins allowed to reach media and telemetry when an experience is embedded. Per-publication embed policy still applies on top of this. |
| <code>EDITOR_SESSION_TTL_SECONDS</code> | <code>900</code> | Lifetime of the short-lived project-scoped editor session token. Keep it short: it is what a browser holds instead of the creator's bearer token. |
| <code>EVENT_STREAM_ENABLED</code> | <code>true</code> | Set to <code>false</code> behind a proxy that blocks streaming; clients fall back to polling with no loss of function. |
| <code>EVENT_STREAM_HEARTBEAT_MS</code> | <code>20000</code> | Interval between keep-alive comments on an open stream. Lower it only for a proxy with a shorter idle timeout. |
| <code>EVENT_STREAM_MAX_PER_PROJECT</code> | <code>20</code> | Open streams allowed for one project. |
| <code>EVENT_STREAM_MAX_PER_USER</code> | <code>8</code> | Open streams allowed for one person, across projects. |
| <code>EVENT_STREAM_REPLAY_BUFFER</code> | <code>200</code> | Events retained per project for <code>Last-Event-ID</code> resume. A longer gap is reported as a gap rather than a partial history. |
| <code>MEDIA_TOKEN_REFRESH_MAX</code> | <code>200</code> | Media references one refresh request may name, and the ceiling on signed URLs shipped in an editor bootstrap. |
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
| <code>VIEWER_INTEGRATION_VERSION</code> | <code>psv-5.14.3-adapter-1</code> | Pinned compiler/renderer adapter identity embedded in manifests and telemetry. A stored rollout overrides it; a value with no registered adapter falls back to the active version. |
| <code>ANALYTICS_MAX_RANGE_DAYS</code> | <code>92</code> | Ceiling on a creator analytics query window. A longer range is refused with <code>DATE_RANGE_TOO_LARGE</code> rather than scanned. |
| <code>PUBLISH_MAX_SCENES</code> | <code>500</code> | Refuses to compile a tour beyond this scene count. |
| <code>PUBLISH_MAX_MANIFEST_BYTES</code> | <code>8388608</code> | Ceiling on a compiled manifest; default 8 MiB. Progressive delivery is what keeps a large tour under it. |
| <code>PUBLISH_MAX_SCENE_DEFINITION_BYTES</code> | <code>2097152</code> | Ceiling on one progressively fetched scene definition; default 2 MiB. |
| <code>DUAL_FISHEYE_INGEST_ENABLED</code> | <code>false</code> | Feature flag for raw camera ingest. Has no effect until a concrete provider is installed; the shipped reference provider declines every source. |
| <code>LIVE_SOURCE_ENABLED</code> | <code>false</code> | Feature flag for live 360 input. Same as above: the shipped reference provider performs the full validation path, then declines. |
| <code>LIVE_SOURCE_ALLOWED_HOSTS</code> | empty | Comma-separated host allowlist for pull-based live sources. An empty list refuses every pull source, which is the safe default: this is the control that prevents server-side request forgery through an operator-supplied stream URL. |

Configuration is validated at startup. The process fails fast on malformed
values or any shipped/development JWT placeholder in production.

## Secrets

- Never commit <code>.env</code> or <code>.env.local</code>.
- Supply <code>DB_PASSWORD</code> and <code>JWT_SECRET</code> through the
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

Both processes require the same <code>DB_*</code> settings, configuration policy,
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

## Viewer integration rollout

Photo Sphere Viewer sits behind a versioned integration adapter. Canonical
project data never contains renderer configuration, so a renderer upgrade is an
adapter rollout, not a customer-data migration.

~~~text
Experience schema
  -> Experience compiler
  -> Viewer integration adapter version X
  -> pinned Photo Sphere Viewer release
~~~

Every publication records the adapter version it compiled with. Changing the
rollout never rewrites an existing revision: an already-published experience
keeps serving the manifest it was compiled into until it is republished.

All routes below require a <code>platform_admin</code> user. The role is read
from the database on every request, so granting or revoking it takes effect
immediately.

### Inspect the current state

~~~powershell
$headers = @{ Authorization = "Bearer $env:SPHERE_ADMIN_TOKEN" }
Invoke-RestMethod -Headers $headers `
  -Uri "$env:SPHERE_BASE_URL/api/v1/platform/viewer-integrations"
~~~

Returns the rollout (<code>activeVersion</code>, <code>candidateVersion</code>,
<code>rolloutPercent</code>) and every adapter version this build can emit, each
with its pinned renderer release and status.

A version that is not in that catalog cannot be rolled out. Attempting it
returns <code>VIEWER_INTEGRATION_NOT_SUPPORTED</code>, which means the build is
older than the version being requested — deploy first, then roll out.

### 1. Run the reference experience suite

The suite compiles every reference experience through a candidate adapter and
checks its expectations. It is the promotion gate.

~~~powershell
Invoke-RestMethod -Method Post -Headers $headers -ContentType 'application/json' `
  -Uri "$env:SPHERE_BASE_URL/api/v1/platform/viewer-integrations/checks" `
  -Body '{"viewerIntegrationVersion":"psv-5.14.3-adapter-2"}'
~~~

The run is recorded in <code>viewer_integration_checks</code> with per-
experience results. Review history with
<code>GET /api/v1/platform/viewer-integrations/checks</code>, optionally
filtered by <code>viewerIntegrationVersion</code>.

The suite covers basic, cropped and high-resolution panoramas, multi-scene and
120-scene tours, gallery, hotspots, map and plan, gyroscope/stereo fallback,
advanced overlay geometry, image and video layers, 360 video with timed
interactions, and a private embed. <code>GET
/api/v1/platform/reference-suite</code> lists them and what each one checks.

A failed run records which experiences failed and why. Do not proceed: a
failing adapter cannot be rolled out, and forcing it is not possible through the
API.

### 2. Start a percentage rollout

~~~powershell
Invoke-RestMethod -Method Put -Headers $headers -ContentType 'application/json' `
  -Uri "$env:SPHERE_BASE_URL/api/v1/platform/viewer-integrations/rollout" `
  -Body '{"candidateVersion":"psv-5.14.3-adapter-2","rolloutPercent":10}'
~~~

Bucketing is deterministic by project ID, so a project stays on one version for
the duration of the rollout rather than alternating between compiles. Only
newly compiled previews and publications are affected.

Without a passing suite run this returns HTTP 409
<code>REFERENCE_SUITE_NOT_PASSED</code>. Naming the already-active version
returns <code>VIEWER_INTEGRATION_ALREADY_ACTIVE</code>.

### 3. Watch

Attribute problems to the candidate before widening. Runtime telemetry and
publication records both carry the adapter version.

- <code>GET /api/v1/platform/metrics</code> for
  <code>compile.duration</code>, <code>compile.validation_failed</code>,
  <code>publish.failed</code> and
  <code>viewer_integration.reference_suite_run</code>.
- Creator analytics <code>viewerIntegrationVersions</code> breakdown in
  <code>.../analytics/summary</code>, and the reliability view for
  <code>viewer_error</code>, <code>asset_failed</code>,
  <code>scene_transition_failed</code> and <code>capability_fallback</code>.

Compare the candidate's error rate against the active version over the same
window before increasing the percentage.

### 4. Promote

~~~powershell
Invoke-RestMethod -Method Post -Headers $headers -ContentType 'application/json' `
  -Uri "$env:SPHERE_BASE_URL/api/v1/platform/viewer-integrations/promote" `
  -Body '{"viewerIntegrationVersion":"psv-5.14.3-adapter-2"}'
~~~

Promotion makes the version active and ends the rollout. The gate still applies.

### Roll back

Rollback is an ordinary promotion of the previous version, and is the correct
first response to a renderer regression:

~~~powershell
Invoke-RestMethod -Method Post -Headers $headers -ContentType 'application/json' `
  -Uri "$env:SPHERE_BASE_URL/api/v1/platform/viewer-integrations/rollback" `
  -Body '{"viewerIntegrationVersion":"psv-5.14.3-adapter-1"}'
~~~

To abandon a rollout without promoting anything, clear the candidate:

~~~powershell
Invoke-RestMethod -Method Put -Headers $headers -ContentType 'application/json' `
  -Uri "$env:SPHERE_BASE_URL/api/v1/platform/viewer-integrations/rollout" `
  -Body '{"candidateVersion":null,"rolloutPercent":0}'
~~~

The rollback target must also have a passing suite run. Keep the previous
version's run on record rather than pruning it, or rollback is blocked exactly
when it is needed. Rollback changes what future compiles produce; publications
already compiled against the candidate keep their manifests until republished,
so a regression that reached publications is corrected by republishing those
projects after the rollback.

Every rollout, promotion and rollback is written to <code>audit_logs</code> as
<code>viewer_integration.rollout_changed</code> with the previous and new state.

## Extension registry operations

Custom interactions are validated against a registered, versioned extension
contract. The schema is declarative and the runtime module is allow-listed, so a
publication can never name arbitrary client code. These routes also require
<code>platform_admin</code>.

- <code>POST /api/v1/extensions</code> registers a version.
- <code>PATCH /api/v1/extensions/:extensionId/:version/status</code> moves it
  between <code>draft</code>, <code>active</code>, <code>deprecated</code> and
  <code>disabled</code>.

Disabling a version stops new authoring against it and fails validation for
drafts that still reference it, with
<code>EXTENSION_NOT_AVAILABLE</code>. Publications pin the extension versions
they compiled against, so an already-published revision keeps working.

Before disabling a version, check what still references it:

~~~sql
SELECT h.extension_id, h.extension_version, COUNT(*) AS hotspots
  FROM hotspots h
 WHERE h.extension_id IS NOT NULL
 GROUP BY 1, 2;

SELECT o.extension_id, o.extension_version, COUNT(*) AS overlays
  FROM overlays o
 WHERE o.extension_id IS NOT NULL
 GROUP BY 1, 2;
~~~

Prefer <code>deprecated</code> over <code>disabled</code> when drafts still use
a version: deprecated keeps authoring and publishing working while signalling
that a newer version exists.

## Live authoring session

Sprint 05 added a push channel, a bootstrap route, a batch mutation and a media
URL refresh. None of them is load-bearing on its own: every fact the stream
carries is also readable from a polling route.

### Turning the event stream off

A reverse proxy that buffers or blocks streamed responses will make
<code>GET /api/v1/projects/:projectId/events</code> appear to hang. When that
cannot be fixed at the proxy, turn the channel off:

~~~powershell
$env:EVENT_STREAM_ENABLED = 'false'
~~~

The route then answers <code>503 EVENT_STREAM_DISABLED</code> and clients fall
back to polling. Nothing else changes: project reads, asset reads, preview
compilation and publication history all report the same facts. Confirm after
restarting:

~~~powershell
Invoke-WebRequest "http://localhost:4000/api/v1/projects/$projectId/events" `
  -Headers @{ Authorization = "Bearer $token" } -SkipHttpErrorCheck |
  Select-Object -ExpandProperty StatusCode
~~~

The API sends <code>X-Accel-Buffering: no</code> and a heartbeat comment on the
stream; if a proxy still buffers, raise
<code>EVENT_STREAM_HEARTBEAT_MS</code> only after confirming the proxy honours
neither.

### Connection limits

<code>EVENT_STREAM_MAX_PER_PROJECT</code> and
<code>EVENT_STREAM_MAX_PER_USER</code> bound open streams. A client that leaks
connections is refused with <code>429 EVENT_STREAM_LIMIT_REACHED</code> rather
than exhausting sockets. Watch <code>events.stream.opened</code> against
<code>events.stream.rejected</code>: a rising <code>limit-user</code> rejection
rate is an editor that is not closing streams, not a capacity problem.

Delivery is in-process. In a multi-process deployment each process serves the
streams it holds, so an event published by one process does not reach a client
connected to another. Until a shared fan-out is introduced, either run a single
API process for editing traffic, pin an editing session to one process, or leave
the channel off and let clients poll — a client that never sees an event still
sees the change on its next poll.

### Reading the browser-direct access policy

~~~powershell
Invoke-RestMethod http://localhost:4000/api/v1/platform/browser-access-policy `
  -Headers @{ Authorization = "Bearer $token" }
~~~

This returns the allowlist actually in force for media, events and telemetry.
Check it after changing <code>CORS_ORIGINS</code>, <code>EDITOR_ORIGINS</code>,
<code>PLAYER_ORIGINS</code> or <code>EMBED_ORIGINS</code>: getting an origin
wrong is how an experience becomes embeddable somewhere it should not be.

### A content hash drift alert

Publish always recompiles server-side and stores its own result. When a client
sends the hash it computed locally and it disagrees, the server logs:

~~~text
client-computed content hash disagreed with the server; the server result was published
~~~

with the project, its revision, <code>compilerVersion</code>,
<code>livePatchContractVersion</code>, <code>viewerIntegrationVersion</code> and
both hashes, and raises <code>publish.hash_drift</code>.

Nothing is broken for the customer: the server's result was published. What it
means is that a browser compiled something different from what was published,
which is a bug worth chasing. Compare the two versions in the log first — a
client built against an older compiler or live-patch contract is the usual
cause, and the fix is to ship the matching client, not to change the server.
A drift rate that rises without a client deploy is the signal that matters.

### The compiler behaviour freeze

<code>npm run test:golden</code> compiles fifteen recorded experiences and
compares every byte with the committed fixtures. A failure means compiled output
changed. Re-record only when the change is intended and reviewed:

~~~powershell
npm run golden:record
git diff -- tests/golden/expected
~~~

Re-recording to make a failing test pass destroys the thing being protected.
Review the diff as a change to what customers' published experiences look like,
because that is what it is.

## Shared packages

The six `@alishaikh110/*` packages are the compiler, the schema, the
classification table and their supporting contracts, published privately to
GitHub Packages so the frontend repository can consume them. The backend
consumes the same sources through npm workspaces.

[shared-packages.md](shared-packages.md) is the consumer-facing guide: registry
authentication, the startup compatibility check, and the local linking path.
This section is the operational half.

### Shared package versioning

The set is versioned in **lockstep**. All six always carry the same version, and
every sibling dependency is pinned to the exact version rather than a range.
Independent versions would let a resolver assemble a combination nobody has
tested, and the compiler and the classification table must never be mismatched.

| Change | Level |
| --- | --- |
| Compiled output changes for any existing input | **major** |
| A property's live-patch classification changes | **major** |
| <code>schemaVersion</code> increments | **major** |
| A viewer integration version is retired | **major** |
| New optional field, new capability, new classified property | minor |
| Internal fix with byte-identical compiled output | patch |

The two middle rows are the ones that get missed, because neither changes a
signature and neither looks like a breaking change in review.

A classification moving from <code>live</code> to <code>recompile</code> — the
autorotation case found in Sprint 05 — is breaking for the frontend even though
nothing about the API changed. A frontend that picks it up as a routine minor
keeps mutating the running viewer, its live mutations no longer match the table,
and the preview quietly diverges from what publishes. Nothing fails; a customer
finds out.

**Every major raises the floor.** After publishing a major, raise
<code>MINIMUM_COMPATIBLE_PACKAGE_VERSION</code> in
<code>apps/api/src/contracts/shared-packages.ts</code> to the released version
and deploy the backend. Leaving it behind is what lets an outdated frontend keep
running against a compiler it no longer agrees with; the suite fails if the
floor's major falls behind the packages'.

### Shared package release

Publishing runs from CI on a tag. It never runs from a developer machine:
a laptop skips whichever gate that laptop happened not to run, and the gate that
gets skipped is the behaviour freeze.

~~~powershell
npm run packages:version -- minor     # or major, patch, or an exact x.y.z
~~~

Then, in order:

1. Add a <code>## &lt;version&gt;</code> entry to
   <code>packages/CHANGELOG.md</code>, naming any live-patch classification
   change explicitly. The release fails without one.
2. Rehearse the whole thing locally:

   ~~~powershell
   npm run build
   npm run packages:check
   npm run packages:publish -- --dry-run
   ~~~

   The dry run executes every gate the real release does and stops short of
   uploading.
3. Commit, tag, push:

   ~~~powershell
   git commit -am "Release shared packages <version>"
   git tag packages-v<version>
   git push origin main --tags
   ~~~

The <code>release-shared-packages</code> workflow takes it from there. Before
anything is uploaded, <code>scripts/publish-packages.mjs</code> requires:

- <code>CI=true</code> and a workflow ref of
  <code>refs/tags/packages-v&lt;version&gt;</code> matching the version in
  <code>packages/*/package.json</code>;
- a clean working tree;
- <code>packages:check</code> — metadata, lockstep, sibling pinning, dependency
  allowlist, generated version constants, changelog entry;
- <code>test:golden</code> — the compiler behaviour freeze;
- <code>packages:verify</code> — the tarballs installed into a project outside
  the repository, loading in both module systems, typed at the call site, and
  reproducing the golden fixtures byte for byte.

Those gates run inside the publish script rather than as workflow steps, so the
guarantee does not depend on the order of the steps in the workflow file.

Packages upload in dependency order, so an interrupted release always leaves the
registry in a state where every published package's dependencies are already
there.

### Rolling back a release

**A published version is immutable and cannot be replaced.** GitHub Packages
does not allow re-uploading a version, and it should not: a consumer may already
have installed it.

Roll forward instead.

~~~powershell
npm run packages:version -- patch     # or major, if behaviour is changing back
~~~

Fix the cause, add the changelog entry, and release again. Consumers move by
updating; nothing they have installed changes underneath them.

If a bad version must be made uninstallable, deprecate it so the reason reaches
anyone who tries:

~~~powershell
npm deprecate "@alishaikh110/experience-compiler@1.2.0" `
  "Compiled output regression; use 1.2.1 or later."
~~~

Repeat for all six, so the set stays consistent. Deleting a package version from
GitHub Packages breaks every lockfile that references it; deprecate rather than
delete unless a secret was published, in which case rotate the secret first and
treat deletion as damage limitation rather than a fix.

### A frontend reports an incompatible package set

The message names the problem and the command that fixes it, so start there. The
question worth asking is which side is wrong:

- **The frontend is behind.** Expected after a major. It installs the versions
  the message names.
- **The backend is behind.** A newer package set was published and the deployed
  backend has not been redeployed against it. The frontend reports
  <code>ahead-of-backend</code>. Deploy the backend; do not lower the frontend.
- **The floor was never raised.** A major was published and
  <code>MINIMUM_COMPATIBLE_PACKAGE_VERSION</code> still names an older release,
  so an outdated frontend is being accepted. Raise it and deploy. Then check
  whether any preview divergence has already been reported.

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
$env:DB_HOST = '127.0.0.1'
$env:DB_PORT = '5432'
$env:DB_NAME = 'sphere_test'
$env:DB_USER = 'sphere'
$env:DB_PASSWORD = 'sphere'
$env:JWT_SECRET = 'test-only-secret-at-least-32-characters'
npm run build
npm run db:migrate
npm run lint
npm run typecheck
npm run test:golden
npm run test:unit
npm run test:integration
npm run test:security
npm run test:coverage
npm run packages:check
npm run packages:verify
~~~

This matches CI's build-then-migrate order. Substitute
<code>npm run db:migrate:dev</code> only when explicitly testing the TypeScript
migrator locally.

Required integration coverage includes real PostgreSQL migration compatibility,
authorization/ownership, revision conflicts, duplicate idempotent delivery,
durable job retry, media fixtures, compiler determinism, failed-republish
preservation, private access, and runtime-event deduplication.

Sprint-04 coverage adds project/workspace role enforcement and escalation
refusal, private-publication bypass attempts across every delivery route,
embed-origin enforcement, plan-image authorization, token-scope separation
between the creator API and its signed delivery tokens, operator-surface gating,
custom extension payload validation and allow-listing, live-source SSRF
refusal, template instantiation including custom geometry and reference
rewriting, a 120-scene publish and progressive delivery budget, the analytics
date-range ceiling, and telemetry burst behaviour.

Several of these assert against database CHECK constraints, so they are only
meaningful on real PostgreSQL. The integration harness starts a disposable
cluster when <code>initdb</code> is available and otherwise falls back to an
in-memory adapter that does not enforce those constraints. Set
<code>SPHERE_REQUIRE_REAL_POSTGRES=true</code> in CI so the fallback fails the
run instead of silently weakening it.

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
- <code>MINIMUM_COMPATIBLE_PACKAGE_VERSION</code> names the current major of the
  published shared packages, and the deployed backend runs that release.
- <code>platform_admin</code> granted only to operators who run extension
  registration and viewer-integration rollout.
- The active viewer integration version has a passing reference-suite run on
  record, and so does the version you would roll back to.
- <code>ANALYTICS_MAX_RANGE_DAYS</code> and the <code>PUBLISH_MAX_*</code>
  ceilings reviewed against measured production sizes rather than left at
  defaults by accident.
- <code>LIVE_SOURCE_ALLOWED_HOSTS</code> empty unless a live provider is
  deliberately enabled and its hosts reviewed.
- Share-token expiry policy and embed-origin allowlists reviewed for private
  experiences.
