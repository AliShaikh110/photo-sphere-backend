# Sprint 04 — Advanced Immersive/Spatial Capabilities, Analytics & Scale Readiness

> **Execution target:** Backend implementation for the No-Code 360° Experience Platform  
> **Source basis:** Product/Architecture/Runtime Specification Revision 2.0 + Frontend/Backend PRD  
> **Implementation style:** Stack-agnostic. Claude Code must use the repository's existing language, framework, ORM, job system, storage provider, and testing conventions unless the repository explicitly requires a new component.
>
> **Architecture rule:** Persist the platform's canonical Experience model. Never make Photo Sphere Viewer configuration the database model. Renderer-specific configuration is generated through the Experience Compiler / Viewer Integration Adapter.


## 1. Sprint Objective

Complete the backend architecture for the platform's advanced capability set: **map/plan and spatial data, gyroscope/stereo/VR resolution, advanced overlays and geometry, templates, creator analytics, collaboration/access controls, enterprise-scale media/runtime foundations, API/versioning, and observability hardening**.

This sprint consolidates the architecture's advanced and professional-scale backend requirements so the four-sprint plan covers the full platform direction rather than ending at the MVP.

## 2. Outcomes Required

By sprint completion:

- Spatial scene data can support map/plan experiences.
- Gyroscope/stereo/VR capabilities are resolved through device requirements and safe fallbacks.
- High-resolution/tiled media strategy is generalized for supported panorama families.
- Advanced interaction geometry is canonical: point, polygon, polyline, image layer, video layer, custom extension placeholder.
- Overlays can be stored/validated without exposing renderer internals.
- Templates can create projects from canonical Experience snapshots/blueprints.
- Creator-facing analytics query APIs exist over runtime events.
- Team/collaboration and advanced access control foundations exist if account model supports them.
- Large/enterprise tour delivery is hardened.
- Versioned public API/SDK foundations are established for supported canonical operations.
- Enterprise observability makes publication, asset, compiler, runtime, and viewer-version failures diagnosable.
- Live/dual-fisheye/custom extension architecture has safe interfaces even if some ingestion backends remain feature-flagged until vendor/device requirements are finalized.

## 3. Important Scope Interpretation

The source architecture places some capabilities in later professional phases. To satisfy the requested four-sprint backend completion plan, Sprint 04 groups those backend foundations here.

Where a feature depends on an external media/vendor decision not specified by the source documents (for example exact live-stream transport, malware-scanning vendor, or dual-fisheye camera SDK), implement:

- canonical contracts,
- capability flags,
- provider interfaces,
- authorization/security,
- tests with mock/reference providers,

rather than inventing an arbitrary vendor dependency.

## 4. In Scope

### Spatial
- GPS/spatial scene metadata.
- Map/plan capability data.
- Floor-plan asset references.
- Scene-to-map coordinate mapping.
- Resolver rules for meaningful spatial data.

### Immersive
- Gyroscope capability.
- Stereo/VR capability dependencies.
- Device/runtime requirement declarations.
- Fallback to normal 360°.

### Advanced media
- Generalized panorama projection metadata.
- Cubemap/tiled cubemap derivative support if media stack permits.
- Multi-level tiling policy.
- Dual-fisheye provider interface.
- Live/MediaStream provider interface.
- Quality/resolution policy abstraction.

### Advanced interactions
- Polygon.
- Polyline.
- Image layer.
- Video layer.
- Custom component/extension placeholder.
- Overlay validation and publication.

### Templates
- Template storage.
- Instantiate project from template.
- Template schema/version compatibility.
- Asset reference/copy policy.

### Analytics
- Creator-facing aggregated experience analytics.
- Scene/hotspot/video engagement.
- Runtime reliability/performance.
- Date-range query.
- Privacy-aware dimensions.

### Collaboration/access
- Team/workspace access model foundation.
- Project roles.
- Publication/private access policy expansion.
- Audit trail for privileged changes.

### Scale / platform
- Enterprise large-tour hardening.
- Versioned public API foundation.
- Extension registry.
- Operational dashboards/metrics contracts.
- Viewer integration rollout/version control.

## 5. Domain Model Extensions

### Spatial data

Scene-level canonical structure may include:

```text
spatialData:
  latitude
  longitude
  altitude
  heading
  floorId
  mapX
  mapY
  coordinateSystem
```

Only store fields that are meaningful. Do not invent fake GPS data for floor-plan-only scenes.

### Floor / plan entity

```text
id
projectId
name
assetId
coordinateSystem
metadata
sortOrder
```

### Advanced interaction geometry

Canonical union:

```text
geometry.kind =
  point
  polygon
  polyline
  imageLayer
  videoLayer
  custom
```

Examples:

```text
point:
  position

polygon:
  vertices[]

polyline:
  vertices[]

imageLayer:
  assetId
  transform/anchor data

videoLayer:
  assetId
  transform/anchor data

custom:
  extensionId
  version
  validatedPayload
```

Keep renderer translation in the integration adapter.

### Template

```text
id
owner/workspace scope
name
description
schemaVersion
experienceType
canonicalBlueprint
assetPolicy
visibility
createdAt
updatedAt
```

### Workspace / membership (if not already present)

```text
Workspace
Membership
ProjectAccess
```

Suggested role semantics:

```text
owner
admin
editor
viewer
```

Exact role names can align to existing account model.

## 6. Map / Plan Capability

Implement backend semantics for:

- map/plan configuration,
- spatial data validation,
- floor-plan asset readiness,
- scene coordinate mapping,
- published spatial index if required,
- capability resolver rule that hides/disables map/plan when meaningful spatial data is absent.

Validation examples:

```text
MAP_ASSET_NOT_READY
SCENE_SPATIAL_DATA_INCOMPLETE
MAP_SCENE_MAPPING_INVALID
```

Do not require GPS if a floor-plan coordinate system is used.

## 7. Gyroscope / Stereo / VR Resolver

Complete capability entries:

```text
gyroscope
stereo
vr
```

Rules:

- capability may be requested by project settings,
- manifest declares device/runtime requirements,
- runtime can report capability availability,
- unsupported device falls back to normal 360°,
- fallback does not invalidate the publication,
- operational telemetry records capability failures.

The backend should resolve **policy**, not pretend it can know every browser sensor permission before the player runs.

## 8. Quality / Resolution Policy

Generalize the media selection system to support:

```text
standard equirectangular
tiled equirectangular
cubemap
tiled cubemap
video profiles
future dual-fisheye normalized derivatives
```

The canonical asset model should describe projection/derivative metadata. The compiler decides which runtime adapter/config to generate.

Implement policy interfaces for:

- target quality class,
- device capability,
- viewport,
- derivative availability,
- network/runtime hints,
- fallback derivative.

Avoid exposing raw adapter names to the API/UI unless internal diagnostics require them.

## 9. Advanced Overlay / Geometry Validation

For each geometry type:

- schema validation,
- finite coordinate checks,
- minimum vertex counts,
- asset references,
- content sanitization,
- action validation,
- visibility rule validation,
- publish-time reference integrity.

Examples:

```text
polygon: at least 3 valid vertices
polyline: at least 2 valid vertices
imageLayer/videoLayer: ready referenced asset
custom: registered extension + supported schema version
```

## 10. Extension Registry

Add an internal/versioned extension contract:

```text
Extension
├── id
├── version
├── supportedExperienceTypes[]
├── schema
├── requiredCapabilities[]
├── runtimeModule
├── securityPolicy
└── status
```

Goals:

- future custom interactions do not require arbitrary unvalidated JSON execution,
- extension payload is validated,
- runtime module is allow-listed,
- publications pin extension version,
- disabled extension cannot silently break previously published revisions without a fallback/rollout plan.

## 11. Templates

Implement:

```http
GET  /api/templates
GET  /api/templates/:templateId
POST /api/templates/:templateId/instantiate
```

Optional authoring endpoints for authorized template managers.

Instantiation requirements:

- creates a new canonical Project,
- assigns a fresh project ID,
- creates fresh stable IDs for mutable project entities,
- follows explicit asset reuse/copy policy,
- preserves schema compatibility,
- never copies another user's private asset by URL,
- returns a normal draft project.

## 12. Creator Analytics

Build query APIs over telemetry/analytics storage.

Suggested endpoints:

```http
GET /api/projects/:projectId/analytics/summary
GET /api/projects/:projectId/analytics/timeseries
GET /api/projects/:projectId/analytics/scenes
GET /api/projects/:projectId/analytics/interactions
GET /api/projects/:projectId/analytics/video
GET /api/projects/:projectId/analytics/reliability
```

Metrics may include:

```text
experience loads
first panorama visible timing
time to interactive
scene transitions
scene transition failures
hotspot clicks
video starts
video stalls
CTA/interactions
asset failures
viewer errors
session exits
```

Requirements:

- authorization checks project/workspace access,
- query date range is bounded,
- publication revision filtering supported,
- privacy-safe aggregation,
- operational errors distinguishable from product engagement metrics.

## 13. Collaboration / Access Controls

If team collaboration is enabled in product scope, implement:

- workspace/team membership,
- project access roles,
- invite/accept flows if identity system supports them,
- owner/admin/editor/viewer permissions,
- explicit authorization policy per mutation,
- audit log for publish, access, asset deletion, project deletion, role change.

Minimum authorization matrix:

```text
viewer: read project/analytics where permitted
editor: edit draft, assets, scenes, interactions
admin: editor + project settings/access management
owner: admin + ownership/destructive controls
```

Adjust names to existing platform conventions.

## 14. Advanced Private / Embed Access

Complete security policy for:

- signed/private manifests,
- signed/private media derivatives,
- optional embed-origin allowlist,
- CSP generation policy,
- token expiry/revocation where access model uses share tokens,
- custom domain mapping interface if product enables it.

Tests must verify that a private experience cannot be bypassed through progressive scene/media endpoints.

## 15. Enterprise Large-Tour Hardening

Extend large-tour implementation for:

- 100+ scene reference fixtures,
- materialized compiled scene artifacts,
- pagination/scene index segmentation if needed,
- publish memory limits,
- compiler streaming/chunking if needed,
- queueing/async compile if project size exceeds synchronous budget,
- cache-safe immutable scene revisions,
- preload graph strategy,
- observability for scene-definition latency and failures.

Do not change the editor mental model.

## 16. Public API / SDK Foundation

Establish a versioned canonical API surface for supported external operations.

Example prefix:

```text
/api/v1/
```

Candidate supported operations:

- projects,
- assets/upload sessions,
- scenes,
- interactions,
- preview validation,
- publish,
- analytics read.

Requirements:

- versioning strategy documented,
- authentication scopes documented,
- rate-limit integration point,
- stable error envelope,
- idempotency support,
- deprecation policy,
- no raw renderer configuration accepted as canonical project write input.

Do not expose every internal admin endpoint publicly.

## 17. Dual-Fisheye / Live Provider Interfaces

Because exact camera/stream providers are not specified, implement provider abstractions.

### Dual-fisheye ingest provider

```text
canHandle(asset metadata)
inspect()
normalizeToSupportedProjection()
produceDerivatives()
```

### Live 360 provider

```text
authorizeSource()
validateSource()
resolveRuntimeSource()
healthCheck()
revoke()
```

Security requirements:

- allow-listed schemes/providers,
- authentication secrets stored through secret infrastructure,
- no arbitrary SSRF-capable URL ingestion,
- runtime source access controlled,
- health/failure telemetry.

Feature-flag provider implementations until concrete vendor requirements are approved.

## 18. Observability Hardening

Metrics/traces/logs should make these diagnosable:

### Media
- queue delay,
- job duration by stage,
- retry count,
- derivative failures,
- transcoder/tiler errors.

### Compiler/publish
- validation failures by code,
- compile duration,
- manifest size,
- scene count,
- publication success/failure,
- current viewer integration version.

### Runtime
- first panorama visible,
- TTI,
- scene transition latency/failure,
- asset failure,
- video stall,
- viewer error,
- capability fallback.

### API
- latency/error rate,
- auth failures,
- concurrency conflicts,
- idempotency replay rate,
- rate-limit events where enabled.

## 19. Viewer Integration Version Control

Implement/complete:

```text
Experience Schema
  ↓
Experience Compiler
  ↓
Viewer Integration Adapter version X
  ↓
Photo Sphere Viewer pinned version
```

Requirements:

- publication records store integration version,
- rollout can target a new adapter version,
- reference experience suite runs against candidate version,
- rollback path exists,
- saved canonical projects do not require mass rewrite for renderer-only changes.

## 20. Reference Experience Suite

Automate fixtures/tests for at least:

```text
basic panorama
cropped panorama
high-resolution panorama
multi-scene tour
large tour
gallery
hotspots
map/plan
gyroscope/stereo fallback
360° video
timed interactions
advanced polygon/polyline overlay
image/video layer
private embed
```

A renderer/integration upgrade cannot be promoted until the suite passes.

## 21. Database / Index Work

Add indexes/materialized aggregates appropriate to implementation for:

- spatial lookup,
- plans/floors,
- advanced geometry parent entity,
- templates by scope/type,
- memberships by workspace/user,
- analytics by project/revision/time/event,
- audit logs by project/workspace/time,
- extensions by ID/version/status,
- large-tour compiled scene artifact lookup.

For high-volume telemetry, do not force all raw events into the primary transactional database if the existing architecture has a better analytics store.

## 22. Security Tests

Required:

- map/plan asset authorization,
- private scene bypass attempt,
- private media bypass attempt,
- embed-origin enforcement,
- custom extension payload validation,
- custom extension allowlist,
- SSRF attempts against live-source provider interface,
- role escalation,
- unauthorized analytics access,
- template private-asset leakage,
- public API scope violations.

## 23. Performance / Scale Tests

Required:

- publish 100+ scene tour fixture,
- progressive fetch remains bounded,
- scene index size measured,
- compiler memory measured,
- tile/derivative selection validated,
- analytics date-range query budget,
- event ingestion burst handling,
- large project validation time,
- viewer integration reference suite.

Use measurements to tune configuration; do not invent production thresholds without evidence.

## 24. Acceptance Criteria / Sprint Gate

- [x] Spatial scene data model supports GPS and/or floor-plan coordinates without requiring both.
- [x] Map/plan capability is publishable only when required data/assets are valid.
- [x] Gyroscope/stereo/VR capabilities have declared device requirements and normal-360 fallback.
- [x] Advanced interaction geometry supports point/polygon/polyline/imageLayer/videoLayer/custom in canonical schema.
- [x] Advanced geometry never requires renderer-specific persistence.
- [x] Quality/resolution policy can choose among available panorama derivative families.
- [x] Template instantiation creates clean canonical projects with fresh mutable IDs.
- [x] Creator analytics APIs provide authorized, revision-aware aggregated metrics.
- [x] Collaboration/access controls are server-enforced where team scope is enabled.
- [x] Private progressive scene/media/embed endpoints cannot bypass access rules.
- [x] Enterprise large-tour fixture is progressively delivered.
- [x] Public API foundation is versioned and documents auth/error/idempotency behavior.
- [x] Extension registry validates and pins custom extension versions.
- [x] Dual-fisheye/live provider interfaces exist behind safe feature/provider boundaries.
- [x] Publication stores viewer integration version.
- [x] Reference experience suite gates viewer integration upgrades.
- [ ] Observability covers media, compiler/publish, runtime, and API failures.
- [x] Full regression suite from Sprints 01–03 passes.

Verification on 2026-08-25: `npm run test:all` passed lint, typecheck, 135 tests
across 26 files, and the production build; `npm audit --omit=dev` reported zero
vulnerabilities. Coverage added this pass:

- `tests/unit/reference/reference-experience-suite.test.ts` — runs the §20
  reference suite as the promotion gate. All 13 scenarios compile against every
  registered integration version, an unregistered version is refused, and the
  120-scene tour is asserted to stay progressive.
- `tests/security/sprint-04-access-and-extension-security.test.ts` — the §22
  matrix: private manifest/scene/media bypass, unsigned and tampered media
  signatures, viewer role escalation, unauthorized analytics, extension
  allowlist/schema validation with version pinning, template asset leakage.
- `tests/security/live-source-ssrf.test.ts` — §17/§22 SSRF: loopback,
  link-local, metadata, private and CGNAT ranges, suffix-confusion hosts and
  non-stream schemes are all refused, and an empty allowlist refuses everything.
- `tests/integration/sprint-04-spatial-geometry-api.test.ts` — GPS-or-plan
  placement, advanced geometry round-tripping canonically through publish,
  device-deferred immersive capabilities with normal-360 fallback, map gating on
  real spatial data, and the integration version recorded on the publication.

Remaining gap: observability. `src/observability/metrics.ts` and
`GET /api/v1/platform/metrics` exist and are wired into the media, telemetry and
publish paths, but no test asserts that a failure in those paths actually emits
the metric. This is the one criterion above still unchecked.

## 25. Claude Code Execution Order

1. Review all Sprint-01–03 domain contracts and tests.
2. Add spatial/map/plan schema and resolver rules.
3. Add advanced geometry + overlay schema/validation.
4. Generalize media quality/projection policies.
5. Complete gyro/stereo/VR capability rules and fallback metadata.
6. Implement template model/instantiation.
7. Implement analytics aggregation/query layer.
8. Add collaboration/advanced access model if enabled in current repository.
9. Harden private/embed security.
10. Harden large-tour compilation/delivery.
11. Add versioned public API boundary.
12. Add extension registry.
13. Add dual-fisheye/live provider interfaces and feature flags.
14. Add observability dashboards/metrics contracts.
15. Add/automate the full reference experience suite.
16. Run migration/lint/typecheck/unit/integration/security/performance regression.
17. Update API, schema, security, media, publish, and operations documentation.

## 26. Claude Code Guardrails

- Do not invent a live-stream or camera vendor just to mark the interface complete.
- Do not execute arbitrary custom extension code/payloads without allow-listing and versioned validation.
- Do not mix raw analytics events with transactional CRUD when architecture cannot scale it.
- Do not grant team permissions only in the frontend.
- Do not make VR/stereo availability a publish blocker when normal 360° fallback is valid.
- Do not expose renderer-specific projection/adaptor settings as public API domain fields.
- Do not weaken private-media authorization for CDN convenience.
- Do not promote a viewer integration version without the reference experience suite.
