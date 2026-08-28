# Backend Schema — Sprints 01–05

This document describes both the renderer-independent canonical Experience
model and its PostgreSQL persistence representation. API payload details are in
[backend-api.md](backend-api.md).

## Core invariant

PostgreSQL stores product concepts, stable IDs, state, metadata, references, and
immutable compiled publication manifests. Original media and derivatives are
stored outside PostgreSQL through the storage-provider interface.

Photo Sphere Viewer configuration is not canonical project data. Canonical
projects use product concepts such as scenes, point hotspots, appearance,
information actions, and controls. A compiler validates this data, selects
logical media derivatives, and calls a versioned integration adapter to create a
runtime manifest.

~~~text
Canonical project revision
  -> schema and reference validation
  -> capability/media preflight
  -> content sanitization and URL validation
  -> derivative selection
  -> versioned viewer integration adapter
  -> preview or immutable publication manifest
~~~

Preview and publish use this same pipeline.

## Canonical Experience model

The current canonical schema version is <code>1</code>. Every project persists a
<code>schemaVersion</code> so future revisions can migrate canonical data
without coupling saved projects to a renderer release.

### Project

| Field | Meaning |
| --- | --- |
| <code>id</code> | Stable UUID. |
| <code>ownerId</code> | Owning user UUID. |
| <code>type</code> | <code>image360</code> or <code>video360</code>. Immutable after creation. |
| <code>name</code> | Creator-facing name. |
| <code>schemaVersion</code> | Canonical schema version. |
| <code>revision</code> | Monotonic optimistic-concurrency revision. |
| <code>settings</code> | Product-level appearance, navigation, and information settings. |
| <code>branding</code> | Company copy, logical branding asset references, and product colors. |
| <code>videoAssetId</code> | <code>video360</code> only. The primary logical 360 video asset. |
| <code>videoSettings</code> | <code>video360</code> only. Product-level playback preferences. |
| <code>publicationMetadata</code> | Draft slug and visibility preferences. |
| <code>createdAt</code>, <code>updatedAt</code> | Audit timestamps. |

Project settings use product-level controls:

~~~json
{
  "appearance": {
    "theme": "dark",
    "primaryColor": "#203040",
    "backgroundColor": "#101820",
    "hotspotStyle": "default",
    "typography": "system"
  },
  "navigation": {
    "mouse": true,
    "touch": true,
    "zoom": true,
    "fullscreen": true,
    "keyboard": true,
    "navigationButtons": true
  },
  "information": {
    "title": "Museum lobby",
    "description": "Welcome to the museum.",
    "bodyHtml": "<p>Visitor information.</p>",
    "externalUrl": "https://museum.example/"
  }
}
~~~

Branding may contain <code>companyName</code>, logical
<code>logoAssetId</code>/<code>faviconAssetId</code>/
<code>watermarkAssetId</code> references, <code>primaryColor</code>, and
sanitized welcome/loading messages.

### Scene

| Field | Meaning |
| --- | --- |
| <code>id</code> | Stable UUID. |
| <code>projectId</code> | Parent project UUID. |
| <code>name</code> | Creator-facing scene name. |
| <code>panoramaAssetId</code> | Stable logical panorama asset UUID. |
| <code>sortOrder</code> | Stable display order within a project. |
| <code>isPrimary</code> | Whether the scene is the project's primary scene. |
| <code>initialView</code> | Product-level heading, pitch, and horizontal field of view in degrees. |
| <code>viewLimits</code> | Product-level heading and pitch limits in degrees. |
| <code>overlays</code>, <code>connections</code> | Forward-compatible canonical arrays. |
| <code>spatialData</code>, <code>runtimeHints</code> | Forward-compatible product metadata. |

Persistence supports multiple scenes from the start. Sprint 01's authoring UI
may emphasize one primary scene.

### Hotspot

| Field | Meaning |
| --- | --- |
| <code>id</code> | Stable UUID. |
| <code>sceneId</code> | Parent scene UUID. |
| <code>geometry</code> | Geometry union; Sprint 01 creation uses <code>{ "kind": "point" }</code>. |
| <code>position</code> | Product-level spherical position. |
| <code>appearance</code> | Label, icon asset ID, color, and emphasis. |
| <code>content</code> | Title, tooltip HTML, and body HTML. |
| <code>action</code> | None, information, link, scene, image, or video product action. |
| <code>visibilityRules</code> | Product visibility rules. |
| <code>sortOrder</code> | Stable ordering within a scene. |

Positions are deliberately not renderer radians:

~~~json
{
  "coordinateSystem": "spherical_degrees",
  "longitudeDegrees": 42.5,
  "latitudeDegrees": -6.25
}
~~~

The persisted action union includes <code>none</code>,
<code>showInformation</code>, <code>openUrl</code>, <code>openAsset</code>, and
<code>goToScene</code>. Sprint 01 runtime compilation supports the first three;
<code>openAsset</code> and <code>goToScene</code> are retained for forward
compatibility and return <code>CAPABILITY_UNSUPPORTED</code> at preflight. The
geometry shape is likewise a union so later sprints can add polygon, polyline,
and layer authoring without replacing stable hotspot IDs or redesigning
persistence. Nonempty scene view limits, overlays, connections, spatial data,
and runtime hints are persisted but also fail Sprint 01 runtime preflight.

### Asset

A logical asset ID remains stable across inspection, processing failures, retry,
and derivative regeneration.

| Field | Meaning |
| --- | --- |
| <code>id</code> | Stable UUID referenced by canonical projects/scenes. |
| <code>ownerId</code> | Owning user. |
| <code>projectId</code> | Optional project scope. |
| <code>sourceStorageKey</code> | Private provider key for the immutable original. |
| <code>sourceFilename</code> | Untrusted creator-provided filename retained as metadata. |
| <code>sourceMimeType</code> | Validated source MIME type. |
| <code>sourceSizeBytes</code> | Original size as PostgreSQL BIGINT. |
| <code>sourceChecksum</code> | Verified SHA-256 when available. |
| <code>mediaType</code> | <code>panorama_image</code>, <code>image</code>, or <code>logo</code>. |
| <code>projection</code> | Equirectangular, cropped equirectangular, or a reserved projection. |
| <code>metadata</code> | Dimensions, aspect ratio, XMP/GPano and inspection metadata. |
| <code>processingStatus</code> | Explicit asset state. |
| <code>processingError</code> | Stable failure category and safe diagnostics. |

### Asset derivative

| Field | Meaning |
| --- | --- |
| <code>id</code> | Stable derivative UUID used by authorized logical media routes. |
| <code>assetId</code> | Logical parent asset UUID. |
| <code>kind</code> | Derivative purpose. |
| <code>version</code> | Monotonic cache-safe generation version. |
| <code>storageKey</code> | Private provider key. |
| <code>mimeType</code> | Generated media MIME type. |
| <code>width</code>, <code>height</code> | Pixel dimensions when applicable. |
| <code>sizeBytes</code> | Generated object size as PostgreSQL BIGINT. |
| <code>metadata</code> | Checksums and processing metadata. |
| <code>createdAt</code> | Immutable creation timestamp. |

Required Sprint 01 kinds are <code>thumbnail</code>,
<code>lowResolutionBase</code>, and <code>standardWeb</code>. Later kinds are
reserved without making them required for image readiness. A
<code>panorama_image</code> is inspected for full or cropped equirectangular
geometry; <code>image</code> and <code>logo</code> assets use the general image
inspection path. Scene panorama references require
<code>panorama_image</code>, while hotspot display-image references require
<code>image</code> or <code>logo</code>. Branding media is optional at compile
time: only a ready <code>image</code>/<code>logo</code> reference emits a media
object, while textual branding continues without an unavailable optional
image.

## State machines

### Asset processing

~~~text
uploaded -> inspecting -> processing -> ready
                 \             \-----> failed
                  \-------------------> failed

ready | failed -> reprocess -> inspecting
~~~

Transitions are validated. A duplicate delivery may repeat the current state
but cannot create duplicate derivatives. Reprocessing preserves the asset ID and
generates a new derivative version.

### Upload session

~~~text
pending -> uploaded -> completed
   |          |
   +----------+-> expired | aborted | failed
~~~

Creating a session also creates the logical asset. The raw PUT makes the
immutable original available; completion verifies it and enqueues durable media
work.

### Media job

~~~text
queued -> running -> succeeded
            |
            +------> failed
queued/running ----> cancelled
~~~

Jobs carry an available time, attempt/max-attempt counters, lock timestamps,
progress, stage, payload, and safe error details. Workers claim jobs through the
database so embedded and external modes share the same durable semantics. A
running job whose heartbeat is older than the configured lease (15 minutes by
default) is treated as abandoned and returned to the queue on the next poll.
State transitions, immutable storage keys, and derivative uniqueness make that
replay idempotent.

### Publication

~~~text
publishing -> published
     |
     +------> publish_failed

published + newer draft -> publishing -> new published current
                                |
                                +------> publish_failed
                                         previous current remains active
~~~

Published canonical fields and compiled manifests are immutable. The current
pointer changes atomically only after a successful compile and persistence
transaction. <code>retired</code> is reserved for lifecycle management. The
persistence enum also reserves <code>unlisted</code> visibility for future
compatibility, but Sprint 01 publishing exposes only <code>public</code> and
<code>private</code>.

## PostgreSQL tables

### Relationship overview

~~~text
users
  +-- workspaces
  |     +-- workspace_memberships
  |     +-- custom_domains
  |     +-- templates (workspace scope)
  +-- projects                     (optional workspace scope)
  |     +-- project_access
  |     +-- scenes                 (image360)
  |     |     +-- hotspots
  |     |     +-- overlays
  |     |     +-- scene_connections
  |     +-- plans                  (image360)
  |     +-- timeline_interactions  (video360)
  |     +-- assets (optional project scope)
  |     |     +-- asset_derivatives
  |     |     +-- upload_sessions
  |     |     +-- media_jobs
  |     |           +-- media_job_stages
  |     +-- publications
  |     |     +-- published_scene_definitions
  |     |     +-- publication_share_tokens
  |     +-- runtime_events
  +-- assets
  +-- upload_sessions
  +-- idempotency_records
  +-- templates (private scope)
extensions                (platform-wide versioned interaction registry)
platform_settings         (operator state, including viewer integration rollout)
viewer_integration_checks (reference experience suite runs)
audit_logs                (privileged changes; identifier columns, not foreign keys)
storage_deletion_jobs     (durable physical cleanup; no asset foreign key by design)
~~~

A scene's placement on a plan lives in <code>scenes.spatial_data</code> rather
than in a join table, because placement is scene state, not a relationship the
product ever queries from the plan side.

### users

Stores UUID, normalized unique email, password hash, display name, status
(<code>active</code> or <code>disabled</code>), and timestamps. Password hashes
never enter API DTOs.

Indexes:

- unique email
- status

### projects

Stores the canonical project root. Settings, branding, and publication metadata
are JSONB; stable identity, ownership, type, schema version, revision, and
timestamps are typed columns.

Indexes:

- owner plus update time for project lists
- project ID plus revision uniqueness
- primary video asset, for <code>video360</code> reference integrity

A check constraint keeps <code>video_asset_id</code> null unless the project is
a <code>video360</code> project. The foreign key uses <code>RESTRICT</code>, so a
published experience cannot lose its only playback source.

Every successful project, scene, or hotspot mutation checks and increments
<code>revision</code> inside one database transaction.

### scenes

Stores scene identity, project and panorama-asset references, ordering/primary
fields, and canonical JSONB view/forward-compatible fields.

Indexes and constraints:

- project plus sort order
- panorama asset lookup
- partial uniqueness allowing at most one primary scene per project
- project deletion cascades to scenes
- deletion of a panorama asset referenced by a scene is restricted

### hotspots

Stores stable identity and scene reference plus canonical JSONB geometry,
position, appearance, content, action, and visibility rules.

Indexes and constraints:

- scene plus sort order
- scene deletion cascades to hotspots

### assets

Stores the logical asset, immutable source reference, validated source facts,
projection/metadata, and processing state.

Indexes and constraints:

- owner plus optional project
- project lookup
- processing status plus update time for operations
- unique source storage key
- project deletion detaches reusable assets rather than deleting their media

### asset_derivatives

Stores the immutable derivative catalog.

Indexes and constraints:

- unique <code>(asset_id, kind, version)</code>
- unique storage key
- asset deletion cascades to derivative rows

These uniqueness rules make duplicate worker delivery safe when combined with
transactional writes.

### upload_sessions

Stores owner/project/asset references, status, immutable target key,
provider-upload reference, filename, declared MIME type, expected size,
metadata, expiry, completion time, and timestamps.

Indexes and constraints:

- owner plus status
- asset lookup
- status plus expiry
- unique storage key

### media_jobs

Stores durable inspect/process/reprocess work:

- job and asset IDs
- type, stage, status, progress
- derivative version and unique job idempotency key
- attempt/max-attempt counts
- payload and safe error JSONB
- availability, lock, per-claim <code>lease_token</code>, start, finish, and
  audit timestamps

Indexes:

- unique media-job idempotency key
- unique <code>(asset_id, derivative_version)</code>
- partial unique asset index for statuses <code>queued</code> and
  <code>running</code>, allowing at most one active job per asset
- status plus availability for worker claims
- asset plus status for operational lookup

Every claim assigns a new lease token. Heartbeats and terminal writes compare
both job status and that token, preventing an expired worker from finalizing a
job after another worker has recovered it.

### media_job_stages

Per-stage progress inside one logical media job. The image pipeline reports
<code>inspect</code>, <code>derivatives</code>, then one stage per generated
derivative (<code>thumbnail</code>, <code>lowResolutionBase</code>,
<code>standardWeb</code>, <code>tiledLevels</code>), then
<code>finalize</code>. The video pipeline reports <code>inspect</code>,
<code>poster</code>, <code>transcodeDesktop</code>,
<code>transcodeMobile</code> and <code>finalize</code>. Each row carries a
status, the derivative kind it produces, the derivative version, the attempt
number, whether the stage is required, a machine-readable error, and safe
diagnostics.

Rows accumulate across every job an asset has run, so the asset API reports only
the stages of the most recent job: a successful reprocess must not leave a
<code>ready</code> asset advertising a stage that its replacement already
superseded.

Indexes:

- unique media job plus stage
- asset plus stage plus status, for child-job lookup

Transcoder vendor detail belongs in <code>diagnostics</code> here, never in
canonical project or manifest data. A video asset only becomes <code>ready</code>
when at least one publishable playback profile exists; a single failed profile
leaves an actionable stage row while the surviving profiles remain usable.

### timeline_interactions

Persists canonical timed interactions for <code>video360</code> projects. Kind,
times, and ordering are typed columns; geometry, position, viewpoint,
appearance, content, action, and visibility rules are JSONB.

Indexes:

- project, time, sort order, ID — the total authoring and compile order
- project plus kind

Check constraints enforce the supported kinds, <code>time_ms >= 0</code>,
<code>sort_order >= 0</code>, and <code>end_time_ms >= time_ms</code> when
present. Every timeline mutation checks and increments the project
<code>revision</code> inside one transaction, so concurrent editors cannot
silently overwrite each other.

### storage_deletion_jobs

Durable outbox rows bridge transactional logical asset deletion and
non-transactional object-storage deletion. Each row stores the removed logical
asset ID for audit, a unique backend-generated storage key, queued/running/
succeeded state, attempts, availability, a per-claim lease token, safe last
error, completion time, and timestamps. It intentionally has no asset foreign
key, so the cleanup intent survives deletion of the asset catalog row.

The asset service enqueues the original and all derivative keys in the same
database transaction that removes the logical asset. Workers then perform the
idempotent provider delete and use lease-token compare-and-set completion.
Expired claims are redelivered; failures receive capped exponential backoff.

Indexes and constraints:

- unique storage key
- status plus availability for worker claims
- logical asset ID for audit and asset-scoped best-effort draining
- state constraint tying locks/tokens/completion time to the job status

### publications

Stores immutable project/publication revisions, slug, visibility, compiled
manifest version and JSONB, status, current flag, share metadata, safe failure
details, publication time, and timestamps.

Constraints:

- unique <code>(project_id, publication_revision)</code>
- at most one current publication per project
- at most one current publication per slug
- slug/current/status lookup index

Published rows retain the exact manifest used by the runtime. Compiler failures
are recorded as non-current <code>publish_failed</code> attempts with safe
failure details and cannot replace the current successful revision.

### idempotency_records

Stores owner, operation, caller key, canonical request fingerprint, execution
status, recorded HTTP status/body, optional resource identity, lock expiry,
record expiry, and timestamps.

The unique key is <code>(owner_id, operation, idempotency_key)</code>. The
fingerprint distinguishes a safe retry from reuse with a different payload.
Statuses are <code>in_progress</code>, <code>completed</code>, and
<code>failed</code>. A compiler-failed publish stores the safe error in the same
transaction as its <code>publish_failed</code> history row; an identical replay
returns that error without creating another attempt.

### runtime_events

Stores:

- unique <code>event_id</code>
- event name
- experience/project ID
- publication revision
- viewer integration version
- privacy-safe session ID
- device, runtime, and event payload JSONB
- occurrence and receipt timestamps

Indexes support experience/revision/time and event-name/time queries. Event-ID
uniqueness makes telemetry retries safe.

### workspaces

Stores UUID, owner, display name, unique slug, settings JSONB, and timestamps. A
workspace is the optional shared scope a project and a template can belong to.

Indexes:

- unique slug
- owner

### workspace_memberships

Stores workspace, user, role, status, inviting user, invitation and acceptance
times, and timestamps. The workspace creator is also stored as an explicit
<code>owner</code> member, so listings and role changes have one source of
truth.

Constraints and indexes:

- unique <code>(workspace_id, user_id)</code>
- <code>(user_id, status)</code> for a user's workspace list
- role check: <code>owner</code>, <code>admin</code>, <code>editor</code>,
  <code>viewer</code>
- status check: <code>invited</code>, <code>active</code>, <code>revoked</code>

Removal sets <code>revoked</code> rather than deleting the row, so the audit
trail keeps its subject.

### project_access

Stores per-project grants: project, user, role, granting user, and timestamps. A
grant is independent of workspace membership; the effective role is the most
privileged of ownership, workspace membership, and grant.

Constraints and indexes:

- unique <code>(project_id, user_id)</code>
- <code>user_id</code>, for the accessible-project filter
- role check, excluding <code>owner</code>: ownership is transferred, not
  granted

<code>projects.workspace_id</code> was added in the same migration, with a
<code>(workspace_id, updated_at)</code> index for workspace project lists.

### plans

Stores a floor or site plan: project, name, optional plan-image asset,
coordinate system, metadata JSONB, sort order, and timestamps.

Constraints and indexes:

- <code>(project_id, sort_order)</code>
- <code>asset_id</code>
- coordinate-system check: <code>plan_normalized</code> or
  <code>plan_pixels</code>; a plan never uses world coordinates
- non-negative sort order

Deleting a plan clears the placement of scenes positioned on it rather than
blocking the delete. A plan image must be a <code>plan_image</code> or
<code>image</code> asset owned by the project owner and either unattached or
attached to this project.

Scene placement lives in <code>scenes.spatial_data</code> (JSONB). World fields
(<code>latitude</code>, <code>longitude</code>, <code>altitudeMeters</code>) and
plan fields (<code>planId</code>, <code>mapX</code>, <code>mapY</code>) are
independent: each family is all-or-nothing, and neither is required. A
floor-plan-only experience never stores invented GPS data.

### overlays

Stores scene-layer visual elements: scene, optional name, geometry kind,
geometry JSONB, position, appearance, content, action, visibility rules, pinned
extension id and version, sort order, and timestamps.

Constraints and indexes:

- <code>(scene_id, sort_order)</code>
- <code>(extension_id, extension_version)</code>
- geometry-kind check restricted to the canonical union and excluding
  <code>point</code>: a point belongs on a hotspot
- extension pair check: <code>extension_id</code> and
  <code>extension_version</code> are both null or both set
- custom-geometry check: <code>geometry_kind = 'custom'</code> requires an
  extension id

### hotspots (Sprint-04 columns)

<code>geometry_kind</code>, <code>extension_id</code> and
<code>extension_version</code> were added so a hotspot carries the same
interaction contract as an overlay. The backfill derives
<code>geometry_kind</code> from the stored geometry JSON.

Constraints and indexes:

- geometry-kind check across the full canonical union, including
  <code>point</code>
- extension pair check, as for overlays
- custom-geometry check: <code>geometry_kind = 'custom'</code> requires an
  extension id
- <code>(extension_id, extension_version)</code>

The custom-geometry check is the reason every write path that creates a hotspot
must carry the extension pair through with the geometry, template
instantiation included.

### extensions

Stores the versioned custom-interaction registry: extension id, version, name,
description, supported experience types, declarative field schema, required
capabilities, allow-listed runtime module, security policy, status, and
timestamps.

Constraints and indexes:

- unique <code>(extension_id, version)</code>
- <code>status</code>
- status check: <code>draft</code>, <code>active</code>,
  <code>deprecated</code>, <code>disabled</code>

The schema is declarative, so an extension never ships executable validation.
The runtime module is allow-listed here, so a publication can never name
arbitrary client code. Built-in reference extensions are merged in at read time;
a stored row of the same id and version wins, which is how a built-in is
superseded or disabled.

### templates

Stores a reusable canonical Experience blueprint: owner, optional workspace,
name, description, schema version, experience type, canonical blueprint JSONB,
asset policy, visibility, status, optional preview asset, and timestamps.

Constraints and indexes:

- <code>(visibility, experience_type, status)</code> for catalog listing
- <code>workspace_id</code> and <code>owner_id</code>
- visibility check: <code>private</code>, <code>workspace</code>,
  <code>platform</code>
- status check: <code>draft</code>, <code>published</code>,
  <code>archived</code>
- asset-policy check: <code>omit</code>, <code>reference</code>,
  <code>copy</code>
- a <code>workspace</code> template requires a workspace

The blueprint stores blueprint-local keys (<code>scene-1</code>,
<code>plan-2</code>, <code>asset-3</code>) rather than source IDs, for every
mutable entity and every reference between them: scene links, plan placement,
default plan, preload hints, and asset references. Instantiation mints fresh
IDs and resolves those keys against the new project, so a copy never points back
at the project it was captured from and no template can carry another account's
asset identifiers.

### publication_share_tokens

Stores project, optional pinned publication revision, token hash, label,
creating user, expiry, revocation time, and timestamps. Only the hash is
persisted; the secret is returned once at creation.

Constraints and indexes:

- unique <code>token_hash</code>
- <code>project_id</code>
- an expiry, when present, must be after creation

A token with no pinned revision follows the current publication. Revocation and
expiry both take effect immediately on every delivery route.

### custom_domains

Stores workspace, hostname, verification token, status, verification time, and
timestamps. The backend records the mapping and its verification state; it does
not provision DNS or certificates.

Constraints and indexes:

- unique hostname
- <code>workspace_id</code>
- status check: <code>pending</code>, <code>verified</code>,
  <code>disabled</code>

### audit_logs

Stores action, actor, workspace, project, entity type and id, metadata JSONB,
and occurrence time.

Actor, workspace and project are plain identifier columns rather than foreign
keys: the trail has to outlive what it describes.

Indexes:

- <code>(project_id, occurred_at)</code>
- <code>(workspace_id, occurred_at)</code>
- <code>(actor_user_id, occurred_at)</code>
- action check against the recorded action list

### platform_settings

A small key/value JSONB store for operator state, keyed by string, with the
updating user and timestamps. The viewer-integration rollout
(<code>activeVersion</code>, <code>candidateVersion</code>,
<code>rolloutPercent</code>) is stored here.

### viewer_integration_checks

Stores one reference-experience-suite run: adapter version, status, total,
passed and failed counts, per-experience results JSONB, start and finish times,
the operator who ran it, and timestamps.

Constraints and indexes:

- <code>(viewer_integration_version, status, finished_at)</code>
- status check: <code>running</code>, <code>passed</code>,
  <code>failed</code>, with non-negative counts

A rollout, promotion or rollback requires a <code>passed</code> row for its
target version, which is what makes the suite a gate rather than a report.

### publications (Sprint-04 columns)

<code>viewer_integration_version</code>, <code>embed_policy</code> (JSONB),
<code>pinned_extensions</code> (JSONB) and <code>scene_index</code> (JSONB) were
added.

The version is recorded at compile time, so a later rollout change never
rewrites an existing revision and telemetry can be attributed to the exact
adapter that produced it. Pinned extensions record the extension versions the
revision compiled against. The scene index is the lightweight per-scene list a
large tour pages through, kept separately from the manifest so a segmented
manifest can carry only its first segment.

Added indexes:

- <code>(viewer_integration_version, status)</code>, for rollout audits
- <code>(slug, publication_revision)</code>, for revision-pinned delivery
- <code>(publication_id, scene_id)</code> on
  <code>published_scene_definitions</code>, for progressive scene fetch

### users (Sprint-04 column)

<code>platform_role</code> was added, checked against <code>member</code> and
<code>platform_admin</code>, with an index. It gates the extension registry and
the viewer-integration rollout, and is read from the database on every request
so revoking it takes effect immediately.

### runtime_events (Sprint-04 indexes)

Creator analytics added <code>(experience_id, event_name, occurred_at)</code>
and <code>(experience_id, session_id)</code>. The event-name check was widened
to the full Sprint-04 event list.

Raw events stay behind the <code>AnalyticsStore</code> interface. PostgreSQL is
the store today, and these indexes are what the bounded date-range queries are
sized for; a deployment with heavier telemetry can implement the same interface
against a dedicated analytics store without changing the API or its
authorization rules.

### assets and derivatives (Sprint-04 media families)

The media-type check was widened to include <code>plan_image</code>, and the
derivative-kind check to include <code>cubemap</code>,
<code>tiledCubemap</code>, <code>normalizedPanorama</code> and
<code>planImage</code>. These describe media families, not renderer adapters:
the compiler's quality policy chooses among the families a logical asset
actually has, and only the integration adapter turns that choice into renderer
configuration.

## Content and reference integrity

- Cross-entity references use stable UUIDs, never display names, signed URLs, or
  transient upload URLs.
- Scene panorama assets and hotspot-referenced assets must exist, be owned by
  the project owner, and meet the action's media requirements.
- Required panorama assets must be <code>ready</code> before preview or publish.
- HTML fields are server-side allow-list sanitized.
- External URLs pass one centralized policy; dangerous schemes are rejected.
- Local storage keys are generated by the backend, normalized, and constrained
  below <code>STORAGE_ROOT</code>.
- Private source objects and derivatives are not statically mounted.
- Preview and private-publication media uses short-lived signed
  <code>/api/v1/media/:derivativeId</code> URLs. Public manifests use
  project/publication-revision-scoped routes whose derivative ID must occur in
  the current public manifest.

## The shared compiler packages

The Experience Compiler is not a private service inside the API. It is a pure,
deterministic package that the API imports and that a browser application can
import too, so an editor previews with the same compiler that publishes. There
is deliberately nowhere to put a second implementation.

| Package | Owns |
| --- | --- |
| <code>@sphere/telemetry-contract</code> | Runtime event names, event sets, failure categories and the ingest payload schemas. |
| <code>@sphere/capability-registry</code> | Capability definitions, dependencies, incompatibilities and fallbacks. |
| <code>@sphere/experience-schema</code> | Canonical Experience types, validation, sanitization, the runtime policy contract and the compiled manifest contract. |
| <code>@sphere/viewer-integration</code> | Versioned adapters turning a compiled manifest into renderer configuration. |
| <code>@sphere/experience-compiler</code> | <code>compile(input)</code>, preflight, derivative selection and the delivery policy. |
| <code>@sphere/live-patch</code> | The property classification table and its enumerated mutations. |

Dependency boundaries are enforced, not agreed: package projects compile with no
ambient Node types, and lint forbids <code>packages/*</code> from importing an
application, a Node built-in, a server runtime, a clock or a random source. A
test scans the package sources for the same violations.

### Compiler contract

~~~text
compile(input: CompilerInput): CompileResult
~~~

<code>CompilerInput</code> carries everything that varies per request, resolved
by the caller: the canonical experience, asset snapshots, the capability
registry to resolve against, the delivery and runtime policy, and the versions
the output must be labelled with. <code>CompileResult</code> carries the
manifest, the compiled scene definitions, the scene index, the viewer
integration config, product-language diagnostics, and a deterministic
<code>contentHash</code>. <code>tryCompile</code> returns the same findings as
diagnostics rather than throwing.

The compiler does not read a database, filesystem, network or environment; does
not call <code>Date.now()</code>, <code>Math.random()</code> or generate an id;
does not produce a signed URL or any credential; and does not mutate its input.
Compiling the same input twice produces byte-identical output and the same hash.

### Signed URLs stay outside the compiler

The compiler emits **logical derivative references** only — a delivery location
built from a policy template, with no credential and no expiry. Swapping a
reference for a signed, expiring URL is a server-only hydration step performed
after compilation, and it is the same step for a draft preview and for a private
publication. That is what lets a published manifest be stored immutably,
recompiled anywhere and compared byte for byte, and it is what makes the
compiler safe to run in a browser.

### Sanitization stays outside the compiler

Rich content and URLs are sanitized and validated at **write time**, so
canonical stored data is already safe. The compiler sanitizes again as defence
in depth, never as the control itself: a browser running the compiler must not
be able to bypass a security control by not running it.

## Live-patch classification

Every canonical property is classified as <code>live</code>,
<code>recompile</code> or <code>remount</code>, and the table is versioned as
<code>livePatchContractVersion</code> and returned by editor bootstrap.

| Class | Meaning | Example |
| --- | --- | --- |
| <code>live</code> | Applied directly to a running viewer by an enumerated mutation. | Hotspot position, hotspot colour, tooltip text, auto-rotation speed |
| <code>recompile</code> | The compiler runs again; the viewer instance is reused. | Adding a scene, enabling a capability, changing view limits |
| <code>remount</code> | The viewer is destroyed and rebuilt. | Swapping the panorama asset, changing experience type |

Every <code>live</code> property names the mutation that applies it. A property
that is not classified is <code>recompile</code>. That default is deliberate and
one-directional: treating a recompile property as live shows a creator a preview
that lied, while treating a live property as a recompile only costs a round
trip. Nothing is ever live by default, and a property nested inside a live one
is not itself live.

**Patch equals recompile.** For every live property, a conformance test compiles
experience A, applies the enumerated mutation, compiles experience B with the
same change made canonically, and asserts the two are identical. If a mutation
and the compiler ever disagree, CI fails rather than a customer seeing a preview
that lied. The mutations reuse the compiler's own value builders rather than
restating them, so there is nothing to drift.

The classification is not a guess about cost, it is a statement about
correctness. Automatic rotation is the worked example: its speed, direction and
start behaviour are live, but turning it on or off resolves a capability, so the
switch itself is a recompile — the conformance suite is what established that.

## Compiler and manifest versioning

The canonical <code>schemaVersion</code>, compiled
<code>manifestVersion</code>, and <code>viewerIntegrationVersion</code> are
independent:

- <code>schemaVersion</code> controls saved Experience compatibility.
- <code>manifestVersion</code> controls the runtime manifest contract. It is a
  compiler-code-owned numeric schema version, currently <code>3</code>, rather
  than a deployment environment setting. <code>experienceType</code>
  discriminates its payload: <code>image360</code> manifests carry scenes and
  tour delivery, <code>video360</code> manifests carry the video media contract
  and the compiled timeline.
- <code>viewerIntegrationVersion</code> identifies the pinned adapter/renderer
  behavior used for compilation and telemetry.

Given the same canonical project revision and derivative catalog, compilation is
deterministic — byte for byte, on a server or in a browser. A behaviour freeze
of fifteen recorded experiences guards it: each fixture holds the canonical
input, the compiled manifest, the viewer integration config, the scene
definitions and a content hash of each, and CI fails when any byte moves.
<code>compilerVersion</code> labels the compiler build and is logged beside a
hash-drift alert.

## Migrations

The applied set, in order:

| Migration | Adds |
| --- | --- |
| <code>20260824000000-initial-schema</code> | Users, projects, scenes, hotspots, assets, derivatives, upload sessions, media jobs, publications, idempotency records, runtime events |
| <code>20260824010000-sprint-02-tour-persistence</code> | Scene connections, published scene definitions, storage deletion jobs |
| <code>20260824020000-sprint-03-video-timeline</code> | Timeline interactions and the video derivative/profile columns |
| <code>20260824030000-sprint-04-spatial-analytics-scale</code> | Workspaces, memberships, project access, plans, overlays, hotspot geometry/extension columns, extensions, templates, share tokens, custom domains, audit logs, publication embed policy and pinned extensions, widened media families, analytics indexes |
| <code>20260824040000-sprint-04-platform-operations</code> | Platform role, platform settings, viewer integration checks, publication scene index and slug/revision index |
| <code>20260824050000-sprint-01-panorama-job-stages</code> | Per-stage panorama job records |

Schema changes use ordered Umzug migrations executed through Sequelize. For
development, execute the TypeScript migrator directly:

~~~powershell
npm run db:migrate:dev
~~~

Production commands run compiled code. Build the release artifact before
applying or reverting migrations:

~~~powershell
npm run build
npm run db:migrate
~~~

To revert the most recent migration on a disposable development or test
database, use <code>npm run db:migrate:undo:dev</code>. The compiled equivalent
is:

~~~powershell
npm run db:migrate:undo
~~~

Never run migration undo against production without a reviewed recovery plan
and verified backup. Production deployment should run migrations once as a
controlled release step rather than relying on every API replica. See
[runbook.md](runbook.md).
