# Sprint 01 — Backend Foundation, Image Ingestion & Publishable MVP

> **Execution target:** Backend implementation for the No-Code 360° Experience Platform  
> **Source basis:** Product/Architecture/Runtime Specification Revision 2.0 + Frontend/Backend PRD  
> **Implementation style:** Stack-agnostic. Claude Code must use the repository's existing language, framework, ORM, job system, storage provider, and testing conventions unless the repository explicitly requires a new component.
>
> **Architecture rule:** Persist the platform's canonical Experience model. Never make Photo Sphere Viewer configuration the database model. Renderer-specific configuration is generated through the Experience Compiler / Viewer Integration Adapter.


## 1. Sprint Objective

Build the complete backend foundation required for a production-capable **360° image experience**:

**Authenticate → Create project → Upload panorama → Inspect/process media → Edit canonical Experience data → Preview → Publish → Share**

At the end of this sprint, the backend must support a usable Phase-1 image workflow without storing renderer-specific configuration.

## 2. Outcomes Required

By sprint completion:

- Authenticated users can create and manage `image360` projects.
- Projects use a versioned canonical Experience schema.
- Panorama uploads create logical assets and asynchronous processing jobs.
- The system extracts image metadata/XMP where available and generates baseline derivatives.
- Assets expose explicit processing states: `uploaded → inspecting → processing → ready | failed`.
- Point hotspots, information content, appearance, branding, and base navigation settings can be persisted.
- Draft projects can be validated and compiled into protected preview manifests.
- Publishing is atomic and creates immutable published revisions.
- Published experiences can be resolved by slug with public/private access enforcement.
- Share metadata supports direct URL, embed target, and QR target generation.
- Rich authored content and URLs are sanitized/validated server-side.
- Basic runtime telemetry ingestion exists.
- All critical mutations are safe for retries and concurrent editing.

## 3. Non-Negotiable Architecture Constraints

1. Do not persist raw Photo Sphere Viewer config as canonical project data.
2. Every project must carry `schemaVersion`.
3. Cross-entity references use stable IDs, never display names or transient CDN/upload URLs.
4. Logical assets remain stable while derivatives may be regenerated/versioned.
5. Long-running media work is asynchronous.
6. A failed media job cannot corrupt the project or source asset.
7. Publish must preserve the previous successful public revision if a new publish fails.
8. Server-side authorization, sanitization, URL validation, and upload validation are mandatory.
9. Preview and publish must use the same compiler path.
10. Viewer/runtime implementation details belong behind a versioned integration adapter.

## 4. In Scope

### Identity & authorization
- Authenticated user context.
- Project ownership authorization.
- Private publication access check foundation.
- Resource-level authorization middleware/policy.

### Project / Experience API
- Create, list, read, rename, update projects.
- `image360` project type.
- Draft revision/version tracking.
- Optimistic concurrency.
- Settings, branding, scenes, hotspots, information content.
- Validation/preflight endpoint.
- Draft preview-manifest endpoint.

### Asset service
- Upload session creation.
- Upload completion.
- Logical asset records.
- Metadata inspection.
- XMP/cropped panorama metadata extraction where available.
- Image dimensions/aspect ratio/MIME/size inspection.
- 360° detection metadata.
- Thumbnail generation.
- Low-resolution/base derivative.
- Standard web derivative.
- Reprocess/retry path.
- Derivative catalog.

### Publishing
- Slug and visibility.
- Immutable publication revision.
- Atomic publish.
- Published manifest persistence.
- Resolve current successful publication.
- Previous revision protection on failed publish.
- Direct URL / embed / QR target metadata.

### Security
- Rich-text/HTML sanitization.
- URL scheme validation.
- Upload MIME/signature validation.
- Private asset/publication access enforcement foundation.
- Security-safe error responses.

### Observability
- Structured server logs.
- Request/correlation IDs.
- Runtime event ingestion for baseline events.
- Publication revision + integration version attached to runtime errors.

## 5. Out of Scope for Sprint 01

- Multi-scene virtual tours beyond the minimum scene structure needed by one panorama.
- Gallery.
- Large-tour progressive loading.
- Advanced scene preload/cache policy.
- 360° video transcoding/timeline.
- Map/plan.
- Gyroscope/stereo/VR.
- High-resolution tiled panoramas.
- Advanced hotspot geometry.
- Creator-facing analytics dashboards.
- Team collaboration.
- Public API/SDK.

Do not implement these prematurely, but Sprint 01 data contracts must not block them.

## 6. Canonical Domain Model

Implement equivalent entities using the repository's persistence conventions.

### `Project`

Required concepts:

```text
id
ownerId
type = image360 | video360
name
schemaVersion
revision
settings
branding
publication metadata
createdAt
updatedAt
```

For Sprint 01, only `image360` must be creatable.

### `Asset`

```text
id
ownerId
projectId or reusable ownership scope
source reference
mediaType
projection
metadata
processingStatus
processingError
derivatives[]
createdAt
updatedAt
```

### `AssetDerivative`

```text
id
assetId
kind
version
storageKey
mimeType
width
height
sizeBytes
metadata
createdAt
```

Required Sprint-01 derivative kinds:

```text
thumbnail
lowResolutionBase
standardWeb
```

### `Scene`

```text
id
projectId
name
panoramaAssetId
initialView
viewLimits
hotspots[]
overlays[]
connections[]
spatialData
runtimeHints
```

Sprint 01 can support one primary scene in the UI, but the persistence model must already support multiple scenes.

### `Hotspot`

```text
id
sceneId
geometry
position
appearance
content
action
visibilityRules
```

Sprint 01 creation support:

```text
geometry.kind = point
```

Do not design tables/types so that only point geometry can ever exist.

### `Publication`

```text
id
projectId
projectRevision
publicationRevision
slug
visibility
compiledManifestVersion
status
publishedAt
createdAt
```

### Runtime telemetry event

```text
eventId
eventName
experienceId
publicationRevision
viewerIntegrationVersion
sessionId or privacy-safe session reference
device/runtime context
payload
occurredAt
receivedAt
```

## 7. Required State Machines

### Asset processing

```text
uploaded
  ↓
inspecting
  ↓
processing
  ├──→ ready
  └──→ failed

failed → retry/reprocess → inspecting | processing
```

Rules:

- State transitions must be validated.
- Duplicate job delivery must not create duplicate derivatives.
- Failure stores a stable machine-readable category plus safe diagnostics.
- Reprocessing generates cache-safe derivative versions.

### Publication

```text
draft
  ↓
publishing
  ├──→ published
  └──→ publish_failed

published + draft changes
  ↓
publishing
  ├──→ new published revision
  └──→ previous published revision remains active
```

## 8. API Contract to Implement

Use equivalent routes if the repository uses GraphQL/RPC. Preserve semantics.

### Projects

```http
GET    /api/projects
POST   /api/projects
GET    /api/projects/:projectId
PATCH  /api/projects/:projectId
POST   /api/projects/:projectId/validate
POST   /api/projects/:projectId/preview-manifest
```

### Scenes / hotspots

```http
GET    /api/projects/:projectId/scenes
POST   /api/projects/:projectId/scenes
GET    /api/projects/:projectId/scenes/:sceneId
PATCH  /api/projects/:projectId/scenes/:sceneId
DELETE /api/projects/:projectId/scenes/:sceneId

POST   /api/projects/:projectId/scenes/:sceneId/hotspots
PATCH  /api/projects/:projectId/scenes/:sceneId/hotspots/:hotspotId
DELETE /api/projects/:projectId/scenes/:sceneId/hotspots/:hotspotId
```

If hotspots are nested in scene writes in the existing codebase, keep that convention, but preserve stable hotspot IDs and validation.

### Assets

```http
POST   /api/assets/uploads
POST   /api/assets/:assetId/complete
GET    /api/assets/:assetId
POST   /api/assets/:assetId/reprocess
DELETE /api/assets/:assetId
```

### Publishing

```http
POST   /api/projects/:projectId/publish
GET    /api/projects/:projectId/publications
GET    /view/:slug/manifest
```

Optional if already supported:

```http
POST   /api/projects/:projectId/unpublish
```

### Runtime telemetry

```http
POST /api/runtime/events
```

Batch form is preferred if it matches the existing platform.

## 9. Standard Mutation Semantics

All backend mutations must implement:

- Authentication.
- Resource authorization.
- Validation.
- Stable machine-readable errors.
- Idempotency for side-effect-heavy operations:
  - upload completion,
  - reprocess,
  - publish.
- Optimistic concurrency for project/editor writes.
- Audit-friendly timestamps and actor context where infrastructure supports it.

Recommended conflict behavior:

```http
409 CONFLICT
```

with current revision/version metadata.

## 10. Canonical Error Envelope

Implement the repository-equivalent of:

```json
{
  "error": {
    "code": "ASSET_NOT_READY",
    "message": "The panorama is still processing.",
    "entityId": "asset_123",
    "path": "scenes[0].panoramaAssetId",
    "retryable": true,
    "details": {}
  }
}
```

Requirements:

- `code` is stable for clients.
- `message` is safe for users.
- `path` is supplied for editor-fixable validation failures.
- Internal stack traces/secrets are never returned.

## 11. Media Pipeline Tasks

Implement the panorama pipeline:

```text
Original Upload
  ↓
Validate file signature/MIME/policy
  ↓
Inspect dimensions, aspect ratio, metadata
  ↓
Read XMP / panorama metadata when available
  ↓
Detect/record projection and cropped/full-sphere information
  ↓
Normalize orientation metadata if policy requires
  ↓
Generate thumbnail
  ↓
Generate low-resolution base
  ↓
Generate standard web derivative
  ↓
Persist derivative catalog
  ↓
ready
```

### Pipeline requirements

- Original upload is immutable.
- Derived files use versioned/cache-safe storage keys.
- Processing workers are retry-safe.
- Each processing stage emits structured diagnostics.
- Asset can be reprocessed without changing project references.
- Unsupported file types fail before entering `ready`.
- Do not trust filename extensions alone.

## 12. Experience Compiler — Sprint 01

Create the initial compiler boundary:

```text
Canonical Project
  ↓
Schema validation
  ↓
Reference validation
  ↓
Capability preflight
  ↓
Runtime media selection
  ↓
Viewer Integration Adapter
  ↓
Preview/Published Manifest
```

### Compiler responsibilities

- Validate schema version.
- Validate referenced assets exist and are authorized.
- Reject non-ready required assets.
- Validate hotspot actions/content.
- Sanitize publishable authored content.
- Select the appropriate baseline image derivative.
- Produce product runtime settings.
- Emit renderer-specific configuration only through the integration adapter.
- Include `viewerIntegrationVersion`.
- Be deterministic for the same project revision and media derivative set.

## 13. Preview Requirements

`preview-manifest` must:

- Compile the draft revision.
- Use protected asset access.
- Never create a public publication.
- Use the same compiler and capability validation code used by publish.
- Return actionable validation failures with entity/path information.

## 14. Publish Requirements

Publish flow:

```text
authorize
→ acquire/idempotency check
→ load canonical project revision
→ validate
→ compile
→ persist immutable manifest
→ persist publication revision
→ atomically switch current successful publication
→ return share metadata
```

Acceptance rules:

- Publish is atomic for visitors.
- Failed publish cannot replace a healthy current publication.
- Repeated identical publish request with same idempotency key does not duplicate publication side effects.
- Slug uniqueness is enforced according to product scope.
- Private publication does not become accessible through public asset URLs.

## 15. Security Tasks

Implement server-side controls for:

### Rich content
Sanitize, where applicable:

- captions,
- descriptions,
- information panels,
- tooltips,
- custom marker text/content,
- overlay/navigation content.

### URL policy

At minimum:

- allow policy-approved `https` URLs,
- explicitly reject `javascript:` and other dangerous schemes,
- centralize policy in a reusable validator.

### Uploads

- Validate actual file signature/MIME.
- Apply size/type policy from configuration.
- Define safe image/SVG policy.
- Keep malware-scanning integration point if not yet available.

### Private access

- Manifest and private derivatives must require authorized/signed access according to existing auth/storage architecture.

## 16. Baseline Runtime Events

Accept at least:

```text
experience_load_started
first_panorama_visible
time_to_interactive
hotspot_clicked
asset_failed
viewer_error
experience_exited
```

Required event context:

- experience/project ID,
- publication revision,
- viewer integration version,
- event time,
- privacy-safe session identifier,
- useful runtime/device class fields where available.

Do not block playback if telemetry delivery fails.

## 17. Database / Migration Work

Claude Code must:

1. Inspect existing persistence/migration conventions.
2. Add migrations for the required canonical entities.
3. Add indexes for:
   - project owner/list queries,
   - project revision,
   - asset processing status,
   - scene project lookup,
   - publication slug/current status,
   - runtime event experience/revision/time.
4. Add uniqueness constraints where semantically required.
5. Add foreign keys/reference integrity where the current architecture supports them.
6. Keep migrations reversible when repository policy requires reversible migrations.

## 18. Test Plan

### Unit tests
- Experience schema validation.
- Revision conflict detection.
- State machine transition validation.
- URL validator.
- Rich-content sanitizer.
- Derivative selection.
- Compiler validation.
- Publication revision generation.
- Error mapping.

### Integration tests
- Create project → read/update.
- Unauthorized project access denied.
- Upload session → complete → processing status.
- Duplicate upload-complete idempotency.
- Failed media job → reprocess.
- Point hotspot CRUD.
- Preview compile.
- Successful publish.
- Failed republish keeps previous published revision.
- Private publication authorization.
- Runtime event ingestion.

### Media fixtures
Include:

- valid full equirectangular panorama,
- cropped/XMP panorama,
- invalid image payload,
- mismatched extension/MIME,
- oversized/unsupported fixture according to configured policy.

### Security tests
- stored XSS payload rejected/sanitized.
- dangerous URL scheme rejected.
- private manifest unauthorized request denied.
- private asset bypass attempt denied.

## 19. Acceptance Criteria / Sprint Gate

Sprint 01 is complete only when all are true:

- [ ] Authenticated creator can create an `image360` project.
- [ ] Project includes `schemaVersion` and revision/version.
- [ ] Upload creates a logical asset.
- [ ] Asset status progresses through the explicit processing state machine.
- [ ] Thumbnail + low-resolution + standard-web derivative are generated for a supported panorama.
- [ ] Failed processing is retryable without replacing the asset ID.
- [ ] One or more scenes can be represented canonically.
- [ ] Point hotspots can be saved without exposing renderer coordinates as the domain contract.
- [ ] Information content, appearance, branding, and base settings persist.
- [ ] Validation returns field/entity-path errors.
- [ ] Preview compiles through the production compiler path.
- [ ] Publish creates an immutable successful revision.
- [ ] Failed republish leaves previous publication active.
- [ ] Public/private access rules are enforced server-side.
- [ ] Share response includes canonical URL/embed/QR target data.
- [ ] Rich authored content and external URLs are server-validated.
- [ ] Baseline runtime telemetry can be ingested.
- [ ] No canonical table/document requires raw PSV adapter/plugin configuration.
- [ ] Unit/integration/security tests pass.
- [ ] API and schema documentation is updated.

## 20. Claude Code Execution Order

Use this order unless repository dependencies require a small adjustment:

1. Inspect repository architecture, conventions, auth, storage, jobs, migrations, testing.
2. Define canonical schema/types and migrations.
3. Implement project repository/service/API.
4. Implement asset domain/state machine/upload session.
5. Implement media inspection/derivative job pipeline.
6. Implement scenes/hotspots/content persistence.
7. Implement sanitizer + URL/file validation shared services.
8. Implement compiler + viewer integration adapter interface.
9. Implement preview manifest.
10. Implement publication model and atomic publish.
11. Implement public/private manifest delivery.
12. Implement telemetry ingestion.
13. Add full tests and fixtures.
14. Run lint/typecheck/tests/migrations.
15. Update backend API/schema/runbook documentation.

## 21. Claude Code Guardrails

- Do not replace the existing stack solely because another stack is preferred.
- Do not implement frontend UI.
- Do not introduce renderer config into canonical persistence.
- Do not hide async media processing behind long HTTP requests.
- Do not silently overwrite concurrent project edits.
- Do not make publish destructive.
- Do not expose raw internal storage URLs for private media.
- Do not skip tests for idempotency, authorization, or failed publish behavior.
