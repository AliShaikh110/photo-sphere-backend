# Frontend Runtime Telemetry Contract

The player is the **only** producer of the events the creator analytics views
read. If the player omits a payload key, the corresponding analytics view is
silently empty — the backend accepts the event, but the aggregation finds
nothing to group by. This document is therefore a hard contract, not guidance.

Transport, token audiences and error handling are in
[frontend-api-integration.md](frontend-api-integration.md); event semantics are
in [../prd.md](../prd.md) §13 and [../backend-api.md](../backend-api.md)
"Runtime telemetry".

---

## 1. Transport

```text
POST /api/v1/runtime/events
X-Telemetry-Token: <manifest.telemetry.ingestToken>
{ "events": [ ... ] }        // 1–100 events; a single bare event is also accepted
```

| Rule | Detail |
| --- | --- |
| Authorisation | Visitors use `X-Telemetry-Token` from the manifest. A signed-in creator with at least `viewer` access may instead use the normal session — that is the preview path. |
| Scope | The token is bound to one experience, publication revision and viewer integration version. **One mismatched event rejects the whole batch** with `403 TELEMETRY_SCOPE_MISMATCH`. Never mix experiences or revisions in one batch. |
| Expiry | `telemetry.ingestTokenExpiresAt` (default 6 hours). After it, stop emitting silently. |
| Failure | Fire-and-forget. Never block playback, never retry more than once, never surface a telemetry error to a visitor. |
| Batching | Buffer up to 20 events or 5 seconds, whichever comes first. Flush immediately for `experience_load_started`, `first_panorama_visible` and any failure event. |
| Unload | Flush on `visibilitychange → hidden` and `pagehide` using `navigator.sendBeacon` or `fetch(..., { keepalive: true })`. |
| Duplicates | Duplicate `eventId` delivery is safe by design, so a retry after an ambiguous failure is correct. |

---

## 2. Required envelope

Every event carries the same base fields:

| Field | Source | Notes |
| --- | --- | --- |
| `eventId` | `crypto.randomUUID()` | Unique per event; stable across retries of the same event. |
| `eventName` | See §3 | Must be one the manifest's `telemetry.events` declares. |
| `experienceId` | `manifest.experienceId` | |
| `publicationRevision` | `manifest.publicationRevision` | |
| `viewerIntegrationVersion` | `manifest.viewerIntegrationVersion` | The version actually rendered with. |
| `sessionId` | §4 | 8–128 characters, privacy-safe. |
| `deviceContext` | §4 | Coarse only. |
| `runtimeContext` | Optional | Small, safe diagnostic object. |
| `occurredAt` | ISO 8601 **with offset** | The moment the event happened, not the moment it flushed. |

Send only events the manifest declares. Emitting an undeclared name wastes a
round trip and may fail validation.

---

## 3. Event catalogue

### 3.1 Baseline — every experience

| Event | When | Payload |
| --- | --- | --- |
| `experience_load_started` | Manifest resolved, before the viewer is constructed | — |
| `first_panorama_visible` | First panorama pixel painted | **`durationMs`** — ms from load start. Drives the p50/p75/p95 performance view. |
| `time_to_interactive` | Viewer navigable and markers mounted | **`durationMs`** |
| `scene_changed` | A scene becomes active, including the first | **`sceneId`** — *required by the scene analytics view* |
| `hotspot_clicked` | A hotspot is activated | **`hotspotId`** — *required by the interaction analytics view*; include `sceneId` |
| `asset_failed` | A media object could not be loaded after fallbacks | `assetId`, `derivativeId`, `kind`, `failureCategory` |
| `scene_transition_failed` | A transition did not complete | **`sourceSceneId`**, **`targetSceneId`**, **`failureCategory`**, `assetId?` — all validated |
| `viewer_error` | Renderer or runtime exception | `errorCategory`, safe `message` |
| `experience_exited` | Unload / navigation away | `durationMs` (session length) |
| `capability_fallback` | An optional capability was skipped at runtime | **`capabilityId`**, **`reason`**, `fallbackApplied?` |

`capability_fallback.reason` must be one of the backend's capability issue codes,
typically `FEATURE_DEVICE_UNAVAILABLE` or `FEATURE_UNAVAILABLE`.

### 3.2 Spatial — when map or plan is published

| Event | When | Payload |
| --- | --- | --- |
| `overlay_clicked` | An overlay is activated | **`overlayId`**, `sceneId?`, `geometryKind?` |
| `map_interaction` | Map or plan interaction | **`surface`** (`map` \| `plan`), **`action`** (`scene_selected` \| `zoom` \| `pan` \| `opened` \| `closed`), `sceneId?`, `planId?` |

### 3.3 Video — every `video360` experience

| Event | When | Payload |
| --- | --- | --- |
| `video_started` | Playback begins | `assetId`, `derivativeId`, `profileId`, `durationMs` |
| `video_paused` / `video_resumed` / `video_seeked` | Playback control | `currentTimeMs` |
| `video_stalled` | Buffering beyond the debounce threshold | `currentTimeMs` |
| `video_ended` | Playback completes | `durationMs` |
| `video_profile_selected` | A profile is chosen, local or server-side | **`assetId`**, **`derivativeId`**, **`profileId`**, `reason?`, `candidateProfileIds?` |
| `video_playback_failed` | Playback cannot proceed | **`assetId`**, **`failureCategory`**, `derivativeId?`, `profileId?`, `currentTimeMs?` |
| `timeline_interaction_shown` | An interaction becomes visible | **`interactionId`**, **`kind`**, `timeMs?` |
| `timeline_interaction_clicked` | An interaction is activated | **`interactionId`**, **`kind`**, `timeMs?` |

`video_playback_failed.failureCategory` is one of `profile_unavailable`,
`media_unavailable`, `decode_failed`, `codec_unsupported`, `network_error`,
`autoplay_blocked`, `viewer_error`, `unknown`.

`profileId` is `desktop` or `mobile` only.

---

## 4. Session identity and device context

### 4.1 `sessionId`

- Generated per player session with `crypto.randomUUID()`.
- Held in memory (and optionally `sessionStorage` so a reload within one visit
  stays one session).
- Never derived from the account, email, IP, or any stable device fingerprint.
- Never reused across experiences.

### 4.2 `deviceContext`

Coarse categories only:

```text
{ "class": "constrained" | "standard" | "capable",
  "handheld": boolean,
  "viewport": "compact" | "standard" | "wide" }
```

Do not send user agent strings, screen dimensions, GPU renderer strings,
hardware identifiers, or precise network measurements. PRD §13.2 requires
anonymised context sufficient for diagnosis and no more.

---

## 5. Payload keys the analytics views depend on

The backend's event schema is permissive (`passthrough`) for most payloads, so a
missing key produces **no error** — only an empty dashboard. These are the keys
the analytics queries group by:

| Analytics view | Event | Required payload key |
| --- | --- | --- |
| `.../analytics/scenes` | `scene_changed` | `sceneId` |
| `.../analytics/scenes` | `scene_transition_failed` | `targetSceneId` |
| `.../analytics/interactions` | `hotspot_clicked` | `hotspotId` |
| `.../analytics/interactions` | `overlay_clicked` | `overlayId` |
| `.../analytics/interactions` | `timeline_interaction_shown` / `_clicked` | `interactionId` |
| `.../analytics/interactions` | `map_interaction` | `surface` |
| `.../analytics/video` | `video_profile_selected` | `profileId` |
| `.../analytics/video` | `video_playback_failed` | `failureCategory` |
| `.../analytics/summary` (performance) | `first_panorama_visible`, `time_to_interactive` | `durationMs` |

Verifying these keys is an explicit acceptance criterion of FE-03, FE-05 and
FE-06, and a prerequisite for FE-08.

---

## 6. Preview and diagnostics

A signed-in creator may report without an ingest token by using the ordinary
session. Use this for `/viewer/[projectId]` so preview sessions are measurable,
and mark them in `runtimeContext` (for example `{ "surface": "preview" }`) so
analytics readers can distinguish creator preview traffic from visitor traffic.

Preview events still carry `publicationRevision`; for a draft preview that value
is `null` in the manifest, so preview telemetry cannot be attributed to a
published revision — that is expected.

---

## 7. Privacy and safety rules

1. No personal data in any payload. No email, name, account id, IP or precise
   location.
2. No signed URLs, tokens or storage keys in `runtimeContext` or error messages.
3. Error messages are truncated and free of stack traces and internal paths.
4. Telemetry never blocks, delays or degrades playback.
5. If the visitor's browser signals a global "do not track" preference, the
   deployment may disable telemetry entirely; the player must keep working with
   telemetry switched off.
