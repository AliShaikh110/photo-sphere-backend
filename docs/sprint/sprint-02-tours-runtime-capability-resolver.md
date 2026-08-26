# Sprint 02 — Multi-Scene Tours, Runtime Efficiency & Capability Resolution

> **Execution target:** Backend implementation for the No-Code 360° Experience Platform  
> **Source basis:** Product/Architecture/Runtime Specification Revision 2.0 + Frontend/Backend PRD  
> **Implementation style:** Stack-agnostic. Claude Code must use the repository's existing language, framework, ORM, job system, storage provider, and testing conventions unless the repository explicitly requires a new component.
>
> **Architecture rule:** Persist the platform's canonical Experience model. Never make Photo Sphere Viewer configuration the database model. Renderer-specific configuration is generated through the Experience Compiler / Viewer Integration Adapter.


## 1. Sprint Objective

Extend the Sprint-01 image backend into a production-grade **multi-scene virtual tour runtime** with scene connections, gallery/navigation abstractions, progressive loading for large tours, bounded caching, selective preloading, capability resolution, and high-resolution panorama delivery policy.

The user-facing mental model remains **Scenes / Gallery / Navigation / High Quality**. Backend implementation may use Photo Sphere Viewer capabilities internally, but raw plugin/adaptor decisions must remain behind the Experience Engine.

## 2. Outcomes Required

By sprint completion:

- Creators can maintain multi-scene projects with stable scene IDs.
- Scenes can reference reusable panorama assets.
- Scene-to-scene navigation is validated.
- Gallery, links, image/video content references, autorotation, compass, and view limits are representable canonically.
- A capability registry/resolver prevents invalid runtime combinations.
- Small tours can compile into one manifest.
- Large tours can compile into an initial manifest + lightweight scene index + progressive scene definitions.
- The runtime API can fetch scene definitions by stable ID.
- The compiler emits selective preload hints rather than blanket preloading.
- The platform defines bounded scene/panorama cache policy.
- High-resolution panoramas can use low-resolution-first plus tiled/higher-detail derivatives when policy requires.
- Optional heavy runtime modules are declared for lazy loading.
- Runtime telemetry includes scene transitions and transition failures.

## 3. Dependencies

Sprint 01 must already provide:

- auth/authorization,
- canonical Project/Asset/Scene/Hotspot persistence,
- asset processing state machine,
- compiler/integration-adapter boundary,
- preview,
- atomic publish,
- secure public/private manifest access,
- baseline telemetry.

Do not duplicate these systems. Extend them.

## 4. In Scope

### Tour authoring backend
- Multiple scenes.
- Add/update/delete/reorder scenes.
- Scene connections.
- Inbound-reference validation.
- Gallery abstraction.
- Scene-level information/images/video/link references.
- Autorotation.
- Navigation controls.
- Compass.
- Allowed viewing area / view limits.
- Runtime hints.

### Large-tour delivery
- Lightweight scene index.
- Progressive scene fetch.
- Small-vs-large tour compiler strategy.
- Stable published scene definitions.
- Scene index versioning.
- Signed/private scene delivery when required.

### Runtime performance
- Adjacent-scene preload policy.
- Bounded cache policy.
- Duplicate request suppression.
- Device-aware cache budgets.
- Lazy-load module declarations.
- Low-resolution-first panorama strategy.
- Tiled/high-resolution derivative pipeline.

### Capability resolver
- Capability registry.
- Dependencies.
- Incompatibilities.
- Media requirements.
- Device requirements.
- Fallback metadata.
- Lazy module metadata.
- Preflight validation.

## 5. Out of Scope for Sprint 02

- Timeline-based 360° video editing.
- Video transcoding profiles as a first-class experience.
- VR/stereo user flows beyond resolver schema placeholders.
- Map/plan implementation.
- GPS scene data.
- Advanced polygon/polyline/layer hotspot authoring.
- Collaboration.
- Full creator-facing analytics dashboards.
- Public API/SDK.

## 6. Domain Model Extensions

### Scene

Ensure support for:

```text
id
projectId
name
sortOrder
panoramaAssetId
initialView
viewLimits
hotspots
overlays
connections
spatialData
runtimeHints
createdAt
updatedAt
```

### Scene connection

```text
id
sourceSceneId
targetSceneId
trigger hotspot/action reference
label/content
importance or preloadHint (optional product-level hint)
createdAt
```

Do not persist renderer-specific virtual-tour node configuration.

### Runtime hints

Use a product-level shape such as:

```text
runtimeHints:
  preloadPriority
  likelyNextSceneIds
  qualityPreference
```

Treat explicit creator hints as hints, not direct cache/network commands.

## 7. Scene API

Implement equivalent semantics:

```http
GET    /api/projects/:projectId/scenes
POST   /api/projects/:projectId/scenes
GET    /api/projects/:projectId/scenes/:sceneId
PATCH  /api/projects/:projectId/scenes/:sceneId
DELETE /api/projects/:projectId/scenes/:sceneId
POST   /api/projects/:projectId/scenes/reorder
```

Scene connection operations may be nested under scenes or included in scene updates, but must have stable IDs and validation.

### Delete rules

Deleting a scene with inbound references must:

- reject with an actionable reference error, or
- require an explicit repair/delete-reference operation.

Never silently leave broken scene IDs.

## 8. Large-Tour Strategy

Implement compiler support for two runtime strategies.

### Small tour

```text
Published Manifest
├── global settings
├── branding
├── initial scene
└── complete scene definitions
```

### Large tour

```text
Published Manifest
├── global settings
├── branding
├── initial scene
└── lightweight scene index

User navigates
  ↓
GET published scene definition
  ↓
load optimized panorama
  ↓
preload likely adjacent scene(s)
```

### Strategy selection

Create a policy abstraction rather than hard-coding one scene-count threshold into business logic.

Policy may consider:

- scene count,
- serialized manifest size,
- graph complexity,
- media metadata,
- product plan/runtime policy.

The exact initial thresholds should be configuration, not schema.

## 9. Published Scene API

Implement:

```http
GET /view/:slug/scenes/:sceneId
```

Requirements:

- resolves the current successful publication revision,
- validates scene exists in that published revision,
- returns immutable compiled scene definition,
- enforces private publication access,
- is CDN/cache friendly for public immutable revisions when routing architecture allows,
- does not read mutable draft scene data for public playback.

If revision-pinned URLs are supported internally, use them for cache-safe scene objects.

## 10. Capability Registry

Implement a registry equivalent to:

```text
Capability
├── id
├── productFeature
├── rendererModule
├── dependencies[]
├── incompatibilities[]
├── deviceRequirements[]
├── mediaRequirements[]
├── lazyLoadModule
└── fallback
```

Initial capabilities should cover:

```text
basicPanorama
hotspots
sceneNavigation
gallery
autorotation
compass
viewLimits
tiledPanorama
highResolution
imageContent
videoContent
externalLink
```

Also reserve entries for later:

```text
video360
map
plan
gyroscope
stereo
vr
advancedOverlay
advancedGeometry
```

## 11. Resolver Rules

At minimum implement/test:

- `tiledPanorama` requires tiled derivative assets.
- `gallery` is resolved according to current renderer compatibility rules and must not create an invalid raw plugin combination.
- `compass` is only compiled when semantically configured.
- `viewLimits` compile only when valid.
- referenced content assets must exist and be ready.
- optional module declarations are emitted only when used.
- unsupported/incompatible combinations produce product-level validation issues or an explicit fallback.

Do not return renderer-internal class names to the creator-facing API error message.

## 12. Capability Preflight Response

Extend project validation to provide product-safe issues:

```json
{
  "valid": false,
  "issues": [
    {
      "code": "FEATURE_COMBINATION_UNAVAILABLE",
      "severity": "error",
      "entityId": "project_123",
      "path": "settings.gallery",
      "message": "This gallery configuration is not available with the selected quality mode.",
      "alternatives": ["Use automatic quality selection"]
    }
  ]
}
```

Exact wording can vary. Stable codes must not expose renderer details.

## 13. High-Resolution Panorama Pipeline

Extend asset processing with policy-driven derivatives.

Possible derivative kinds:

```text
tiledBase
tileLevel
cubemapFace
tiledCubemapFace
```

Sprint 02 must fully support the platform's chosen initial **tiled equirectangular** strategy if the repository/media stack supports it.

Pipeline:

```text
ready original
  ↓
quality policy evaluates dimensions/filesize/use
  ↓
generate low-resolution base if not already present
  ↓
generate tile manifest + tile levels
  ↓
store immutable derivatives
  ↓
update derivative catalog
```

Requirements:

- no project reference changes when tiles are regenerated,
- tile metadata is canonical media metadata, not raw viewer config,
- compiler chooses tiled vs standard delivery,
- first meaningful view can use base image before high-detail regions.

## 14. Preload Policy

Implement a runtime policy service/module.

Default behavior:

```text
Current Scene
├── preload strongest connected scene
├── optionally preload second likely scene
└── never blanket preload unrelated full-resolution scenes
```

Inputs may include:

- connection graph,
- explicit runtime hint,
- scene proximity,
- recent navigation history supplied by client,
- device/network class.

The backend/manifest should return **what is reasonable to preload**, while the player remains responsible for actual browser fetching.

## 15. Cache Policy Contract

Define a runtime cache configuration abstraction.

Goals:

- speed up back-navigation,
- avoid duplicate media requests,
- bound memory use,
- vary by device/media class.

Do not expose raw cache configuration to creators.

Provide compiled runtime hints such as:

```text
maxRecentScenes
maxEstimatedBytes
evictionStrategy
```

Exact implementation depends on the player architecture. Keep it versioned and platform-controlled.

## 16. Bundle / Module Efficiency

The published manifest/compiler should declare only runtime capabilities in use.

Example:

```json
{
  "runtimeModules": [
    "core-panorama",
    "hotspots",
    "virtual-tour",
    "compass"
  ]
}
```

Do not require these exact strings; preserve the principle.

Heavy/uncommon modules should be lazy-loadable where player packaging supports it.

## 17. Tour Telemetry

Add:

```text
scene_changed
scene_transition_failed
scene_definition_requested
scene_preload_started
scene_preload_completed
scene_asset_cache_hit
scene_asset_cache_miss
```

Only the first two are mandatory product events; the others can be operational telemetry if useful.

Every transition failure must include:

- publication revision,
- source scene,
- target scene,
- stable failure category,
- asset ID when relevant,
- viewer integration version.

## 18. Migration / Index Work

Add/update indexes for:

- scenes by project + sort order,
- scene connection source/target,
- published scene lookup by publication revision + scene ID,
- asset derivative kind/version,
- processing policy/job deduplication,
- runtime scene event time/revision.

If scene definitions are materialized as compiled publication artifacts rather than relational records, document that design.

## 19. Tests

### Domain / API
- create multiple scenes,
- reorder scenes,
- connect scenes,
- reject invalid/deleted target,
- block unsafe deletion with inbound references,
- reuse one logical asset where allowed,
- validate view limits.

### Compiler
- small tour compiles inline scenes,
- large tour compiles lightweight index,
- large-tour scene fetch returns published immutable definition,
- draft changes after publish do not mutate published scene output,
- tiled derivative selected when policy requires,
- fallback to standard derivative when tiled set unavailable and allowed.

### Resolver
- dependency satisfied,
- missing dependency rejected/fallback,
- media requirement enforcement,
- known incompatible feature combination handled,
- unused heavy module omitted.

### Performance behavior
- manifest size does not scale linearly with full scene detail in large-tour mode,
- no "preload all scenes" manifest output,
- cache/preload hints are bounded.

### Authorization
- private progressive scene route protected,
- unauthorized project scene CRUD denied.

## 20. Acceptance Criteria / Sprint Gate

- [ ] Multi-scene projects persist with stable scene IDs.
- [ ] Scene connections are validated and broken references cannot publish.
- [ ] Scene reorder and delete rules are deterministic.
- [ ] Gallery/navigation/autorotation/compass/view-limits exist as product-level settings.
- [ ] Capability registry exists as a shared backend contract.
- [ ] Validation resolves dependencies/incompatibilities before publish.
- [ ] Small-tour and large-tour compiler strategies both exist.
- [ ] Large-tour initial manifest contains lightweight scene index rather than every heavy scene payload.
- [ ] Published scene-definition route resolves immutable publication data.
- [ ] Private large-tour scene fetch is authorization-protected.
- [ ] Preload policy selects likely adjacent scenes only.
- [ ] Runtime cache policy is bounded and platform-controlled.
- [ ] Tiled/high-resolution derivative generation is policy-driven and retry-safe.
- [ ] Compiler can select low-res/base + high-detail tiled delivery.
- [ ] Optional runtime modules are declared only when needed.
- [ ] `scene_changed` and `scene_transition_failed` telemetry is supported.
- [ ] Full regression suite from Sprint 01 still passes.

## 21. Claude Code Execution Order

1. Read Sprint-01 implementation and existing tests.
2. Extend scene/connection domain model and migrations.
3. Implement full scene CRUD/reorder/reference integrity.
4. Extend project validation.
5. Implement capability registry and resolver.
6. Extend compiler for tour capabilities.
7. Implement small-vs-large tour strategy.
8. Implement compiled published scene storage/route.
9. Extend media pipeline for tiled/high-resolution derivatives.
10. Implement preload policy contract.
11. Implement bounded cache/runtime hints.
12. Add tour/runtime telemetry.
13. Add integration/security/performance tests.
14. Run all prior + new tests.
15. Update architecture/API/runbook docs.

## 22. Claude Code Guardrails

- Do not make PSV virtual-tour node config canonical.
- Do not preload all scenes.
- Do not load all large-tour scene definitions at startup.
- Do not hard-code infrastructure-specific cache sizes into canonical project data.
- Do not silently delete referenced scenes.
- Do not surface raw renderer incompatibility messages to frontend clients.
- Do not make high-resolution originals the mandatory first download.
