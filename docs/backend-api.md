# Backend API — Sprint 01

This document defines the HTTP contract for the image360 backend MVP. The
canonical source of data is the Experience model described in
[backend-schema.md](backend-schema.md); renderer-specific Photo Sphere Viewer
configuration appears only in compiled manifests.

## Conventions

### Base URLs and content types

- Authenticated application routes are rooted at <code>/api/v1</code>.
- Published manifest resolution is rooted at <code>/view</code>.
- Health probes are rooted at <code>/health</code>.
- JSON requests use <code>Content-Type: application/json</code>.
- The upload-content endpoint uses the declared image MIME type and a raw binary
  body. It is not multipart.
- IDs are UUID strings and timestamps are ISO 8601 UTC strings.
- A client may send a safe <code>X-Request-ID</code>. Otherwise the backend
  generates one. Every response echoes it in the <code>X-Request-ID</code>
  header, and errors also include it in JSON.

### Authentication

Except for registration, login, health probes, public manifest resolution,
revision-scoped media referenced by the current public publication, and media
requests carrying a valid short-lived media token, routes require:

~~~http
Authorization: Bearer ACCESS_TOKEN
~~~

The token is a JWT access token whose subject identifies the user. Ownership is
checked for projects, scenes, hotspots, assets, upload sessions, publications,
and private manifests. A valid ID belonging to another user does not grant
access.

### Optimistic revision preconditions

The backend does not use <code>If-Match</code> in Sprint 01. Revision
preconditions are required JSON fields:

- <code>revision</code> for project PATCH, validate, preview, and publish.
- <code>projectRevision</code> for scene and hotspot mutations, including
  DELETE requests.

Use the revision returned by the most recent project read or mutation. A
successful editor mutation increments the project revision and returns the new
value. A stale precondition returns HTTP 409 with code
<code>REVISION_CONFLICT</code> and current revision details.

Because scene and hotspot DELETE operations carry JSON, clients must send
<code>Content-Type: application/json</code> with their DELETE body.

### Idempotency

These routes require a non-empty caller-generated header:

~~~http
Idempotency-Key: 2f40952b-ec36-4696-a57e-90d05f190bf8
~~~

- <code>POST /api/v1/assets/:assetId/complete</code>
- <code>POST /api/v1/assets/:assetId/reprocess</code>
- <code>POST /api/v1/projects/:projectId/publish</code>

Keys are scoped to the authenticated user and operation. Repeating the same key
with the same request payload replays the recorded result without duplicating
jobs, derivatives, or publications. Reusing a key with a different payload
returns HTTP 409. Clients should retain a key across retries caused by timeouts
or ambiguous network failures and use a new key for a new intent.

A publish request that reaches compiler validation and fails records one
non-current <code>publish_failed</code> attempt together with its safe error.
Repeating that identical request with the same key replays the same error and
does not add another publication attempt. Use a new key after correcting the
draft or intentionally starting another publish attempt.

Successful idempotent operation responses include
<code>Idempotency-Replayed: true | false</code>.

### Success envelope

JSON success responses use:

~~~json
{
  "success": true,
  "data": {},
  "message": "Request completed."
}
~~~

<code>data</code> may be an object, collection, or acknowledgement. A binary
media response and a 204 response do not use the JSON envelope.
<code>message</code> is omitted when no acknowledgement text is useful.

### Error envelope

~~~json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "The request contains invalid data.",
    "entityId": "optional-entity-id",
    "path": "optional.editor.path",
    "retryable": false,
    "details": {},
    "requestId": "req_..."
  }
}
~~~

<code>code</code> is stable for clients. <code>message</code> is safe to show to
a user. Validation errors may include an editor-addressable <code>path</code>.
Stack traces, SQL errors, secrets, and raw private storage keys are never
returned.

## Endpoint summary

| Method | Route | Authentication | Preconditions |
| --- | --- | --- | --- |
| GET | <code>/</code> | None | None |
| GET | <code>/health/live</code> | None | None |
| GET | <code>/health/ready</code> | None | None |
| POST | <code>/api/v1/auth/register</code> | None | None |
| POST | <code>/api/v1/auth/login</code> | None | None |
| GET | <code>/api/v1/projects</code> | Bearer | None |
| POST | <code>/api/v1/projects</code> | Bearer | None |
| GET | <code>/api/v1/projects/:projectId</code> | Bearer, owner | None |
| PATCH | <code>/api/v1/projects/:projectId</code> | Bearer, owner | <code>revision</code> |
| POST | <code>/api/v1/projects/:projectId/validate</code> | Bearer, owner | <code>revision</code> |
| POST | <code>/api/v1/projects/:projectId/preview-manifest</code> | Bearer, owner | <code>revision</code> |
| GET | <code>/api/v1/projects/:projectId/scenes</code> | Bearer, owner | None |
| POST | <code>/api/v1/projects/:projectId/scenes</code> | Bearer, owner | <code>projectRevision</code> |
| GET | <code>/api/v1/projects/:projectId/scenes/:sceneId</code> | Bearer, owner | None |
| PATCH | <code>/api/v1/projects/:projectId/scenes/:sceneId</code> | Bearer, owner | <code>projectRevision</code> |
| DELETE | <code>/api/v1/projects/:projectId/scenes/:sceneId</code> | Bearer, owner | <code>projectRevision</code> |
| POST | <code>/api/v1/projects/:projectId/scenes/:sceneId/hotspots</code> | Bearer, owner | <code>projectRevision</code> |
| PATCH | <code>/api/v1/projects/:projectId/scenes/:sceneId/hotspots/:hotspotId</code> | Bearer, owner | <code>projectRevision</code> |
| DELETE | <code>/api/v1/projects/:projectId/scenes/:sceneId/hotspots/:hotspotId</code> | Bearer, owner | <code>projectRevision</code> |
| POST | <code>/api/v1/assets/uploads</code> | Bearer | None |
| PUT | <code>/api/v1/assets/uploads/:uploadSessionId/content</code> | Bearer, owner | Raw body |
| POST | <code>/api/v1/assets/:assetId/complete</code> | Bearer, owner | <code>Idempotency-Key</code> |
| GET | <code>/api/v1/assets/:assetId</code> | Bearer, owner | None |
| POST | <code>/api/v1/assets/:assetId/reprocess</code> | Bearer, owner | <code>Idempotency-Key</code> |
| DELETE | <code>/api/v1/assets/:assetId</code> | Bearer, owner | None |
| POST | <code>/api/v1/projects/:projectId/publish</code> | Bearer, owner | <code>revision</code>, <code>Idempotency-Key</code> |
| GET | <code>/api/v1/projects/:projectId/publications</code> | Bearer, owner | None |
| GET | <code>/view/:slug/manifest</code> | Optional bearer | Visibility policy |
| GET | <code>/api/v1/media/:derivativeId</code> | Optional bearer or signed <code>token</code> | Owner or valid media capability |
| GET | <code>/api/v1/publications/:projectId/:publicationRevision/media/:derivativeId</code> | None | Exact reference in current public publication |
| POST | <code>/api/v1/runtime/events</code> | No creator bearer required | Valid event payload |

## Health

### GET /

Returns service, API, canonical schema, and viewer-integration version metadata.

### GET /health/live

Confirms that the process event loop is running. It does not assert database
availability.

### GET /health/ready

Checks dependencies required to serve traffic: PostgreSQL authentication, the
required migration in <code>SequelizeMeta</code>, the expected base table, and
read/write access to <code>STORAGE_ROOT</code>. A failed dependency returns HTTP
503 with <code>SERVICE_NOT_READY</code> so an orchestrator can remove the
instance from service.

## Authentication

### POST /api/v1/auth/register

Creates an active user and returns an access token.

~~~json
{
  "email": "creator@example.com",
  "password": "a-strong-password",
  "displayName": "Example Creator"
}
~~~

The normalized email address is unique. Password hashes are never returned.

### POST /api/v1/auth/login

~~~json
{
  "email": "creator@example.com",
  "password": "a-strong-password"
}
~~~

Authentication responses contain the safe user DTO and:

~~~json
{
  "accessToken": "eyJ...",
  "tokenType": "Bearer"
}
~~~

Invalid credentials return a generic 401 response that does not reveal whether
an email address exists.

## Projects

Only <code>image360</code> is accepted for project creation in Sprint 01.
Project reads return canonical settings, branding, publication metadata, schema
version, current revision, and timestamps. Project detail may include its scenes
and point hotspots.

### GET /api/v1/projects

Lists projects owned by the current user. Results must never include another
owner's project.

### POST /api/v1/projects

~~~json
{
  "name": "Museum Lobby",
  "type": "image360",
  "settings": {
    "appearance": {
      "theme": "dark",
      "primaryColor": "#203040",
      "backgroundColor": "#101820"
    },
    "navigation": {
      "mouse": true,
      "touch": true,
      "zoom": true,
      "fullscreen": true,
      "keyboard": true
    },
    "information": {
      "title": "Museum lobby",
      "bodyHtml": "<p>Welcome to the museum.</p>",
      "externalUrl": "https://museum.example/"
    }
  },
  "branding": {
    "companyName": "Example Museum",
    "primaryColor": "#203040"
  }
}
~~~

<code>settings</code> and <code>branding</code> are optional. New projects use
the current canonical <code>schemaVersion</code> and begin at revision 1.

### GET /api/v1/projects/:projectId

Returns the current canonical project for its owner.

### PATCH /api/v1/projects/:projectId

~~~json
{
  "revision": 4,
  "name": "Museum Main Lobby",
  "settings": {
    "appearance": {
      "theme": "dark",
      "primaryColor": "#203040"
    },
    "navigation": {
      "zoom": true,
      "fullscreen": true
    }
  },
  "branding": {
    "companyName": "Example Museum",
    "welcomeMessage": "<strong>Welcome</strong>"
  }
}
~~~

Only supplied editable fields change. Rich content is sanitized and external
URLs are validated server-side.

### POST /api/v1/projects/:projectId/validate

~~~json
{
  "revision": 5
}
~~~

Runs schema, reference, capability, media-readiness, content, and URL validation
without publishing.

~~~json
{
  "valid": false,
  "issues": [
    {
      "code": "ASSET_NOT_READY",
      "entityType": "scene",
      "entityId": "asset-id",
      "path": "scenes[0].panoramaAssetId",
      "message": "The panorama is still processing.",
      "retryable": true
    }
  ]
}
~~~

Validation findings are returned as data. A malformed request or stale revision
still uses the normal HTTP error envelope.

### POST /api/v1/projects/:projectId/preview-manifest

~~~json
{
  "revision": 5
}
~~~

Compiles the requested draft revision through the production compiler path. It
does not create a publication or change the current public revision. Each
protected derivative reference contains a short-lived signed
<code>/api/v1/media/:derivativeId?token=...</code> URL and an
<code>expiresAt</code> timestamp. The preview-manifest request itself remains
owner-authenticated; the signed URL is the capability used by the player to
fetch its derivative without forwarding the creator bearer token. An owner
bearer token can also fetch the unscoped derivative route.

## Scenes

Scene writes are canonical and increment the parent project revision.

### GET /api/v1/projects/:projectId/scenes

Returns the owner's scenes ordered by <code>sortOrder</code>.

### POST /api/v1/projects/:projectId/scenes

~~~json
{
  "projectRevision": 5,
  "name": "Lobby",
  "panoramaAssetId": "asset-id",
  "initialView": {
    "headingDegrees": 0,
    "pitchDegrees": 0,
    "horizontalFovDegrees": 90
  },
  "viewLimits": {
    "minPitchDegrees": -70,
    "maxPitchDegrees": 70
  }
}
~~~

The referenced panorama must belong to the project owner. A project may contain
multiple scenes, although Sprint 01's authoring workflow focuses on one primary
scene. The service appends <code>sortOrder</code> and marks the first scene
primary; those fields are not client-editable in Sprint 01. The persistence
schema accepts forward-compatible <code>viewLimits</code>, overlays,
connections, spatial data, and runtime hints, but a nonempty value for any of
those fields returns <code>CAPABILITY_UNSUPPORTED</code> during Sprint 01
validate/preview/publish preflight.

### GET /api/v1/projects/:projectId/scenes/:sceneId

Returns the scene and its hotspots.

### PATCH /api/v1/projects/:projectId/scenes/:sceneId

Accepts <code>projectRevision</code> plus any editable fields shown in the create
request. IDs and <code>projectId</code> are immutable.

### DELETE /api/v1/projects/:projectId/scenes/:sceneId

~~~json
{
  "projectRevision": 6
}
~~~

Deletion is rejected when it would leave invalid canonical references unless
those references are explicitly removed as part of supported behavior.

## Hotspots

Sprint 01 creates point hotspots. Position is a product-level spherical
coordinate expressed in degrees, not renderer yaw/pitch radians.

### POST /api/v1/projects/:projectId/scenes/:sceneId/hotspots

~~~json
{
  "projectRevision": 7,
  "geometry": {
    "kind": "point"
  },
  "position": {
    "coordinateSystem": "spherical_degrees",
    "longitudeDegrees": 42.5,
    "latitudeDegrees": -6.25
  },
  "appearance": {
    "label": "Learn more",
    "emphasis": "normal"
  },
  "content": {
    "title": "Lobby history",
    "tooltip": "Open information",
    "bodyHtml": "<p>Built in 1924.</p>",
    "buttonLabel": "Museum website",
    "externalUrl": "https://museum.example/lobby"
  },
  "action": {
    "kind": "showInformation"
  },
  "visibilityRules": {
    "enabled": true
  }
}
~~~

Rich HTML is allow-list sanitized. Dangerous URL schemes, unauthorized asset
references, and non-point creation geometry are rejected. The service appends
the hotspot's <code>sortOrder</code>. Sprint 01 runtime compilation supports
<code>none</code>, <code>showInformation</code>, and <code>openUrl</code> actions;
persisted <code>openAsset</code> and <code>goToScene</code> actions are reserved
for later runtime capability work and fail Sprint 01 preflight.

### PATCH /api/v1/projects/:projectId/scenes/:sceneId/hotspots/:hotspotId

Accepts <code>projectRevision</code> plus editable hotspot fields. Stable hotspot
and scene IDs do not change.

### DELETE /api/v1/projects/:projectId/scenes/:sceneId/hotspots/:hotspotId

~~~json
{
  "projectRevision": 8
}
~~~

## Assets and uploads

The original upload is immutable. Database records store logical IDs and storage
keys; API clients never provide or receive a trusted local filesystem path.

Supported Sprint 01 inputs are policy-approved JPEG (including the
<code>image/jpg</code> alias), PNG, or WebP images. The backend validates actual
signatures, not only the declared MIME type or filename extension. A
<code>panorama_image</code> must pass panorama geometry and GPano/XMP checks;
ordinary <code>image</code> and <code>logo</code> assets use the general image
inspection path and can supply branding or display-image references.

### POST /api/v1/assets/uploads

~~~json
{
  "projectId": "optional-project-id",
  "mediaType": "panorama_image",
  "filename": "lobby.jpg",
  "mimeType": "image/jpeg",
  "sizeBytes": 12845903,
  "checksumSha256": "optional-lowercase-hex-sha256"
}
~~~

<code>mediaType</code> accepts <code>panorama_image</code>, <code>image</code>, or
<code>logo</code> and defaults to <code>panorama_image</code> when omitted. The
size must be within <code>MAX_IMAGE_UPLOAD_BYTES</code>. If supplied, the project
must belong to the caller.

The response contains a logical asset and an expiring authenticated local upload
target equivalent to:

~~~json
{
  "asset": {
    "id": "asset-id",
    "mediaType": "panorama_image",
    "processingStatus": "uploaded"
  },
  "upload": {
    "sessionId": "session-id",
    "method": "PUT",
    "url": "/api/v1/assets/uploads/session-id/content",
    "headers": {
      "Content-Type": "image/jpeg"
    },
    "expiresAt": "2026-08-24T12:00:00.000Z"
  }
}
~~~

### PUT /api/v1/assets/uploads/:uploadSessionId/content

Send the exact raw bytes declared when creating the session:

~~~http
PUT /api/v1/assets/uploads/session-id/content HTTP/1.1
Authorization: Bearer ACCESS_TOKEN
Content-Type: image/jpeg
Content-Length: 12845903

BINARY IMAGE BYTES
~~~

The session must be pending, unexpired, and owned by the caller. The endpoint
rejects an oversized body and a byte count that differs from the declaration.
It validates the optional checksum and the file signature, declared MIME type,
and filename extension, then stores the original under an immutable private key.
Successful upload returns:

~~~json
{
  "uploadSessionId": "session-id",
  "assetId": "asset-id",
  "status": "uploaded"
}
~~~

Uploading bytes alone does not enqueue processing; call complete next.

### POST /api/v1/assets/:assetId/complete

~~~http
Idempotency-Key: complete-session-id-v1
~~~

~~~json
{
  "uploadSessionId": "session-id"
}
~~~

Completion verifies ownership and the session/asset association, requires the
session to be uploaded, then durably enqueues media inspection. It returns HTTP
202 when work is queued. Retrying the same request does not enqueue duplicate
jobs.

### GET /api/v1/assets/:assetId

Returns owner-visible source metadata, processing state, safe failure
diagnostics, inspection metadata, and the derivative catalog. It does not expose
raw local storage paths.

Terminal processing states are <code>ready</code> and <code>failed</code>.
Non-terminal states are <code>uploaded</code>, <code>inspecting</code>, and
<code>processing</code>.

Ready Sprint 01 assets include:

- <code>thumbnail</code>
- <code>lowResolutionBase</code>
- <code>standardWeb</code>

### POST /api/v1/assets/:assetId/reprocess

Requires <code>Idempotency-Key</code>. No request body is required beyond an
optional empty JSON object. Reprocessing preserves the logical asset ID and
creates a new, cache-safe derivative version.

### DELETE /api/v1/assets/:assetId

Deletes an owner-controlled logical asset only when reference and publication
integrity rules permit it. Only <code>ready</code> or <code>failed</code> assets
without an active media job are eligible. Draft project/scenes/hotspots and all
published or retired manifest references are checked transactionally before the
catalog rows are removed. The service never deletes another owner's asset.

The logical delete and its physical-cleanup intents commit together. Original
and derivative storage keys are placed in a durable deletion outbox; temporary
storage failure does not change the successful logical-delete response and is
retried idempotently by the worker.

## Publishing

### POST /api/v1/projects/:projectId/publish

Requires <code>Idempotency-Key</code>.

~~~json
{
  "revision": 9,
  "slug": "museum-lobby",
  "visibility": "public"
}
~~~

Sprint 01 publishing accepts <code>public</code> or <code>private</code>
visibility. Publishing validates and compiles an immutable manifest,
creates an immutable publication revision, and atomically changes the project's
current successful publication. A compiler-validation failure creates one
non-current <code>publish_failed</code> history row with safe diagnostics; a
persistence failure rolls back its transaction. Neither kind of failure changes
the previous successful current publication. Replaying a compiler failure with
the same idempotency key returns the stored error without creating another
history row.

The response includes publication metadata and stable share targets:

~~~json
{
  "publication": {
    "id": "publication-id",
    "publicationRevision": 3,
    "projectRevision": 9,
    "slug": "museum-lobby",
    "visibility": "public",
    "status": "published",
    "manifestVersion": "1",
    "publishedAt": "2026-08-24T12:00:00.000Z"
  },
  "share": {
    "directUrl": "http://localhost:4000/view/museum-lobby",
    "embedUrl": "http://localhost:4000/view/museum-lobby",
    "embedHtml": "<iframe src=\"http://localhost:4000/view/museum-lobby\" loading=\"lazy\" allowfullscreen></iframe>",
    "qrTarget": "http://localhost:4000/view/museum-lobby"
  }
}
~~~

The backend returns a QR target, not a QR bitmap.

The compiled manifest's <code>manifestVersion</code> is the numeric compiler
schema version <code>1</code>. Publication metadata serializes its persisted
version column as the string <code>"1"</code>.

<code>/view/:slug</code> is the player/runtime-shell target owned by the
frontend or deployment reverse proxy. This backend supplies its bootstrap JSON
at <code>/view/:slug/manifest</code>; share targets must not point users directly
at that JSON. In a backend-only local session, the player shell is therefore not
available unless separately routed.

### GET /api/v1/projects/:projectId/publications

Lists immutable publication attempts/revisions for the owner. At most one
successful revision is current. A <code>publish_failed</code> record cannot
replace a prior successful current publication. Failed attempts expose safe
status metadata but never a compiled runtime manifest.

## Published manifests and media

### GET /view/:slug/manifest

Bearer authentication is optional at the middleware level:

- A <code>public</code> manifest resolves by slug.
- In the Sprint 01 MVP, a <code>private</code> manifest resolves only for its
  authenticated owner. Merely knowing the slug is insufficient.

The immutable manifest includes the canonical experience identity, project and
publication revisions, manifest version, viewer integration version, compiled
runtime settings, scenes/hotspots, and logical derivative URLs. Public manifests
contain revision-scoped URLs of the form
<code>/api/v1/publications/:projectId/:publicationRevision/media/:derivativeId</code>.
Private manifests are hydrated at read time with short-lived signed
<code>/api/v1/media/:derivativeId?token=...</code> URLs; the persisted immutable
manifest does not store expiring credentials.
Preview and publish use the same compiler and viewer adapter path. The response
data contains both <code>manifest</code> and safe current
<code>publication</code> metadata.

Public manifest responses use
<code>Cache-Control: public, max-age=0, must-revalidate</code> so a slug is
revalidated when the current publication changes. Private responses use
<code>Cache-Control: private, no-store</code>.

### GET /api/v1/media/:derivativeId

Returns derivative bytes only when one of these conditions holds:

- A bearer token identifies the derivative's owner.
- The <code>token</code> query parameter is a valid, unexpired media token bound
  to that derivative ID.

Preview and private-publication manifests issue these signed URLs. Knowing a
derivative ID alone is not authorization. Protected responses use
<code>Cache-Control: private, no-store</code>. Original uploads are not served
through this endpoint, and this unscoped route never grants anonymous access
merely because a derivative appears in a public manifest.

### GET /api/v1/publications/:projectId/:publicationRevision/media/:derivativeId

Returns anonymous public derivative bytes only when the supplied project,
publication revision, and derivative ID exactly match a compiler-owned media
reference in the current <code>published</code>, <code>public</code>
publication. An arbitrary derivative substitution, a retired revision, or a
project whose current publication is private returns HTTP 403.

The response uses
<code>Cache-Control: public, max-age=60, must-revalidate</code> and an ETag when
a checksum is available. Changing or retiring the current publication revokes
the old route immediately at the origin. A conforming intermediary or browser
may still serve a response already cached during the remaining 60-second
freshness window, so operators must treat 60 seconds as the bounded public-cache
revocation interval.

## Runtime telemetry

### POST /api/v1/runtime/events

The canonical form is a batch:

~~~json
{
  "events": [
    {
      "eventId": "event-uuid",
      "eventName": "first_panorama_visible",
      "experienceId": "project-id",
      "publicationRevision": 3,
      "viewerIntegrationVersion": "psv-5.14.3-adapter-1",
      "sessionId": "privacy-safe-session-id",
      "deviceContext": {
        "class": "desktop"
      },
      "payload": {
        "durationMs": 1450
      },
      "occurredAt": "2026-08-24T12:00:01.000Z"
    }
  ]
}
~~~

For client convenience, a single event object is also accepted. Baseline event
names are:

- <code>experience_load_started</code>
- <code>first_panorama_visible</code>
- <code>time_to_interactive</code>
- <code>hotspot_clicked</code>
- <code>asset_failed</code>
- <code>viewer_error</code>
- <code>experience_exited</code>

The schema also reserves later runtime event names such as
<code>scene_changed</code>. Duplicate <code>eventId</code> delivery is safe.
Clients must never block playback on telemetry delivery and may treat an
accepted response as fire-and-forget.

## HTTP status and error guidance

| Status | Typical meaning |
| --- | --- |
| 200 | Successful read, replay, validation, preview, or synchronous mutation. |
| 201 | Resource or publication created. |
| 202 | Media processing or telemetry accepted asynchronously. |
| 204 | Successful operation with no JSON body. |
| 400 | Malformed syntax or required protocol header missing. |
| 401 | Missing, invalid, or expired bearer token. |
| 403 | Authenticated caller is not allowed by visibility policy. |
| 404 | Route/resource not found or not safely disclosable. |
| 409 | Revision, slug, reference, immutable-object, or idempotency conflict. |
| 413 | Upload exceeds the configured byte limit. |
| 415 | Unsupported or mismatched media type/signature. |
| 422 | Structurally valid request or image that fails domain validation. |
| 429 | Rate limit exceeded. |
| 500 | Safe unexpected error; inspect structured logs by request ID. |
| 503 | Readiness dependency unavailable. |

Representative stable error codes include
<code>AUTHENTICATION_REQUIRED</code>, <code>INVALID_ACCESS_TOKEN</code>,
<code>VALIDATION_FAILED</code>, <code>REVISION_CONFLICT</code>,
<code>IDEMPOTENCY_KEY_REQUIRED</code>, <code>IDEMPOTENCY_KEY_REUSED</code>,
<code>REQUEST_IN_PROGRESS</code>,
<code>UPLOAD_TOO_LARGE</code>, <code>UPLOAD_SESSION_EXPIRED</code>,
<code>UPLOAD_MIME_MISMATCH</code>, <code>ASSET_NOT_READY</code>,
<code>SLUG_ALREADY_EXISTS</code>, and <code>ROUTE_NOT_FOUND</code>. Treat the
server-provided code as authoritative.
