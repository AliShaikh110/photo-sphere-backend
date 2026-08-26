# Sprint 03 — 360° Video Pipeline, Timeline & Device-Aware Playback

> **Execution target:** Backend implementation for the No-Code 360° Experience Platform  
> **Source basis:** Product/Architecture/Runtime Specification Revision 2.0 + Frontend/Backend PRD  
> **Implementation style:** Stack-agnostic. Claude Code must use the repository's existing language, framework, ORM, job system, storage provider, and testing conventions unless the repository explicitly requires a new component.
>
> **Architecture rule:** Persist the platform's canonical Experience model. Never make Photo Sphere Viewer configuration the database model. Renderer-specific configuration is generated through the Experience Compiler / Viewer Integration Adapter.


## 1. Sprint Objective

Deliver the complete backend for **360° video experiences** while reusing the same Project, Asset, Experience Compiler, Publishing, Security, and Telemetry foundations built in Sprints 01–02.

The platform must treat the video editor as an interactive experience builder, not a non-linear video editor.

## 2. Outcomes Required

By sprint completion:

- Users can create `video360` projects.
- 360° video uploads are validated and inspected asynchronously.
- Video metadata includes dimensions, duration, frame rate, bitrate, codec/container, and audio presence.
- Poster images are generated.
- Desktop and mobile-compatible playback derivatives are generated.
- Timeline interactions persist as canonical product entities.
- Timed interactions can represent information, hotspot, viewpoint, image, video, link, and CTA actions as enabled.
- Timeline writes are stable, versioned, validated, and reorder/move safe.
- Preview and publish compile video experiences through the same compiler.
- Runtime media selection chooses a compatible profile for device capability.
- Playback/fallback errors are observable.
- Video start/stall telemetry is supported.
- Existing image/tour behavior remains unchanged.

## 3. In Scope

### Video project
- Enable `video360` project creation.
- Project references a primary logical video asset.
- Video settings as product-level settings.
- Timeline collection.

### Video media processing
- Container/MIME/signature validation.
- Codec inspection.
- Dimensions.
- Duration.
- Frame rate.
- Bitrate.
- Audio presence.
- Poster generation.
- Desktop playback profile.
- Mobile-compatible profile.
- Optional extra profiles only if existing transcoder architecture makes this straightforward.
- Retry-safe transcoding jobs.

### Timeline
- Create interaction at timestamp.
- Update timestamp by move/drag.
- Delete.
- Duplicate.
- Stable IDs.
- Time validation.
- Action payload validation.
- Optional start/end/visibility duration.
- Viewpoint data abstraction.
- Point hotspot geometry where needed.

### Runtime
- Device-capability request/selection contract.
- Compatible derivative selection.
- Fallback behavior.
- Playback telemetry.
- Runtime video error classification.

## 4. Out of Scope for Sprint 03

- Full NLE operations: cuts, trims, transitions, audio mixing, multi-track editing.
- Live 360° MediaStream.
- Dual-fisheye ingest.
- Map/plan.
- VR/stereo implementation beyond capability placeholders.
- Advanced collaboration.
- Public SDK.

## 5. Domain Model Extensions

### `Project`

Enable:

```text
type = video360
videoAssetId
videoSettings
timeline[]
```

Do not create a separate disconnected application model. Reuse canonical Project/Publication systems.

### `TimelineInteraction`

Required concepts:

```text
id
projectId
timeMs
endTimeMs (optional)
kind
geometry/position (optional)
viewpoint (optional)
content
action
visibilityRules
sortOrder or deterministic ordering key
createdAt
updatedAt
```

Recommended interaction kinds:

```text
information
hotspot
viewpoint
image
video
link
cta
```

Canonical kinds are product vocabulary, not renderer event/plugin names.

### `VideoPlaybackProfile`

Represent as asset derivatives.

Required derivative kinds:

```text
videoPoster
videoDesktop
videoMobile
```

Optional future kinds:

```text
videoAdaptiveManifest
videoAdaptiveRendition
```

## 6. Video Asset Processing State

Reuse the Sprint-01 asset state machine.

Within the processing stage, track child job/stage progress such as:

```text
inspect
poster
transcodeDesktop
transcodeMobile
finalize
```

Rules:

- one profile failure should have an actionable status,
- final `ready` policy must be explicit,
- do not mark an asset fully ready if no publishable playback profile exists,
- reprocessing can regenerate one failed profile without changing logical asset ID,
- duplicate queue delivery cannot create duplicate version conflicts.

## 7. Video Inspection

Extract/persist where available:

```text
container
codec
width
height
durationMs
frameRate
bitrate
audioPresent
audioCodec
rotation/orientation metadata
projection/360 metadata where available
compatibility flags
```

The normal frontend does not need every field, but internal diagnostics/compiler policy does.

## 8. Video Transcoding Policy

Create a policy abstraction. Do not hard-code a single codec/bitrate profile into project data.

Minimum behavior:

```text
Original Upload
  ↓
Validate/Inspect
  ↓
Poster
  ↓
Desktop-compatible profile
  ↓
Mobile-compatible profile
  ↓
Store immutable derivatives
  ↓
ready
```

Important source requirement:

- Do not assume the original source is safe for handheld playback.
- Current architecture calls out the handheld risk of very high-width 360° video; the platform must generate/select mobile-compatible profiles.

Exact codecs, bitrate ladders, and storage/transcoder vendor settings are infrastructure choices and should be configuration.

## 9. Timeline API

Implement equivalent semantics:

```http
GET    /api/projects/:projectId/timeline
POST   /api/projects/:projectId/timeline/interactions
PATCH  /api/projects/:projectId/timeline/interactions/:interactionId
DELETE /api/projects/:projectId/timeline/interactions/:interactionId
POST   /api/projects/:projectId/timeline/interactions/:interactionId/duplicate
```

Bulk update may be added for drag-heavy editing:

```http
PATCH /api/projects/:projectId/timeline
```

If bulk update is used:

- require project revision/version precondition,
- validate every interaction,
- make write atomic.

## 10. Timeline Validation Rules

At minimum:

- `timeMs >= 0`.
- `timeMs <= video duration`.
- `endTimeMs`, if present, must be `>= timeMs` and within duration.
- referenced image/video assets must exist and be ready according to use.
- external links follow central URL policy.
- rich content follows central sanitization policy.
- viewpoint payload is schema-valid.
- hotspot geometry is canonical.
- duplicates receive new stable IDs.
- deterministic ordering exists when two events share a timestamp.

## 11. Video Compiler

Extend the Experience Compiler:

```text
Canonical video360 Project
  ↓
schema/reference validation
  ↓
video asset readiness
  ↓
capability resolution
  ↓
timeline normalization
  ↓
playback profile policy
  ↓
Viewer Integration Adapter
  ↓
Preview/Published Manifest
```

Published video manifest should contain product/runtime concepts equivalent to:

```text
experienceId
publicationRevision
experienceType = video360
video asset derivative catalog or runtime profile policy result
poster
settings
branding
timeline interactions
capabilities
fallback policy
runtime modules
viewerIntegrationVersion
telemetry config
```

Do not store the generated viewer-specific configuration back into the Project.

## 12. Device-Aware Playback Contract

The player/runtime may send capability information such as:

```text
viewport class
touch/handheld class
supported codecs
hardware/runtime constraints
network class if available
```

Backend/manifest policy must select or recommend a compatible logical derivative.

Implement one of these patterns, whichever fits the repository:

1. manifest contains ordered profile candidates + constraints, and player chooses; or
2. player calls a profile-selection endpoint; or
3. manifest compiler selects by coarse device class when request context is reliable.

Regardless of pattern:

- fallback must exist,
- private derivatives stay protected,
- profile selection is observable,
- original source must not be the only possible published source.

## 13. Video Capability Resolver Rules

Add/complete:

```text
video360
videoTimeline
timedHotspots
timedViewpoint
videoContent
cta
```

Rules:

- `video360` requires a ready video asset.
- required video runtime adapter/module must be resolvable.
- timeline timestamp must be within media duration.
- content/reference dependencies must be ready.
- unsupported optional capability falls back without breaking baseline video playback.
- video asset profile policy must produce at least one compatible candidate.

## 14. Runtime Events

Add:

```text
video_started
video_paused (optional product analytics)
video_seeked (optional)
video_stalled
video_resumed (optional)
video_ended (optional)
video_profile_selected
video_playback_failed
timeline_interaction_shown
timeline_interaction_clicked
```

Mandatory source-aligned events:

- `video_started`
- `video_stalled`

Operationally, `video_playback_failed` and profile selection are strongly recommended.

Failure event context:

```text
experienceId
publicationRevision
assetId
derivative/profile ID
failure category
currentTimeMs
device/runtime class
viewerIntegrationVersion
```

## 15. API Error Codes to Add

Examples:

```text
VIDEO_ASSET_NOT_READY
VIDEO_PROFILE_UNAVAILABLE
VIDEO_DURATION_UNKNOWN
TIMELINE_TIME_OUT_OF_RANGE
TIMELINE_REFERENCE_INVALID
VIDEO_PLAYBACK_CAPABILITY_UNSUPPORTED
```

Use repository naming conventions; keep stable machine-readable semantics.

## 16. Migrations / Indexes

Add indexes for:

- video project primary asset,
- timeline interaction by project + time,
- derivative kind/version,
- video processing child-job lookup,
- telemetry by experience/revision/event/time.

Avoid storing every transcoder vendor field in canonical project tables. Vendor metadata belongs in processing/derivative diagnostics.

## 17. Tests

### Media fixtures

Include representative:

- valid 360° video,
- source requiring mobile downscale/profile,
- unsupported container or codec,
- corrupt upload,
- video with audio,
- video without audio.

### Pipeline tests

- inspect metadata,
- poster generated,
- desktop profile generated,
- mobile profile generated,
- partial profile failure recoverable,
- duplicate job delivery safe,
- reprocess keeps logical asset ID.

### Timeline tests

- add interaction,
- move interaction,
- duplicate creates new ID,
- delete interaction,
- reject negative time,
- reject time after duration,
- reject invalid end time,
- same timestamp deterministic ordering,
- invalid referenced asset blocks validation/publish,
- unsafe URL/rich content sanitized or rejected.

### Compiler/runtime tests

- preview and publish same normalized timeline,
- video project cannot publish without ready playable profile,
- device class selects appropriate profile candidate,
- fallback path works,
- existing image project compiler unchanged.

### Telemetry tests

- start/stall/failure events accepted,
- malformed events rejected safely,
- telemetry failure does not affect manifest/playback APIs.

## 18. Acceptance Criteria / Sprint Gate

- [ ] `video360` project creation is enabled.
- [ ] Video upload follows logical-asset + async processing architecture.
- [ ] Metadata inspection captures codec/container/dimensions/duration/frame rate/bitrate/audio where available.
- [ ] Poster derivative is generated.
- [ ] Desktop playback derivative is generated.
- [ ] Mobile-compatible playback derivative is generated.
- [ ] Reprocessing one failed derivative does not change logical asset ID.
- [ ] Timeline interaction CRUD uses stable IDs.
- [ ] Moving/duplicating/deleting timeline events is deterministic and concurrency-safe.
- [ ] Timeline times are validated against video duration.
- [ ] Information/hotspot/viewpoint/image/video/link/CTA payload types are representable.
- [ ] Preview compiles the draft through the shared compiler.
- [ ] Publish produces an immutable video manifest.
- [ ] Device-aware playback policy selects/returns compatible profile candidates.
- [ ] Unsupported optional feature does not break normal video playback.
- [ ] `video_started` and `video_stalled` telemetry is supported.
- [ ] Security controls from Sprint 01 also apply to video interactions.
- [ ] Full Sprint-01 and Sprint-02 regression suites pass.

## 19. Claude Code Execution Order

1. Inspect current asset worker/transcoding infrastructure.
2. Enable `video360` canonical project type.
3. Add timeline schema/migrations.
4. Add video inspection.
5. Add poster generation.
6. Add desktop/mobile transcode profiles.
7. Add video processing diagnostics/retry behavior.
8. Implement timeline APIs and validation.
9. Extend capability resolver.
10. Extend Experience Compiler / integration adapter.
11. Add device-aware playback profile policy.
12. Extend preview/publish.
13. Add video telemetry.
14. Add media fixtures and full tests.
15. Run lint/typecheck/tests and update documentation.

## 20. Claude Code Guardrails

- Do not turn the backend into a general-purpose NLE.
- Do not store transcoder vendor settings as canonical Experience fields.
- Do not assume original upload is the safest playback source.
- Do not make timeline timestamps renderer-specific.
- Do not bypass central sanitizer/URL policy for timed content.
- Do not create a second independent publishing system for video.
- Do not regress image/tour compilation.
