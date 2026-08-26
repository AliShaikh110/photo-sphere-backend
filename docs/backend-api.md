# Backend API — Sprints 01–04

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
| POST | <code>/api/v1/projects/:projectId/scenes/reorder</code> | Bearer, owner | <code>projectRevision</code> |
| GET | <code>/api/v1/projects/:projectId/scenes/:sceneId</code> | Bearer, owner | None |
| PATCH | <code>/api/v1/projects/:projectId/scenes/:sceneId</code> | Bearer, owner | <code>projectRevision</code> |
| DELETE | <code>/api/v1/projects/:projectId/scenes/:sceneId</code> | Bearer, owner | <code>projectRevision</code> |
| POST | <code>/api/v1/projects/:projectId/scenes/:sceneId/hotspots</code> | Bearer, owner | <code>projectRevision</code> |
| PATCH | <code>/api/v1/projects/:projectId/scenes/:sceneId/hotspots/:hotspotId</code> | Bearer, owner | <code>projectRevision</code> |
| DELETE | <code>/api/v1/projects/:projectId/scenes/:sceneId/hotspots/:hotspotId</code> | Bearer, owner | <code>projectRevision</code> |
| GET | <code>/api/v1/projects/:projectId/timeline</code> | Bearer, owner | <code>video360</code> project |
| PATCH | <code>/api/v1/projects/:projectId/timeline</code> | Bearer, owner | <code>projectRevision</code> |
| POST | <code>/api/v1/projects/:projectId/timeline/interactions</code> | Bearer, owner | <code>projectRevision</code> |
| PATCH | <code>/api/v1/projects/:projectId/timeline/interactions/:interactionId</code> | Bearer, owner | <code>projectRevision</code> |
| DELETE | <code>/api/v1/projects/:projectId/timeline/interactions/:interactionId</code> | Bearer, owner | <code>projectRevision</code> |
| POST | <code>/api/v1/projects/:projectId/timeline/interactions/:interactionId/duplicate</code> | Bearer, owner | <code>projectRevision</code> |
| POST | <code>/api/v1/assets/uploads</code> | Bearer | None |
| PUT | <code>/api/v1/assets/uploads/:uploadSessionId/content</code> | Bearer, owner | Raw body |
| POST | <code>/api/v1/assets/:assetId/complete</code> | Bearer, owner | <code>Idempotency-Key</code> |
| GET | <code>/api/v1/assets/:assetId</code> | Bearer, owner | None |
| POST | <code>/api/v1/assets/:assetId/reprocess</code> | Bearer, owner | <code>Idempotency-Key</code> |
| DELETE | <code>/api/v1/assets/:assetId</code> | Bearer, owner | None |
| POST | <code>/api/v1/projects/:projectId/publish</code> | Bearer, owner | <code>revision</code>, <code>Idempotency-Key</code> |
| GET | <code>/api/v1/projects/:projectId/publications</code> | Bearer, owner | None |
| GET | <code>/view/:slug/manifest</code> | Optional bearer | Visibility policy |
| POST | <code>/view/:slug/playback-profile</code> | Optional bearer | Visibility policy, <code>video360</code> publication |
| GET | <code>/view/:slug/scenes/:sceneId</code> | Optional bearer | Visibility policy, scene present in the current published revision |
| GET | <code>/view/:slug/revisions/:publicationRevision/scenes/:sceneId</code> | Optional bearer | Visibility policy, scene present in that revision |
| GET | <code>/view/:slug/revisions/:publicationRevision/scene-index</code> | Optional bearer | Visibility policy |
| GET | <code>/api/v1/media/:derivativeId</code> | Optional bearer or signed <code>token</code> | Owner or valid media capability |
| GET | <code>/api/v1/publications/:projectId/:publicationRevision/media/:derivativeId</code> | None | Exact reference in current public publication |
| POST | <code>/api/v1/runtime/events</code> | Ingest session token, or a creator bearer with project access | Valid event payload scoped to the authorized publication |

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

Project creation accepts <code>image360</code> and <code>video360</code>. The
type is immutable after creation. Project reads return canonical settings,
branding, publication metadata, schema version, current revision, and
timestamps. An <code>image360</code> project detail includes its scenes and
point hotspots; a <code>video360</code> project detail includes
<code>videoAssetId</code>, <code>videoSettings</code>, and its
<code>timeline</code>.

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

A <code>video360</code> project additionally accepts <code>videoSettings</code>
at creation and on update:

~~~json
{
  "type": "video360",
  "name": "Harbour Tour",
  "videoSettings": {
    "autoplay": true,
    "loop": false,
    "muted": true,
    "showControls": true,
    "showTimeline": true,
    "startAtMs": 0,
    "qualityPreference": "automatic"
  }
}
~~~

These are product-level playback preferences. Codecs, bitrate ladders and
container choices are never project data: the media pipeline decides which
playback profiles exist, and the runtime chooses among them.

<code>PATCH /api/v1/projects/:projectId</code> assigns the primary video with
<code>videoAssetId</code>. The asset must be a <code>video360</code> asset owned
by the caller and available to the project; otherwise the request returns
<code>422 INVALID_ASSET_REFERENCE</code>. Sending <code>videoAssetId</code> or
<code>videoSettings</code> to an <code>image360</code> project returns
<code>422 PROJECT_TYPE_MISMATCH</code>.

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

## 360 video timeline

Timelines exist only on <code>video360</code> projects. A request against an
<code>image360</code> project returns <code>422 TIMELINE_NOT_AVAILABLE</code>,
and scene routes on a <code>video360</code> project return
<code>422 PROJECT_TYPE_MISMATCH</code>.

Timeline routes use the same project access decision as every other
project-scoped resource: ownership, workspace membership and per-project grants
all resolve through the shared role model. Reads require <code>viewer</code> and
writes require <code>editor</code>; an insufficient role returns
<code>403 PROJECT_ACCESS_DENIED</code>, while a caller with no access at all
returns <code>404</code> so the route is not a project-discovery oracle.

Timed interactions are product entities. Timestamps are plain milliseconds on
the media timeline and are validated against the inspected duration of the
project's video asset, so the project must already reference a ready video:

| Condition | Error |
| --- | --- |
| No video assigned | <code>422 VIDEO_ASSET_NOT_ASSIGNED</code> |
| Video still processing | <code>409 VIDEO_ASSET_NOT_READY</code> (retryable) |
| Duration not yet inspected | <code>409 VIDEO_DURATION_UNKNOWN</code> (retryable) |
| Time outside the video | <code>422 TIMELINE_TIME_OUT_OF_RANGE</code> |
| Referenced media missing or not ready | <code>422 TIMELINE_REFERENCE_INVALID</code> |
| Payload incomplete for the chosen kind | <code>422 TIMELINE_PAYLOAD_INVALID</code> |

### GET /api/v1/projects/:projectId/timeline

Returns the timeline in a total, deterministic order (time, then the canonical
<code>sortOrder</code>, then ID) together with the media duration. Preview and
published manifests carry <code>sortOrder</code> and apply the same ordering, so
the sequence a creator sees in the editor is the sequence visitors get:

~~~json
{
  "timeline": {
    "projectId": "project-id",
    "projectRevision": 7,
    "videoAssetId": "asset-id",
    "durationMs": 154000,
    "interactions": []
  }
}
~~~

<code>durationMs</code> is <code>null</code> while the video is still being
prepared; the timeline stays readable in that state.

### POST /api/v1/projects/:projectId/timeline/interactions

~~~json
{
  "projectRevision": 7,
  "kind": "information",
  "timeMs": 80000,
  "endTimeMs": 86000,
  "content": { "title": "Engine room", "bodyHtml": "<p>Take a closer look</p>" },
  "visibilityRules": { "enabled": true, "pauseVideoWhenShown": true }
}
~~~

<code>kind</code> is one of <code>information</code>, <code>hotspot</code>,
<code>viewpoint</code>, <code>image</code>, <code>video</code>,
<code>link</code>, or <code>cta</code>. These are product terms, not renderer
event or plugin names. Each kind carries its own required payload:

| Kind | Required payload |
| --- | --- |
| <code>information</code> | <code>content</code> |
| <code>hotspot</code> | <code>position</code> (point geometry) |
| <code>viewpoint</code> | <code>viewpoint.headingDegrees</code> and <code>viewpoint.pitchDegrees</code> |
| <code>image</code> | <code>content.imageAssetId</code> |
| <code>video</code> | <code>content.videoAssetId</code> |
| <code>link</code> | <code>action.kind = "openUrl"</code> |
| <code>cta</code> | <code>content.ctaLabel</code> or an <code>openUrl</code> action |

<code>action</code> accepts <code>none</code>, <code>showInformation</code>,
<code>openUrl</code>, <code>openAsset</code>, or <code>setViewpoint</code>.
Changing an interaction's kind clears payload sections that do not belong to the
new kind, so an interaction never retains incompatible fields.

Rich text, tooltips, button labels and every URL pass through the same
sanitizer and URL policy used by scene hotspots.

### PATCH /api/v1/projects/:projectId/timeline/interactions/:interactionId

Accepts the same fields as creation, all optional except
<code>projectRevision</code>. Moving an interaction is a <code>timeMs</code>
update.

### DELETE /api/v1/projects/:projectId/timeline/interactions/:interactionId

Body: <code>{ "projectRevision": 7 }</code>.

### POST /api/v1/projects/:projectId/timeline/interactions/:interactionId/duplicate

~~~json
{ "projectRevision": 7, "timeMs": 92000 }
~~~

The duplicate always receives a new stable ID. Omitting <code>timeMs</code>
copies the source timestamp; supplying one shifts any <code>endTimeMs</code> by
the same amount, clamped to the media duration.

### PATCH /api/v1/projects/:projectId/timeline

Atomic multi-move for drag-heavy editing:

~~~json
{
  "projectRevision": 7,
  "interactions": [
    { "id": "interaction-a", "timeMs": 4200 },
    { "id": "interaction-b", "timeMs": 51000, "endTimeMs": 56000 }
  ]
}
~~~

Every entry is validated before any row is written. A rejected batch leaves the
timeline and the project revision unchanged.

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

<code>initialView</code> is optional. When it is omitted or empty and the
panorama's XMP records the framing its camera captured
(<code>GPano:InitialViewHeadingDegrees</code>,
<code>InitialViewPitchDegrees</code>, <code>InitialHorizontalFOVDegrees</code>),
the scene is created with that framing, so a creator gets a sensible first view
without typing an angle. A supplied <code>initialView</code> always wins. A
captured field-of-view outside the canonical 30-120 degree range is ignored as a
capture artefact.

The referenced panorama must belong to the project owner, and several scenes may
reuse one logical panorama asset. The service appends <code>sortOrder</code> and
marks the first scene primary; those fields are not set directly by the client,
and <code>sortOrder</code> is changed through the reorder route below.

<code>viewLimits</code>, <code>connections</code>, <code>spatialData</code> and
<code>runtimeHints</code> are canonical product fields. A connection names a
<code>targetSceneId</code> in the same project and may carry a
<code>triggerHotspotId</code> belonging to the source scene, a
<code>label</code>, <code>content</code>, an <code>importance</code> from 0
through 100, and a <code>preloadHint</code> of <code>none</code>,
<code>normal</code> or <code>high</code>. Importance and preload hints are
product-level hints the platform's preload policy weighs; they are not cache or
network commands. Supplying <code>connections</code> in a scene update replaces
that scene's connection set, retaining any connection whose <code>id</code> is
resent. A connection to a scene outside the project, or to the scene itself, is
rejected with <code>422 INVALID_SCENE_REFERENCE</code>.

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

A scene that is still referenced cannot be deleted silently. The response is
<code>409 SCENE_IN_USE</code> and lists every reference the creator must resolve
first: inbound scene connections, hotspot actions that navigate to the scene,
and runtime hints naming it as a likely next scene.

~~~json
{
  "error": {
    "code": "SCENE_IN_USE",
    "message": "Remove the listed scene references before deleting this scene.",
    "details": {
      "sceneId": "scene-id",
      "references": [
        { "type": "sceneConnection", "id": "connection-id", "sourceSceneId": "scene-id" },
        { "type": "hotspotAction", "id": "hotspot-id", "sourceSceneId": "scene-id", "path": "action.sceneId" },
        { "type": "runtimeHint", "sourceSceneId": "scene-id", "path": "runtimeHints.likelyNextSceneIds[0]" }
      ]
    }
  }
}
~~~

### POST /api/v1/projects/:projectId/scenes/reorder

Reorders the project's scenes. The request must list every scene in the project
exactly once; a partial or padded list is rejected with
<code>422 INVALID_SCENE_ORDER</code> naming the missing and unknown IDs.

~~~json
{
  "projectRevision": 9,
  "sceneIds": ["scene-c", "scene-a", "scene-b"]
}
~~~

Reordering rewrites <code>sortOrder</code> only. Scene IDs are stable across a
reorder, so connections, hotspot actions, published revisions and analytics
continue to resolve. The response returns the reordered scenes with their
hotspots, overlays and connections, plus the new <code>projectRevision</code>.

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

Supported image inputs are policy-approved JPEG (including the
<code>image/jpg</code> alias), PNG, or WebP. Supported video inputs are MP4 and
WebM. The backend validates actual signatures, not only the declared MIME type
or filename extension. A <code>panorama_image</code> must pass panorama geometry
and GPano/XMP checks; ordinary <code>image</code> and <code>logo</code> assets
use the general image inspection path and can supply branding or display-image
references. A <code>video360</code> asset must be recognisable as 360 content,
either from Spherical Video V2 / GSpherical container metadata or from a 2:1
equirectangular shape.

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

<code>mediaType</code> accepts <code>panorama_image</code>, <code>image</code>,
<code>logo</code>, <code>video360</code>, or <code>video</code> and defaults to
<code>panorama_image</code> when omitted. The declared media type and file type
must agree. Image uploads must be within <code>MAX_IMAGE_UPLOAD_BYTES</code> and
video uploads within <code>MAX_VIDEO_UPLOAD_BYTES</code>. If supplied, the
project must belong to the caller.

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

Ready image assets include the <code>thumbnail</code>,
<code>lowResolutionBase</code> and <code>standardWeb</code> derivatives, plus
<code>tiledLevels</code> when the tiling policy applies. Ready video assets
include a <code>videoPoster</code> and at least one playback profile:
<code>desktopVideoProfile</code>, <code>mobileVideoProfile</code>, or both.

Every asset exposes <code>processingStages</code>, the per-stage record of its
last media job. A panorama or image reports <code>inspect</code>,
<code>derivatives</code>, then one stage per generated derivative
(<code>thumbnail</code>, <code>lowResolutionBase</code>,
<code>standardWeb</code>, and <code>tiledLevels</code> when the tiling policy
applies), then <code>finalize</code>. A video reports <code>inspect</code>,
<code>poster</code>, <code>transcodeDesktop</code>,
<code>transcodeMobile</code> and <code>finalize</code>. A stage that failed
names its stable failure category, so one derivative that could not be produced
is diagnosable without inferring it from the job's overall status. Only the most
recent job is reported: a successful reprocess replaces the stage record of the
job it supersedes. One playback profile can fail without discarding the
others: the asset still becomes <code>ready</code> as long as at least one
publishable profile exists, and <code>metadata.unavailablePlaybackProfiles</code>
names what could not be produced and why. If no publishable profile exists the
asset becomes <code>failed</code> with a <code>VIDEO_PROFILE_UNAVAILABLE</code>
diagnosis.

<code>metadata</code> on a ready video asset carries the inspected facts used by
compiler policy and internal diagnostics: container, codec, width, height,
<code>durationMs</code>, <code>frameRate</code>, bitrate, audio presence and
codec, rotation, stereo mode, and derived compatibility flags. Transcoder vendor
settings are never stored here or on the project; they live in processing
diagnostics.

### POST /api/v1/assets/:assetId/reprocess

An optional body regenerates only the named playback profiles of a video asset:

~~~json
{ "profiles": ["mobile"] }
~~~

<code>profiles</code> accepts <code>poster</code>, <code>desktop</code>, and
<code>mobile</code>. A targeted reprocess writes new derivative versions for the
named profiles only; the logical asset ID and the untouched profiles keep their
existing identity and version. Supplying <code>profiles</code> for a non-video
asset returns <code>422 REPROCESS_TARGET_NOT_SUPPORTED</code>.


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
    "manifestVersion": "4",
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
schema version <code>4</code>. Publication metadata serializes its persisted
version column as the string <code>"4"</code>.

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
runtime settings, and logical derivative URLs. <code>experienceType</code>
discriminates the payload: an <code>image360</code> manifest carries
<code>scenes</code> and <code>tour</code>, while a <code>video360</code> manifest
carries <code>video</code> and <code>timeline</code> instead. Public manifests
contain revision-scoped URLs of the form
<code>/api/v1/publications/:projectId/:publicationRevision/media/:derivativeId</code>.
Private manifests are hydrated at read time with short-lived signed
<code>/api/v1/media/:derivativeId?token=...</code> URLs; the persisted immutable
manifest does not store expiring credentials. <code>telemetry.ingestToken</code>
is issued the same way, for the same reason.

A scene whose panorama recorded a tilted capture pose
(<code>GPano:PoseHeadingDegrees</code>, <code>PosePitchDegrees</code>,
<code>PoseRollDegrees</code>) carries
<code>panorama.sphereCorrection</code>, stated in product degrees. A level
panorama carries no correction at all. The renderer receives the inverse of
that pose, in radians, only through the viewer integration adapter output; the
canonical scene and the manifest scene never speak renderer vocabulary.
Preview and publish use the same compiler and viewer adapter path. The response
data contains both <code>manifest</code> and safe current
<code>publication</code> metadata.

Public manifest responses use
<code>Cache-Control: public, max-age=0, must-revalidate</code> so a slug is
revalidated when the current publication changes. Private responses use
<code>Cache-Control: private, no-store</code>.

### POST /view/:slug/playback-profile

Optional server-side playback profile selection for <code>video360</code>
publications. It applies the same visibility policy as the manifest route.

~~~json
{
  "handheld": true,
  "viewportClass": "constrained",
  "maxTextureSize": 4096,
  "networkClass": "constrained",
  "supportedMimeTypes": ["video/mp4"],
  "dataSaver": false
}
~~~

Every field is optional. The response returns the chosen profile, the reason for
the decision, the rejected candidates, and the ordered candidate IDs:

~~~json
{
  "experienceId": "project-id",
  "publicationRevision": 3,
  "selection": {
    "policyVersion": 1,
    "reason": "handheld-width-constraint",
    "rejected": [{ "profileId": "desktop", "reason": "exceeds-handheld-width" }],
    "selected": { "profileId": "mobile", "media": {}, "constraints": {} },
    "candidateProfileIds": ["mobile"]
  }
}
~~~

The published manifest already contains the same ordered candidates under
<code>video.profiles</code>, handheld-safe first, so a player that selects
locally never needs this call. When no published profile is compatible with the
supplied device facts the endpoint returns
<code>422 VIDEO_PLAYBACK_CAPABILITY_UNSUPPORTED</code> rather than offering an
unsupported source. Responses use <code>Cache-Control: private, no-store</code>
because the decision is caller-specific.

### GET /view/:slug/scenes/:sceneId

Returns one compiled, immutable scene definition from the publication a slug
currently resolves to. It is how a large tour loads a scene the initial manifest
did not carry inline.

The route reads published data only. A draft edit made after publication is
never visible here; it becomes visible when the project is published again,
under a new publication revision.

~~~json
{
  "success": true,
  "data": {
    "sceneDefinition": {
      "sceneDefinitionVersion": 2,
      "experienceId": "project-id",
      "publicationRevision": 3,
      "viewerIntegrationVersion": "psv-5.14.3-adapter-2",
      "scene": { "id": "scene-id", "name": "Lobby", "panorama": {}, "hotspots": [], "preloadSceneIds": [] },
      "viewerIntegration": { "rendererId": "photo-sphere-viewer", "config": {} }
    }
  }
}
~~~

Visibility policy matches the manifest route: a private publication resolves
only for a caller authorized on the project, so knowing a slug and a scene ID is
not sufficient. A scene ID that is not part of the resolved publication returns
<code>404</code>, whether or not it exists as a draft scene.

Responses carry <code>Cache-Control: public, max-age=0, must-revalidate</code>
plus a checksum <code>ETag</code>, because the slug's current revision can
change. Private responses use <code>Cache-Control: private, no-store</code>.

### GET /view/:slug/revisions/:publicationRevision/scenes/:sceneId

The revision-pinned form of the route above. It resolves the named publication
revision rather than whichever revision is current, including a retired one, and
returns exactly the same payload.

Because a published revision is immutable, public responses here use
<code>Cache-Control: public, max-age=31536000, immutable</code> and are safe to
cache at a CDN. The compiler emits this form in the manifest's
<code>tour.sceneDefinitionUrlTemplate</code> for progressive tours.

### GET /view/:slug/revisions/:publicationRevision/scene-index

Returns the lightweight scene index of a published revision, in pages. A tour
whose index is too large to ship inside the initial manifest carries only its
first segment there, along with <code>tour.sceneIndexUrl</code> and
<code>tour.sceneIndexSegmentSize</code>, and pages the rest from this route.

Query parameters <code>offset</code> and <code>limit</code> are optional;
<code>limit</code> is capped at 250 entries.

~~~json
{
  "success": true,
  "data": {
    "sceneIndexVersion": "scene-index-2-3",
    "entries": [
      {
        "id": "scene-id",
        "name": "Lobby",
        "sortOrder": 0,
        "isPrimary": true,
        "panoramaAssetId": "asset-id",
        "thumbnail": { "derivativeId": "derivative-id", "url": "" },
        "hasHotspots": true,
        "hasOverlays": false,
        "connectionTargetSceneIds": ["scene-id"]
      }
    ],
    "page": { "offset": 0, "limit": 250, "total": 120 }
  }
}
~~~

An index entry carries only what a gallery or scene list needs to draw itself:
no hotspots, no overlays and no panorama body. Its <code>thumbnail</code> is the
asset's small thumbnail derivative, not the larger low-resolution base the scene
itself renders from, so a 100-scene index stays inexpensive. An asset whose
catalog has no ready thumbnail falls back to that base image.

Because the route is revision-pinned it is immutable, and public responses use
<code>Cache-Control: public, max-age=31536000, immutable</code>. It applies the
same visibility policy as the manifest and scene-definition routes.

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

Requires authorization. A visitor presents the ingest token issued alongside the
experience manifest in the <code>X-Telemetry-Token</code> header:

~~~http
POST /api/v1/runtime/events
X-Telemetry-Token: <manifest.telemetry.ingestToken>
~~~

The token is scoped to one experience, publication revision and viewer
integration version. Every event in the batch must match that scope; one event
outside it rejects the whole batch with
<code>403 TELEMETRY_SCOPE_MISMATCH</code>. A missing token returns
<code>401 TELEMETRY_TOKEN_REQUIRED</code> and an invalid or expired one returns
<code>401 TELEMETRY_TOKEN_INVALID</code>.

A published manifest hands every visitor its experience ID, publication revision
and viewer integration version, so those fields alone cannot establish that an
event came from a real playback session. The token is what ingestion trusts.
It is minted per manifest read rather than stored in the immutable manifest, so
it expires on its own schedule (<code>TELEMETRY_TOKEN_TTL_SECONDS</code>, six
hours by default) and its expiry is returned as
<code>telemetry.ingestTokenExpiresAt</code>.

A signed-in creator with at least viewer access to the project may report
without a session token, using the normal <code>Authorization</code> bearer.
That path covers preview sessions and replaying a diagnostic session.

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
- <code>scene_changed</code>
- <code>scene_transition_failed</code>
- <code>hotspot_clicked</code>
- <code>asset_failed</code>
- <code>viewer_error</code>
- <code>experience_exited</code>

360 video experiences add:

- <code>video_started</code> and <code>video_stalled</code> (required for
  playback engagement and reliability reporting)
- <code>video_paused</code>, <code>video_resumed</code>,
  <code>video_seeked</code>, <code>video_ended</code>
- <code>video_profile_selected</code> — requires <code>assetId</code>,
  <code>derivativeId</code> and <code>profileId</code>
- <code>video_playback_failed</code> — requires <code>assetId</code> and a
  <code>failureCategory</code> of <code>profile_unavailable</code>,
  <code>media_unavailable</code>, <code>decode_failed</code>,
  <code>codec_unsupported</code>, <code>network_error</code>,
  <code>autoplay_blocked</code>, <code>viewer_error</code>, or
  <code>unknown</code>
- <code>timeline_interaction_shown</code> and
  <code>timeline_interaction_clicked</code> — require
  <code>interactionId</code> and <code>kind</code>

Every event carries the experience ID, publication revision and viewer
integration version, so playback and profile-selection problems can be traced to
a specific published revision and renderer integration. Duplicate
<code>eventId</code> delivery is safe.
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
