# Product Requirements Document (PRD)

## No-Code 360° Experience Platform

**Frontend + Backend Implementation Specification**

| **Document**       | **Value**                                                                                          |
|--------------------|----------------------------------------------------------------------------------------------------|
| Version            | 1.0                                                                                                |
| Status             | Draft for product / design / engineering alignment                                                 |
| Date               | 24 August 2026                                                                                     |
| Architecture basis | No-Code 360° Experience Platform — Product, Architecture, UX & Runtime Specification, Revision 2.0 |
| Rendering basis    | Photo Sphere Viewer 5.14.3 (as specified by source architecture)                                   |
| Primary audience   | Product, UX/UI, frontend, backend, media/platform, QA, DevOps/SRE                                  |

| **Product rule:** The user configures the experience. The platform configures the technology. |
|-----------------------------------------------------------------------------------------------|

# Document Purpose

This PRD converts the supplied product/architecture specification into an implementation contract that can be used by frontend and backend teams. It preserves the architecture’s renderer-independent Experience model, media pipeline, capability resolver, publishing/runtime separation, and canvas-first UX while adding requirement IDs, states, ownership boundaries, API expectations, acceptance criteria, and delivery gates.

| **Scope of interpretation:** Items explicitly defined by the supplied architecture are treated as source requirements. API path names, exact service boundaries, and numeric performance targets in this PRD are proposed implementation conventions and may be adjusted without changing the product behavior. |
|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# Contents

- 1\. Product Summary & Context

- 2\. Goals, Non-Goals & Success Measures

- 3\. Users, Jobs & Key Journeys

- 4\. Scope & Release Strategy

- 5\. UX and Frontend Product Requirements

- 6\. Backend & Platform Product Requirements

- 7\. Canonical Data Model

- 8\. Proposed API Contract

- 9\. Experience Compiler & Published Manifest

- 10\. Media Processing & Delivery

- 11\. Capability Resolution & Runtime Orchestration

- 12\. Security, Privacy & Access

- 13\. Analytics & Observability

- 14\. Performance & Reliability Requirements

- 15\. Error Handling & Recovery

- 16\. Testing & Quality Strategy

- 17\. Definition of Done by Phase

- 18\. Risks, Dependencies & Open Decisions

- 19\. Requirement Traceability

# 1. Product Summary & Context

## 1.1 Product vision

Build a no-code platform for creating, managing, publishing, sharing, and measuring interactive 360° image and video experiences. Users work visually with scenes, hotspots, content, branding, navigation, and timed interactions; they never need to understand renderer adapters, plugins, spherical coordinates, JSON, tiling, codec profiles, or browser capability APIs.

## 1.2 Customer mental model

Upload → Edit visually → Preview → Publish → Share

## 1.3 Platform execution model

Ingest → Inspect → Normalize → Optimize → Derive → Store  
→ Configure → Compile → Render → Preload → Cache → Measure

## 1.4 Product boundary

| **Platform owns**                                                                                                                                                                         | **Renderer owns**                                                                                                                                                                          |
|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Stable Experience schema; visual editor; media/asset library; media optimization; capability resolution; publishing; sharing/embed; security; device fallbacks; analytics; runtime policy | Panorama/video rendering; camera/navigation primitives; supported adapters; marker/tour/gallery/map/plan/gyro/stereo/overlay primitives; viewer events and low-level rendering integration |

| **Architecture constraint:** Photo Sphere Viewer configuration must not be the canonical database model. A versioned integration adapter translates the stable Experience schema into renderer-specific configuration at runtime. |
|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 2. Goals, Non-Goals & Success Measures

## 2.1 Product goals

- Allow a first-time creator to produce a useful interactive 360° image experience without documentation or code.

- Keep the panorama/video canvas visually dominant and expose settings contextually.

- Provide a shared Experience Engine for image, video, virtual-tour, gallery, and future immersive modes.

- Optimize uploaded media automatically and select device-appropriate derivatives at runtime.

- Support small and large experiences without forcing all scene metadata or full-resolution assets into initial load.

- Publish reliable direct links, embeds, and QR-share targets without exposing hosting or CDN configuration.

- Keep renderer-specific capabilities replaceable through schema versioning, compilation, and integration adapters.

- Treat performance, security, graceful fallbacks, and observability as product requirements rather than afterthoughts.

## 2.2 Non-goals

- Building a professional non-linear 360° video editing suite.

- Exposing every Photo Sphere Viewer adapter/plugin as a visible customer setting.

- Requiring users to enter yaw/pitch, raw crop coordinates, adapter names, shader flags, cache limits, or codec parameters in normal workflows.

- Loading every optional runtime module or every tour scene at startup.

- Storing raw renderer configuration as customer project truth.

- Guaranteeing immersive features on devices that lack required browser/hardware capabilities.

## 2.3 Product success measures

| **Area**             | **Measure**                                | **Target / interpretation**                                                                                    |
|----------------------|--------------------------------------------|----------------------------------------------------------------------------------------------------------------|
| Activation           | Creator reaches first preview after upload | Track time-to-first-preview and completion rate; reduce friction release over release.                         |
| Authoring efficiency | Core tasks completed visually              | Hotspot placement, scene linking, appearance changes, preview and publish require no technical fields.         |
| Runtime performance  | First useful visual and scene transitions  | Measured per device/network class; use progressive derivatives and adjacent preloading.                        |
| Reliability          | Publish/player/media failures              | Failures are observable, recoverable, and do not corrupt project data.                                         |
| Compatibility        | Optional capability fallback               | Unsupported gyro/VR/video profile/etc. degrades to a supported normal 360° experience.                         |
| Maintainability      | Renderer upgrades                          | Viewer upgrade can be handled in integration adapter/reference tests without migrating all saved project data. |

# 3. Users, Jobs & Key Journeys

## 3.1 Primary user

The primary MVP user is an authenticated creator who owns or manages a 360° experience. Team collaboration and advanced role models are later-phase capabilities; therefore this PRD does not require a complex role matrix for Phase 1.

## 3.2 Core jobs to be done

- Upload a 360° panorama/video and know whether it is usable.

- Add interactions by clicking on the visual experience, not by entering spherical coordinates.

- Organize multiple panoramas into navigable scenes/tours.

- Brand the experience and control viewer behavior.

- Preview exactly what a visitor will see, including mobile fallback behavior.

- Publish once and share by URL, embed, or QR.

- Reuse uploaded assets across the project without duplicate uploads.

- Understand engagement and diagnose runtime problems.

## 3.3 Primary image journey

Sign up / Login → Dashboard → Create Experience → 360° Image → Upload  
→ Automatic inspection/optimization → Visual Editor → Preview → Publish → Share

## 3.4 Primary video journey

Sign up / Login → Dashboard → Create Experience → 360° Video → Upload  
→ Inspect/transcode/poster → Video Editor + Timeline → Preview → Publish → Share

# 4. Scope & Release Strategy

## 4.1 Phase 1 — Core product + production foundation

| **Capability**      | **Phase-1 requirement**                                                                                                           |
|---------------------|-----------------------------------------------------------------------------------------------------------------------------------|
| Account & projects  | Authentication, dashboard, project create/open/rename/save, draft state.                                                          |
| 360° image ingest   | Upload, validation, metadata/XMP inspection, processing status, thumbnail + optimized web derivative.                             |
| Editor              | Canvas-first layout, collapsible tools, contextual properties, basic point hotspot, information panel, basic appearance/branding. |
| Preview & publish   | Visitor-only preview, public/private visibility model, publish, direct URL, embed code, QR output.                                |
| Runtime foundation  | Experience schema, compiler/adapter boundary, viewer lifecycle cleanup, device fallback foundation, basic telemetry.              |
| Security foundation | Upload validation, rich-content sanitization, URL policy, authorization for private experiences.                                  |
| Delivery foundation | CDN-ready immutable derivatives and versioned published manifest.                                                                 |

## 4.2 Later phases

| **Phase**                    | **Major additions**                                                                                                                                                                       |
|------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Phase 2 — Rich tours         | Scenes, gallery, links/image/video content, auto-rotation, compass, view limits, scene connections, adjacent preload, cache policy, progressive large-tour loading.                       |
| Phase 3 — 360° video         | Video upload/viewer, timeline, timed interactions, poster, device-aware desktop/mobile profiles, playback telemetry.                                                                      |
| Phase 4 — Advanced immersive | Map/plan, GPS scene data, gyroscope, VR/stereo, tiled high-resolution panoramas, advanced overlays/geometry, templates, analytics, collaboration.                                         |
| Phase 5 — Professional scale | Multi-level tiling, enterprise-scale tours, dual-fisheye ingest where justified, live/MediaStream, custom extensions, advanced access controls, public API/SDK, enterprise observability. |

# 5. UX and Frontend Product Requirements

## 5.1 Global authoring shell

<table>
<colgroup>
<col style="width: 20%" />
<col style="width: 20%" />
<col style="width: 20%" />
<col style="width: 20%" />
<col style="width: 20%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>ID</strong></th>
<th><strong>Requirement</strong></th>
<th><strong>Frontend contract</strong></th>
<th><strong>Backend contract</strong></th>
<th><strong>Acceptance criteria</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>FE-001</td>
<td>Canvas-first editor shell</td>
<td>Render top bar + collapsible left tool panel + dominant viewer; mount contextual right properties only when needed.</td>
<td>Return project/editor configuration and feature availability; no renderer config exposed to UI.</td>
<td><p>• Viewer expands whenever panels collapse.</p>
<p>• No empty properties panel by default.</p>
<p>• Core create/edit actions remain accessible at common desktop widths.</p></td>
</tr>
<tr class="even">
<td>FE-002</td>
<td>Progressive disclosure</td>
<td>Show common tools first; advanced tools contextually or by project capability.</td>
<td>Provide feature flags/capability availability derived from project/media/runtime policy.</td>
<td><p>• Ordinary users never see adapter/plugin/tiling/cache terminology.</p>
<p>• Unavailable tools are hidden or explained in product language.</p></td>
</tr>
<tr class="odd">
<td>FE-003</td>
<td>Save state and unsaved-change handling</td>
<td>Display saving/saved/error state; preserve user editing context.</td>
<td>Support idempotent project updates and conflict/version checks.</td>
<td><p>• Failed save is visible and retryable.</p>
<p>• Navigation warns or safely persists pending edits.</p></td>
</tr>
<tr class="even">
<td>FE-004</td>
<td>Responsive editor behavior</td>
<td>Prioritize viewer; panels collapse into drawers/compact UI on constrained widths.</td>
<td>Return same canonical project model independent of viewport.</td>
<td><p>• No essential action depends on hover.</p>
<p>• Viewer remains usable on tablet-class widths.</p></td>
</tr>
</tbody>
</table>

## 5.2 Dashboard & project creation

<table>
<colgroup>
<col style="width: 20%" />
<col style="width: 20%" />
<col style="width: 20%" />
<col style="width: 20%" />
<col style="width: 20%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>ID</strong></th>
<th><strong>Requirement</strong></th>
<th><strong>Frontend contract</strong></th>
<th><strong>Backend contract</strong></th>
<th><strong>Acceptance criteria</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>PRJ-001</td>
<td>Dashboard</td>
<td>Show projects and primary “Create Experience” action.</td>
<td>List projects authorized for current user with lightweight metadata.</td>
<td><p>• Project list loads without fetching full Experience payloads.</p>
<p>• Create action is visually primary.</p></td>
</tr>
<tr class="even">
<td>PRJ-002</td>
<td>Experience type selection</td>
<td>Offer “360° Image” and “360° Video” creation cards.</td>
<td>Create project with canonical type and schemaVersion.</td>
<td><p>• Type is immutable unless explicit migration exists.</p>
<p>• No renderer adapter choice shown.</p></td>
</tr>
<tr class="odd">
<td>PRJ-003</td>
<td>Project naming</td>
<td>Allow inline/project-settings rename.</td>
<td>Validate and persist name separately from publish slug.</td>
<td><p>• Name errors are field-level.</p>
<p>• Rename does not change existing public URL unless user changes publish slug.</p></td>
</tr>
</tbody>
</table>

## 5.3 Upload & media intelligence

<table>
<colgroup>
<col style="width: 20%" />
<col style="width: 20%" />
<col style="width: 20%" />
<col style="width: 20%" />
<col style="width: 20%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>ID</strong></th>
<th><strong>Requirement</strong></th>
<th><strong>Frontend contract</strong></th>
<th><strong>Backend contract</strong></th>
<th><strong>Acceptance criteria</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>AST-001</td>
<td>Drag/drop + browse upload</td>
<td>Accept supported 360° media through one clear upload surface; show upload progress.</td>
<td>Issue upload target/session; validate ownership, size/type policy, and create logical asset.</td>
<td><p>• Progress survives ordinary UI re-renders.</p>
<p>• Unsupported type is rejected before editor entry.</p></td>
</tr>
<tr class="even">
<td>AST-002</td>
<td>Processing status</td>
<td>Show “uploading / inspecting / processing / ready / failed” in plain language.</td>
<td>Persist processing state and job diagnostics using source state machine.</td>
<td><p>• Editor only enables operations that the current derivative set supports.</p>
<p>• Failure exposes retry/reprocess path.</p></td>
</tr>
<tr class="odd">
<td>AST-003</td>
<td>Media summary</td>
<td>Display useful dimensions/type/360° detection, not raw metadata.</td>
<td>Extract MIME, dimensions, XMP/projection/pose where available, codec/duration/frame rate/bitrate/audio for video.</td>
<td><p>• Creator can tell whether media is ready.</p>
<p>• Technical metadata remains available to internal diagnostics but hidden from normal UI.</p></td>
</tr>
<tr class="even">
<td>AST-004</td>
<td>Correction actions</td>
<td>Offer “Straighten Panorama” / “Re-detect 360° Format” only when relevant.</td>
<td>Persist normalized metadata/correction parameters in asset/project abstraction.</td>
<td><p>• No raw panoData/crop/pose coordinates in normal flow.</p>
<p>• Corrections are previewable and reversible until saved.</p></td>
</tr>
</tbody>
</table>

## 5.4 Hotspots & contextual editing

<table>
<colgroup>
<col style="width: 20%" />
<col style="width: 20%" />
<col style="width: 20%" />
<col style="width: 20%" />
<col style="width: 20%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>ID</strong></th>
<th><strong>Requirement</strong></th>
<th><strong>Frontend contract</strong></th>
<th><strong>Backend contract</strong></th>
<th><strong>Acceptance criteria</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>HOT-001</td>
<td>Visual hotspot placement</td>
<td>“Add Hotspot” enters placement mode; next panorama click creates point interaction.</td>
<td>Create hotspot ID and store renderer-independent position/geometry.</td>
<td><p>• Hotspot appears immediately.</p>
<p>• User does not type yaw/pitch.</p>
<p>• Cancel exits placement without creating data.</p></td>
</tr>
<tr class="even">
<td>HOT-002</td>
<td>Hotspot properties</td>
<td>Contextual panel edits name, type, icon/style, tooltip and action/content.</td>
<td>Validate content/action schema by hotspot type.</td>
<td><p>• Changing type does not leave invalid incompatible fields.</p>
<p>• Validation errors are local and actionable.</p></td>
</tr>
<tr class="odd">
<td>HOT-003</td>
<td>Hotspot action types</td>
<td>Support information, image, video, link and scene action abstractions as phases enable them.</td>
<td>Resolve referenced asset/scene IDs and enforce authorization/URL policy.</td>
<td><p>• Broken references are detected before publish.</p>
<p>• External links follow configured safety policy.</p></td>
</tr>
<tr class="even">
<td>HOT-004</td>
<td>Future geometry compatibility</td>
<td>Frontend component model must not assume every interaction is a pin.</td>
<td>Canonical schema supports geometry.kind with point/polygon/polyline/layer/custom evolution.</td>
<td>• Phase-1 UI may only create points while preserving compatible schema evolution.</td>
</tr>
</tbody>
</table>

## 5.5 Scenes & virtual tours

<table>
<colgroup>
<col style="width: 20%" />
<col style="width: 20%" />
<col style="width: 20%" />
<col style="width: 20%" />
<col style="width: 20%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>ID</strong></th>
<th><strong>Requirement</strong></th>
<th><strong>Frontend contract</strong></th>
<th><strong>Backend contract</strong></th>
<th><strong>Acceptance criteria</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>SCN-001</td>
<td>Scene list</td>
<td>Show named scenes with add/reorder/select; selected scene drives viewer.</td>
<td>Persist scenes with stable IDs and panoramaAssetId.</td>
<td><p>• Selecting scene changes editor canvas without full page reload.</p>
<p>• Delete checks inbound connections.</p></td>
</tr>
<tr class="even">
<td>SCN-002</td>
<td>Connect scenes visually</td>
<td>Creator can link a hotspot/action to another scene.</td>
<td>Validate target scene and serialize connection independently of renderer node config.</td>
<td><p>• Preview navigation matches published navigation.</p>
<p>• Invalid deleted targets are surfaced.</p></td>
</tr>
<tr class="odd">
<td>SCN-003</td>
<td>Large-tour UX</td>
<td>Scene list may paginate/virtualize while keeping editing mental model unchanged.</td>
<td>Support lightweight scene index + fetch-on-open scene definitions.</td>
<td>• 100+ scene experience does not require full scene payload at initial runtime/editor load.</td>
</tr>
<tr class="even">
<td>SCN-004</td>
<td>Scene runtime hints</td>
<td>Advanced UI may expose simple priority/preload intent, not cache internals.</td>
<td>Store runtimeHints and let policy engine translate to preload/cache behavior.</td>
<td>• Default behavior works without creator tuning.</td>
</tr>
</tbody>
</table>

## 5.6 Information, appearance & branding

<table>
<colgroup>
<col style="width: 20%" />
<col style="width: 20%" />
<col style="width: 20%" />
<col style="width: 20%" />
<col style="width: 20%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>ID</strong></th>
<th><strong>Requirement</strong></th>
<th><strong>Frontend contract</strong></th>
<th><strong>Backend contract</strong></th>
<th><strong>Acceptance criteria</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>CNT-001</td>
<td>Information panels</td>
<td>Edit title, description, image/gallery/video, button, link/internal navigation as enabled.</td>
<td>Store structured content; sanitize rich content at trust boundary.</td>
<td><p>• Preview and player render same sanitized content.</p>
<p>• Unsafe markup never executes.</p></td>
</tr>
<tr class="even">
<td>APP-001</td>
<td>Appearance</td>
<td>Theme, primary color, hotspot style, background, controls, typography with sensible defaults.</td>
<td>Persist product-level appearance tokens/settings.</td>
<td><p>• No CSS required for standard branding.</p>
<p>• Invalid color/font selections fall back safely.</p></td>
</tr>
<tr class="odd">
<td>BRD-001</td>
<td>Branding</td>
<td>Logo, company name, brand colors, favicon, watermark, welcome/loading screen as plan supports.</td>
<td>Store branded asset references and publication-safe configuration.</td>
<td><p>• Missing branded asset does not block playback.</p>
<p>• Branding assets use logical asset IDs, not raw upload URLs.</p></td>
</tr>
</tbody>
</table>

## 5.7 Navigation, auto rotation, gallery & immersive controls

<table>
<colgroup>
<col style="width: 20%" />
<col style="width: 20%" />
<col style="width: 20%" />
<col style="width: 20%" />
<col style="width: 20%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>ID</strong></th>
<th><strong>Requirement</strong></th>
<th><strong>Frontend contract</strong></th>
<th><strong>Backend contract</strong></th>
<th><strong>Acceptance criteria</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>NAV-001</td>
<td>Viewer controls</td>
<td>Mouse/touch, zoom, pan, keyboard, fullscreen, navigation buttons and scene navigation switches.</td>
<td>Compile product switches to supported viewer/runtime configuration.</td>
<td>• Unsupported browser feature is gracefully omitted.</td>
</tr>
<tr class="even">
<td>NAV-002</td>
<td>Allowed viewing area</td>
<td>Creator sets visual viewing bounds via product controls.</td>
<td>Persist abstract viewLimits and convert through integration adapter.</td>
<td>• Partial panoramas can prevent navigation into irrelevant regions.</td>
</tr>
<tr class="odd">
<td>NAV-003</td>
<td>Auto rotation</td>
<td>Enable, speed, direction, start automatically.</td>
<td>Validate and compile autorotation policy.</td>
<td><p>• Preview reflects saved behavior.</p>
<p>• Reduced-motion policy can override auto-start where appropriate.</p></td>
</tr>
<tr class="even">
<td>GAL-001</td>
<td>Gallery</td>
<td>Show scene/panorama gallery when enabled.</td>
<td>Capability resolver verifies compatibility before compile.</td>
<td>• Gallery cannot create invalid renderer combination; fallback/design alternative is applied.</td>
</tr>
<tr class="odd">
<td>IMM-001</td>
<td>Gyroscope / stereo / VR</td>
<td>Expose only when product plan and context support; show fallback messaging.</td>
<td>Capability detection and resolver enforce device requirements/dependencies.</td>
<td>• Unsupported device continues in normal 360° mode.</td>
</tr>
</tbody>
</table>

## 5.8 360° video editor

<table>
<colgroup>
<col style="width: 20%" />
<col style="width: 20%" />
<col style="width: 20%" />
<col style="width: 20%" />
<col style="width: 20%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>ID</strong></th>
<th><strong>Requirement</strong></th>
<th><strong>Frontend contract</strong></th>
<th><strong>Backend contract</strong></th>
<th><strong>Acceptance criteria</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>VID-001</td>
<td>Video canvas + timeline</td>
<td>Use same editor shell plus timeline with current time/duration and interaction markers.</td>
<td>Return ready playback derivative(s), duration and timeline data.</td>
<td><p>• Timeline stays synchronized with playback.</p>
<p>• Editor does not become NLE.</p></td>
</tr>
<tr class="even">
<td>VID-002</td>
<td>Timed interactions</td>
<td>Create/move/duplicate/delete interactions at timestamps; actions include info, hotspot, viewpoint, image, video, link, CTA as enabled.</td>
<td>Persist timeline entries with stable IDs, time, action payload and visibility/duration rules.</td>
<td><p>• Moving marker updates time deterministically.</p>
<p>• Seek/preview from selected interaction works.</p></td>
</tr>
<tr class="odd">
<td>VID-003</td>
<td>Device-aware playback</td>
<td>No codec/profile selection exposed to creator.</td>
<td>Select compatible derivative/profile for device; fallback if original unsuitable.</td>
<td><p>• Handheld playback uses mobile-compatible profile when required.</p>
<p>• Failure produces visible fallback/error state.</p></td>
</tr>
</tbody>
</table>

## 5.9 Preview, publish & share

<table>
<colgroup>
<col style="width: 20%" />
<col style="width: 20%" />
<col style="width: 20%" />
<col style="width: 20%" />
<col style="width: 20%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>ID</strong></th>
<th><strong>Requirement</strong></th>
<th><strong>Frontend contract</strong></th>
<th><strong>Backend contract</strong></th>
<th><strong>Acceptance criteria</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>PUB-001</td>
<td>Preview mode</td>
<td>One action hides editor chrome and renders visitor experience.</td>
<td>Compile draft project using same compiler path as publish, with non-public asset access.</td>
<td>• Preview behavior matches published player for same revision.</td>
</tr>
<tr class="even">
<td>PUB-002</td>
<td>Publish form</td>
<td>Name/slug, visibility public/private, publish action.</td>
<td>Validate slug/visibility, create immutable published revision/manifest and publication record.</td>
<td><p>• Publish is atomic from visitor perspective.</p>
<p>• Failure leaves previous published revision intact.</p></td>
</tr>
<tr class="odd">
<td>PUB-003</td>
<td>Share outputs</td>
<td>After publish show Copy Link, Embed, QR.</td>
<td>Return canonical public/player URL and embed metadata.</td>
<td><p>• Share outputs target same published revision/slug.</p>
<p>• Private experiences enforce authorization regardless of URL possession.</p></td>
</tr>
<tr class="even">
<td>PUB-004</td>
<td>Republish</td>
<td>Show draft changes vs currently published state and allow republish.</td>
<td>Create new published revision; keep rollback/audit metadata as implementation allows.</td>
<td>• Existing visitor URL resolves to latest successful revision unless revision pinning is explicit.</td>
</tr>
</tbody>
</table>

# 6. Backend & Platform Product Requirements

## 6.1 Logical backend capabilities

The architecture does not prescribe a microservice topology. The following are logical capabilities and contracts; they may be implemented as a modular monolith or multiple services as long as boundaries remain explicit.

| **Logical capability**   | **Responsibilities**                                                                                                |
|--------------------------|---------------------------------------------------------------------------------------------------------------------|
| Identity & authorization | Authenticated user context, project ownership/access, private experience access checks.                             |
| Project/Experience API   | Canonical draft project CRUD, schema version, scenes, interactions, branding/settings, revision/version checks.     |
| Asset service            | Logical assets, upload sessions, metadata, derivative catalog, processing states, reprocessing.                     |
| Media processing workers | Inspection/XMP, normalization, thumbnails, web derivatives, tiles, video posters/transcodes.                        |
| Experience compiler      | Canonical Experience → runtime manifest + renderer integration configuration.                                       |
| Capability resolver      | Dependencies, incompatibilities, device/media requirements, lazy modules, fallbacks.                                |
| Publishing service       | Slug/visibility, immutable revisions, manifest storage, public/private delivery semantics.                          |
| Runtime/player API       | Published manifest, progressive scene fetch, signed/private asset delivery, runtime config.                         |
| Analytics/telemetry      | Product events + operational runtime metrics, aggregation/query for analytics UI.                                   |
| Shared security services | Sanitization, URL validation, upload/file policy, CSP/embed origin policy, malware scan integration where required. |

## 6.2 Canonical state machines

### Asset processing state

uploaded → inspecting → processing → ready  
└──────────────→ failed ←──────────────┘  
failed → retry/reprocess → inspecting or processing

### Proposed project/publication state

draft → publishing → published  
└──────→ publish_failed → retry  
published + draft changes → publishing → new published revision

Publication states above are proposed implementation conventions. The key product requirement is atomic publish with preservation of the previous successful public revision if a new publish fails.

## 6.3 Backend functional requirements

| **ID** | **Requirement**                  | **Frontend contract**                                                                                   | **Backend contract**                                                                      | **Acceptance criteria**                                                                   |
|--------|----------------------------------|---------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------|
| BE-001 | Renderer-independent persistence | Persist product entities/settings, not raw PSV config.                                                  | Expose canonical project payloads to editor; renderer config is generated/ephemeral.      | • Viewer upgrade does not require canonical data rewrite for non-breaking schema changes. |
| BE-002 | Schema versioning                | Every project/manifest carries schemaVersion.                                                           | Frontend tolerates supported versions and receives migration/read compatibility behavior. | • Unsupported version fails explicitly, never silently corrupts data.                     |
| BE-003 | Optimistic concurrency           | Project writes include revision/version precondition.                                                   | UI handles conflict by reload/merge prompt or safe retry strategy.                        | • Concurrent writes do not silently overwrite newer content.                              |
| BE-004 | Idempotent media/job requests    | Upload completion/reprocess/publish actions are safe against duplicate client retries.                  | UI may retry on network ambiguity without creating duplicate logical assets/publications. | • Duplicate request key/request replay does not multiply side effects.                    |
| BE-005 | Immutable derivatives            | Derivative identifiers/URLs are content/version specific and CDN-cacheable.                             | UI/player receives logical derivative choices, not mutating source URL assumptions.       | • Replacing/reprocessing asset creates new derivative version or cache-safe URL.          |
| BE-006 | Progressive scene fetch          | Large-tour runtime can fetch scene definitions separately.                                              | Player requests scene by ID when needed; editor may lazy-load heavy scene detail.         | • Initial manifest remains lightweight for large tours.                                   |
| BE-007 | Capability-safe compilation      | Compiler invokes resolver before emitting runtime configuration.                                        | Editor can request validation/preflight and display product-language issues.              | • Known incompatible feature combinations cannot be published as raw invalid config.      |
| BE-008 | Safe rich content                | Sanitize and validate authored HTML/URLs on write and/or compile; never trust client sanitization only. | UI can provide rich editor but treats server response as authoritative.                   | • Stored/published untrusted content cannot execute arbitrary script.                     |

# 7. Canonical Data Model

## 7.1 Core entities

| **Entity**                 | **Required concepts**                                                                                                                            |
|----------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------|
| Project / Experience       | id, type, name, schemaVersion, draft revision/version, settings, branding, assets references, scenes or video timeline, publication metadata.    |
| Asset                      | id, source metadata, mediaType, projection, inspection metadata, derivatives, processingStatus, failure diagnostics, created/updated timestamps. |
| Scene                      | id, name, panoramaAssetId, initialView, viewLimits, hotspots, overlays, connections, spatialData, runtimeHints.                                  |
| Hotspot / Interaction      | id, geometry, position/spatial data, appearance, content, action, visibilityRules.                                                               |
| Video timeline interaction | id, timestamp/start/end as required, action kind, payload, viewpoint/geometry, visibility rules.                                                 |
| Publication                | id, projectId, revision, slug, visibility, compiledManifestVersion, publishedAt, status.                                                         |
| Published scene definition | Immutable/derived runtime representation of a scene for progressive fetch when large-tour strategy is used.                                      |

## 7.2 Proposed canonical project shape

{  
"id": "exp\_...",  
"type": "image360 \| video360",  
"name": "Hotel Experience",  
"schemaVersion": 1,  
"revision": 42,  
"settings": { ...product-level settings... },  
"branding": { ...product-level branding... },  
"assets": \["asset\_..."\],  
"scenes": \[ ... \],  
"timeline": \[ ... \],  
"publication": { "slug": "hotel-experience", "visibility": "public" }  
}

## 7.3 Asset derivative model

Asset  
├─ source: original upload reference  
├─ metadata: inspection/XMP/codec/projection data  
├─ processingStatus  
└─ derivatives\[\]  
├─ thumbnail  
├─ lowResolutionBase  
├─ standardWeb  
├─ tiledLevels / cubemap variants  
├─ videoPoster  
├─ desktopVideoProfile  
└─ mobileVideoProfile

## 7.4 Data-model invariants

- All cross-entity links use stable IDs, not display names or transient URLs.

- Canonical project records do not require a specific renderer plugin class or adapter name.

- Deleting an asset/scene with active references is blocked, soft-deleted, or repaired through explicit reference handling.

- Published revisions are immutable from the visitor perspective; republish creates a new successful revision.

- Logical assets remain stable while derivatives can be regenerated/versioned.

- Geometry schema is extensible beyond point markers even if early UI only creates points.

# 8. Proposed API Contract

| **Implementation note:** The endpoint names below are proposed, not mandated by the source architecture. Equivalent GraphQL/RPC/service contracts are acceptable if the same semantics are preserved. |
|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## 8.1 Project/editor API

| **Method** | **Proposed route**                  | **Purpose**                                                                   |
|------------|-------------------------------------|-------------------------------------------------------------------------------|
| GET        | /api/projects                       | List lightweight projects for dashboard.                                      |
| POST       | /api/projects                       | Create image360/video360 draft project.                                       |
| GET        | /api/projects/{id}                  | Load canonical draft Experience.                                              |
| PATCH      | /api/projects/{id}                  | Update product-level fields with revision precondition.                       |
| GET        | /api/projects/{id}/scenes           | List/index scenes; can stay lightweight.                                      |
| POST       | /api/projects/{id}/scenes           | Create scene.                                                                 |
| GET/PATCH  | /api/projects/{id}/scenes/{sceneId} | Read/update scene detail.                                                     |
| POST       | /api/projects/{id}/validate         | Preflight canonical project + capability combinations before preview/publish. |
| POST       | /api/projects/{id}/preview-manifest | Compile protected draft preview manifest.                                     |

## 8.2 Asset/media API

| **Method** | **Proposed route**         | **Purpose**                                                    |
|------------|----------------------------|----------------------------------------------------------------|
| POST       | /api/assets/uploads        | Create upload session / signed target.                         |
| POST       | /api/assets/{id}/complete  | Mark upload complete and enqueue inspection.                   |
| GET        | /api/assets/{id}           | Get logical asset, metadata, status and available derivatives. |
| POST       | /api/assets/{id}/reprocess | Retry/reprocess failed or policy-changed asset.                |
| DELETE     | /api/assets/{id}           | Delete only when authorization/reference rules allow.          |

## 8.3 Publish/player API

| **Method** | **Proposed route**              | **Purpose**                                                        |
|------------|---------------------------------|--------------------------------------------------------------------|
| POST       | /api/projects/{id}/publish      | Compile and atomically publish a new revision.                     |
| GET        | /view/{slug}/manifest           | Resolve published manifest (or equivalent player bootstrap route). |
| GET        | /view/{slug}/scenes/{sceneId}   | Fetch progressive scene definition for large tours.                |
| GET        | /api/projects/{id}/publications | Publication/revision history for owner/admin UI.                   |
| POST       | /api/projects/{id}/unpublish    | Optional product action; implementation/policy decision.           |

## 8.4 Standard API behaviors

- All mutation errors return stable machine-readable error code plus product-safe message.

- Validation errors identify entity/path/field so the editor can focus the relevant control.

- Long-running media processing is asynchronous; API returns current logical asset state rather than holding the upload request open for transcoding/tiling.

- Client retries on ambiguous network failures must not duplicate uploads, reprocess jobs, or publications when idempotency keys are used.

- Authorization is evaluated server-side on every project/private-publication access path.

# 9. Experience Compiler & Published Manifest

## 9.1 Compiler responsibilities

- Validate canonical schema and references.

- Resolve capabilities, dependencies, incompatibilities and required runtime modules.

- Select project/media strategy: standard panorama vs tiled, small-tour vs progressive large-tour, video profile policy.

- Produce renderer-specific configuration through a versioned Viewer Integration Adapter.

- Produce product runtime metadata (branding, analytics IDs, security/publish metadata, fallback rules).

- Reject unresolvable invalid combinations before publication.

- Generate deterministic/versioned published output for cacheability and rollback.

## 9.2 Published manifest requirements

Published Manifest  
├─ manifestVersion / schemaVersion  
├─ experienceId + publicationRevision  
├─ experienceType  
├─ global settings + branding  
├─ initial scene / video  
├─ lightweight scene index (large tour) OR scene definitions (small tour)  
├─ asset/derivative references chosen by policy  
├─ capability/runtime module declarations  
├─ fallback policy  
└─ analytics/telemetry configuration

## 9.3 Small vs large tour behavior

| **Small tour**                                                   | **Large tour**                                                                                              |
|------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------|
| All required scene metadata may be included in initial manifest. | Initial manifest contains initial scene + lightweight scene index; scene details are fetched progressively. |
| Likely adjacent assets may still preload selectively.            | Only likely next scene(s) are prefetched; unrelated full-resolution media is not downloaded.                |
| Simpler startup orchestration.                                   | Reduces startup payload for 100+ scene experiences.                                                         |

# 10. Media Processing & Delivery

## 10.1 Panorama pipeline

Original → Validate → Inspect metadata/XMP/projection → Normalize if needed  
→ Thumbnail → Low-res base → Standard web derivative → Tiles/high levels when policy requires  
→ Store → CDN

## 10.2 Video pipeline

Original → Validate container/codec → Inspect dimensions/duration/audio/bitrate  
→ Poster → Desktop profile → Mobile-compatible profile → Optional additional profiles  
→ Store → CDN

## 10.3 Pipeline requirements

| **ID**  | **Requirement**                | **Frontend contract**                                                                        | **Backend contract**                                                                                           | **Acceptance criteria**                                                  |
|---------|--------------------------------|----------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------|
| MED-001 | Logical asset abstraction      | Show one asset in editor even when many derivatives exist.                                   | Maintain derivative catalog behind asset ID.                                                                   | • Reprocessing derivative does not require editor reference changes.     |
| MED-002 | Automatic derivative selection | Viewer/editor receives best-fit derivative for task/device.                                  | Policy uses media type, viewport/device capability, network class where available, and rendering requirements. | • Highest-resolution original is not always first download.              |
| MED-003 | Low-res-first panorama         | Render low-res/base quickly, then load higher detail as needed.                              | Generate/store base and tile/quality metadata when tiling policy applies.                                      | • First meaningful view does not require full highest-resolution source. |
| MED-004 | Video compatibility            | Create mobile-compatible playback derivative when source may exceed handheld/browser limits. | Inspect codec/dimensions and transcode per policy.                                                             | • Unsupported original does not become the only published source.        |
| MED-005 | Recoverable jobs               | Processing failure does not corrupt Project or source asset.                                 | Store stage/error; support idempotent retry/reprocess.                                                         | • Failed derivative job can be retried independently.                    |

# 11. Capability Resolution & Runtime Orchestration

## 11.1 Capability registry

Capability  
├─ id  
├─ productFeature  
├─ rendererModule  
├─ dependencies\[\]  
├─ incompatibilities\[\]  
├─ deviceRequirements\[\]  
├─ mediaRequirements\[\]  
├─ lazyLoadModule  
└─ fallback

## 11.2 Resolver rules

- Video experience requires a supported video adapter/runtime and a compatible selected derivative.

- Stereo/immersive mode appears/enables only when device/runtime requirements are met; otherwise use normal 360° fallback.

- Map/plan capability requires meaningful spatial data and should not appear for irrelevant projects.

- Tiled media capability requires generated derivative assets.

- Known renderer incompatibilities are resolved by product design/alternative behavior rather than exposing a technical plugin error.

- Heavy/uncommon modules such as map/plan, stereo/VR, video tooling, advanced overlays and specialized adapters should be lazy-loaded where practical.

## 11.3 Runtime lifecycle

| **ID**  | **Requirement**     | **Frontend contract**                                                                             | **Backend contract**                                                            | **Acceptance criteria**                                           |
|---------|---------------------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------|-------------------------------------------------------------------|
| RUN-001 | Viewer lifecycle    | Mount one viewer instance for active canvas/player context; destroy on unmount/navigation.        | Runtime adapter releases listeners/media/GPU-related resources as supported.    | • No duplicate plugin subscriptions after repeated route changes. |
| RUN-002 | Preloading          | Prefetch strongest likely connected scene and optionally a second candidate, not the entire tour. | Policy can use connection importance, graph proximity, history or runtimeHints. | • Network traces show no blanket full-resolution preload.         |
| RUN-003 | Caching             | Reuse recently visited panorama/scene assets with bounded device-aware policy.                    | Cache avoids duplicate requests and applies eviction policy.                    | • Back-navigation is faster without unbounded memory growth.      |
| RUN-004 | Capability fallback | Player detects optional input/device features and downgrades safely.                              | Resolver/runtime returns fallback path.                                         | • Optional feature failure never prevents base 360° navigation.   |

# 12. Security, Privacy & Access

## 12.1 Trust boundary

All authored rich content and uploaded files are untrusted input. Security controls belong in shared platform services and publication/runtime boundaries, not only in frontend components.

| **ID**  | **Requirement**           | **Frontend contract**                                                      | **Backend contract**                                                                                            | **Acceptance criteria**                                                                  |
|---------|---------------------------|----------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------|
| SEC-001 | Rich-content sanitization | Rich editor may provide preview, but frontend sanitization is not trusted. | Sanitize captions, descriptions, tooltips, custom marker/overlay/navigation content before publication/runtime. | • Script/event-handler payloads cannot execute in player.                                |
| SEC-002 | URL validation            | Validate URLs in UI and show errors.                                       | Enforce allowed schemes/external-link policy server-side.                                                       | • javascript:/data abuse or disallowed schemes are rejected by policy.                   |
| SEC-003 | Upload validation         | Restrict selectable file types and show size/type errors.                  | Validate MIME/signature/policy; scan where required; define SVG handling.                                       | • Renamed malicious file is not trusted solely by extension.                             |
| SEC-004 | Private experiences       | UI clearly labels private visibility.                                      | Enforce authorization or signed access for private manifest/assets.                                             | • Knowing a private URL alone is insufficient if product policy requires authentication. |
| SEC-005 | Embed security            | Expose allowed embed options by plan/policy.                               | Support CSP and optional embed-origin controls.                                                                 | • Disallowed origins cannot embed restricted experience when policy is enabled.          |
| SEC-006 | Asset delivery            | Do not leak permanent private origin URLs.                                 | Use signed/private CDN delivery as required.                                                                    | • Expired/unauthorized private asset requests fail safely.                               |

# 13. Analytics & Observability

## 13.1 Required runtime events

| **Event**                     | **Purpose**                           |
|-------------------------------|---------------------------------------|
| experience_load_started       | Start funnel/performance measurement. |
| first_panorama_visible        | Primary perceived performance signal. |
| time_to_interactive           | Runtime readiness.                    |
| scene_changed                 | Tour navigation/engagement.           |
| hotspot_clicked               | Interaction engagement.               |
| video_started / video_stalled | Playback engagement and reliability.  |
| asset_failed                  | Media/CDN/runtime diagnosis.          |
| scene_transition_failed       | Tour failure diagnosis.               |
| viewer_error                  | Renderer/runtime error tracking.      |
| experience_exited             | Session completion/engagement.        |

## 13.2 Telemetry requirements

- Events include experience/publication revision and anonymized/appropriate session/device context required for diagnosis.

- Operational telemetry and product analytics may share events but must remain distinguishable for retention/privacy policy.

- Asset and scene failures include stable error category, not only free-text exception messages.

- Published revision and viewer integration version are attached to errors to support renderer-upgrade regression analysis.

# 14. Performance & Reliability Requirements

## 14.1 Source-derived performance requirements

- Use low-resolution base + progressive higher-detail loading for large panoramas where policy requires.

- Do not preload every scene or every optional module.

- Bound cache/memory usage and avoid duplicate requests.

- Use progressive scene fetching for large tours.

- Generate mobile-compatible video profiles and select them at runtime.

- Cleanly destroy viewer instances/listeners/media resources.

- Use CDN-ready immutable derivative delivery.

## 14.2 Proposed launch SLOs (engineering validation required)

| **Metric**                        | **Proposed baseline**                                                                                               |
|-----------------------------------|---------------------------------------------------------------------------------------------------------------------|
| Non-media CRUD API latency        | p95 ≤ 400 ms inside target production region, excluding client network and long-running jobs.                       |
| Publish compilation latency       | p95 ≤ 3 s for ordinary Phase-1 image experiences when all assets are already ready.                                 |
| Editor local interaction feedback | Visible response to selection/property changes within ~100 ms for normal projects.                                  |
| First panorama visible            | p75 ≤ 2.5 s on defined test profile using optimized derivative; establish separate budgets by device/network class. |
| Scene transition with preload hit | p75 ≤ 1.5 s on defined test profile.                                                                                |
| Media job execution               | Asynchronous; user-facing status updates and retries are required rather than a fixed request timeout.              |
| Runtime error rate                | Track by publication/viewer version; launch gate must define an acceptable threshold from beta telemetry.           |

These numeric values are recommendations added for implementation measurability. They are not present in the supplied architecture and should be calibrated using representative panorama sizes, target markets, device classes, and hosting/CDN region.

# 15. Error Handling & Recovery

| **Failure**                            | **Required product behavior**                                                                                                          |
|----------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------|
| Upload fails                           | Keep project intact; user can retry upload. No phantom ready asset.                                                                    |
| Inspection/processing fails            | Asset becomes failed with safe reason; creator can reprocess or replace asset.                                                         |
| Save conflict                          | Do not silently overwrite; return conflict/version information and preserve current edits where possible.                              |
| Preview compile fails                  | Show entity/field-level issue and link/focus relevant editor control.                                                                  |
| Publish fails                          | Previous published revision remains live. Draft remains editable. Retry is safe.                                                       |
| Runtime asset fails                    | Show graceful fallback/error state; report telemetry; experience shell remains functional when possible.                               |
| Optional immersive feature unsupported | Continue in normal 360° mode.                                                                                                          |
| Broken scene/asset reference           | Block publish or automatically repair only if behavior is explicit and deterministic.                                                  |
| Viewer integration regression          | Versioned adapter + reference suite prevents uncontrolled rollout; rollback to previous integration version is operationally possible. |

# 16. Testing & Quality Strategy

## 16.1 Reference experience suite

- Basic panorama

- Cropped panorama/XMP

- High-resolution panorama

- Multi-scene tour

- Gallery

- Hotspots and rich content

- Map/plan

- Gyroscope/stereo fallback

- 360° video

- Timed interactions

- Advanced overlay when phase enables it

## 16.2 Frontend tests

- Component tests for tool panels, contextual properties, forms, timeline and states.

- Integration tests against mocked/contract API for project save, upload status, preview and publish.

- End-to-end flows: create image experience → upload → hotspot → preview → publish; later video equivalent.

- Responsive/touch accessibility tests; keyboard navigation where supported.

- Visual regression for editor shell and player UI, not for arbitrary panorama pixel content.

## 16.3 Backend/platform tests

- Schema validation and migration compatibility tests.

- Contract tests for idempotency, concurrency/version checks and authorization.

- Media fixtures for full/cropped panoramas, invalid files, large images, video codecs/dimensions, failure recovery.

- Compiler/resolver tests for valid/invalid capability combinations and fallbacks.

- Publish atomicity and previous-revision preservation tests.

- Progressive large-tour fetch/caching/preload tests.

- Security tests for XSS/rich HTML, URL scheme abuse, private manifest/asset access and embed policy.

## 16.4 Release gates

- No P0/P1 security defects in upload, authored content, private access or publication path.

- Reference experience suite passes against pinned viewer integration version.

- No project corruption after failed media job, failed publish, page reload or retry.

- Performance baselines measured on representative devices and asset sizes.

- Runtime telemetry identifies publication revision, viewer version and actionable error category.

# 17. Definition of Done by Phase

## 17.1 Phase 1 DoD

- An authenticated creator can create a 360° image project, upload a supported panorama, see processing status, and enter the editor after a ready derivative exists.

- Creator can visually add/edit/delete a point hotspot and information content without yaw/pitch fields.

- Appearance and branding can be configured through product-level controls.

- Preview uses the same compiler/integration path as publication and hides authoring UI.

- Publishing creates an atomic public/private revision and returns direct URL, embed output and QR target.

- Published runtime uses logical derivatives, supports lifecycle cleanup, emits baseline telemetry, and handles optional capability absence safely.

- Canonical saved data contains no required raw PSV plugin/adapter configuration.

- HTML/URL/upload/private-access security controls are server-enforced.

- Failed processing or publishing is recoverable without project corruption.

## 17.2 Phase 2 DoD

- Multi-scene tours can be authored and connected visually.

- Gallery/navigation/compass/view limits operate through product abstractions and valid resolver combinations.

- Adjacent preload and bounded scene cache are measured and tuned.

- Large-tour mode progressively fetches scene definitions and avoids loading unrelated full-resolution media at startup.

## 17.3 Phase 3 DoD

- 360° video upload produces poster + device-compatible playback profiles.

- Creator can place/move/delete timed interactions on timeline and preview them accurately.

- Player selects compatible profile and records playback/stall telemetry.

- Mobile fallback is validated on representative handheld devices.

# 18. Risks, Dependencies & Open Decisions

## 18.1 Key risks

| **Risk**                                              | **Mitigation / product requirement**                                                    |
|-------------------------------------------------------|-----------------------------------------------------------------------------------------|
| Renderer coupling leaks into database/editor          | Enforce compiler + integration adapter; reject raw viewer config as canonical model.    |
| Large assets make first load slow                     | Derivative pipeline, low-res base, tiling policy, CDN and measurable runtime budgets.   |
| Large tours make manifests heavy                      | Progressive scene index/definition strategy and selective preloading.                   |
| Mobile video incompatibility                          | Transcode/select mobile-compatible profiles; runtime capability detection.              |
| Plugin/adaptor incompatibilities surface to customers | Capability resolver and product-level fallback/alternative behavior.                    |
| Untrusted rich content causes XSS                     | Central sanitization and URL validation, CSP strategy.                                  |
| Viewer upgrades break existing experiences            | Pinned version, adapter isolation, reference suite, manifest/revision observability.    |
| Editor complexity grows with features                 | Configurable tools, search, contextual UI, progressive disclosure, canvas-first layout. |

## 18.2 Open product/engineering decisions

- Maximum upload sizes and accepted containers/codecs by plan.

- Exact criteria that trigger tiled panorama generation vs standard derivative only.

- Small-tour vs large-tour threshold (scene count, manifest size, media graph complexity).

- Cache budgets by device class and whether service worker caching is part of initial runtime.

- Private experience authentication model: account login, signed token/link, password, or plan-specific combination.

- Embed origin controls and custom-domain support by plan.

- Analytics retention/privacy model and whether creator-facing analytics launches in Phase 1 or later.

- Collaboration model, roles and permissions for future teams.

- Rollback/version-history UI scope for publications and drafts.

- Accessibility behavior for reduced motion, keyboard controls, captions/transcripts for embedded video content.

# 19. Requirement Traceability

| **Architecture theme**                             | **PRD sections / requirement families** |
|----------------------------------------------------|-----------------------------------------|
| Canvas-first, simple-by-default editor             | §5.1, FE-001–FE-004                     |
| Upload/media intelligence                          | §5.3, AST-001–AST-004, §10              |
| Hotspots / richer geometry                         | §5.4, HOT-001–HOT-004, §7               |
| Scenes / tours / progressive loading               | §5.5, SCN-001–SCN-004, §9, §11          |
| Appearance / branding / navigation                 | §5.6–5.7                                |
| 360° video / timed interactions                    | §5.8, VID-001–VID-003, §10.2            |
| Preview / publish / share                          | §5.9, PUB-001–PUB-004, §9               |
| Stable Experience model / renderer independence    | §6, BE-001–BE-008, §7, §9               |
| Capability resolver / incompatibilities / fallback | §11                                     |
| Security / trust boundary                          | §12, SEC-001–SEC-006                    |
| Lifecycle / telemetry / observability              | §11.3, §13                              |
| Efficiency / quality bar                           | §14–17                                  |
| Versioned viewer integration                       | §9, §16, §18                            |

# Appendix A — Frontend ↔ Backend Handoff Checklist

- Agree canonical TypeScript/schema definitions for Project, Asset, Scene, Hotspot, TimelineInteraction, Publication and error envelope.

- Agree revision/version field used for optimistic concurrency and autosave strategy.

- Agree upload-session protocol, completion callback, polling/subscription mechanism for processing status, and retry behavior.

- Agree validation error path format so backend can focus frontend controls.

- Agree preview-manifest authentication and asset access rules.

- Agree publish idempotency and atomic revision semantics.

- Agree progressive scene route/contract before implementing large-tour runtime.

- Agree capability/preflight response shape and product-language error mapping.

- Agree analytics event names, required properties and privacy constraints.

- Agree renderer integration version exposure for debugging/telemetry.

# Appendix B — Canonical Error Envelope (Proposed)

```json
{
  "error": {
    "code": "ASSET_NOT_READY",
    "message": "The panorama is still processing.",
    "entityId": "asset_123",
    "path": "scenes[0].panoramaAssetId",
    "retryable": true,
    "details": { "...": "safe structured diagnostics" }
  }
}
```

# Appendix C — Product Language Guardrails

| **Avoid exposing**          | **Use product language**                                    |
|-----------------------------|-------------------------------------------------------------|
| MarkerPlugin                | Hotspot                                                     |
| Virtual Tour node           | Scene                                                       |
| navbar config               | Viewer Controls                                             |
| adapter                     | Upload / Media Quality                                      |
| panoData / poseRoll         | Straighten Panorama                                         |
| EquirectangularTilesAdapter | Optimized High Quality                                      |
| cache policy                | Faster scene switching / automatic optimization             |
| device orientation API      | Motion Navigation / Gyroscope                               |
| renderer incompatibility    | Feature not available together; offer supported alternative |

# Appendix D — PRD Change Policy

Product behavior, acceptance criteria, security requirements, canonical schema invariants, and publish/runtime semantics in this document should be version-controlled. Endpoint naming, internal service topology, infrastructure vendor choices, and renderer-specific implementation details may change without PRD revision if external behavior and contracts remain compatible.

| **Final product principle:** The user interacts with the experience. The Experience Engine, media pipeline, capability resolver, and viewer integration handle the technology. |
|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
