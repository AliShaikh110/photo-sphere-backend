# Frontend Sprint 06 — 360° Video, Timeline & Device-Aware Playback

> **Depends on:** [FE-04](fe-sprint-04-image-editor-publish.md) (editor shell), [FE-03](fe-sprint-03-viewer-runtime-player.md) (runtime), [FE-02](fe-sprint-02-media-upload-assets.md) (video upload)
> **May run in parallel with:** [FE-05](fe-sprint-05-tours-navigation-progressive.md)
> **Backend basis:** backend Sprint 03 (video pipeline, timeline, playback policy), implemented
> **Runtime contract:** [../frontend-viewer-runtime.md](../frontend-viewer-runtime.md) §9

---

## 1. Sprint Objective

Deliver the complete `video360` experience: assign a 360° video to a project,
author timed interactions on a familiar timeline, and play the result back on
desktop and handheld devices with the right playback profile chosen
automatically.

The creator places interactions on a timeline. They never choose a codec, a
resolution or a playback profile.

---

## 2. Outcomes Required

By sprint completion:

- A `video360` project can have a ready 360° video assigned as its primary
  video.
- Video settings (autoplay, loop, muted, controls, timeline visibility, start
  time, quality preference) are editable as product-level preferences.
- The editor shows the video canvas plus a timeline with current time, duration
  and interaction markers, staying synchronised with playback.
- All seven interaction kinds can be created, edited, moved, duplicated and
  deleted, each with a type-appropriate payload form.
- Dragging markers is smooth and commits atomically through the batch endpoint.
- Timeline validation errors (out of range, invalid payload, unready references)
  are field-level and actionable.
- The player selects a compatible playback profile automatically, falls back
  safely, and reports the selection.
- Timed interactions appear, hide, pause playback and change viewpoint exactly
  as authored, including after seeking in both directions.
- Video and timeline telemetry is complete.
- A handheld device plays back with a mobile-compatible profile.

---

## 3. Dependencies

| Dependency | Status |
| --- | --- |
| FE-02 video upload, profile status, targeted reprocess | Required |
| FE-03 Viewer Runtime, module registry, telemetry | Required |
| FE-04 editor shell, save controller, preview, publish | Required |
| Backend timeline routes, video compiler, playback profile route | Implemented |
| Backend video transcoding configured (ffmpeg) | Operator setup — [../../runbook.md](../../runbook.md) §Video transcoding |

---

## 4. In Scope

### Video project setup
- Create a `video360` project with `videoSettings`.
- Assign the primary video with `PATCH { videoAssetId }`.
- Replace the primary video, with a warning about existing timeline entries.
- Video settings form.
- Playback profile availability display, including
  `metadata.unavailablePlaybackProfiles` and targeted reprocess.

### Timeline editor
- Timeline rail: ruler, playhead, duration, zoom, scrubbing.
- Markers positioned by `timeMs`, with a duration bar when `endTimeMs` is set.
- Drag to move; drag an edge to change the end time; snapping to the playhead
  and to other markers.
- Multi-select drag committing through `PATCH /timeline`.
- Add at playhead, duplicate, delete, jump to marker, play/pause while editing.
- Deterministic ordering by `(timeMs, sortOrder, id)`, matching the compiled
  order the visitor gets.
- Keyboard: space to play/pause, arrows to nudge the selected marker, Delete to
  remove.

### Interaction authoring
Per-kind forms:

| Kind | Required payload | Form |
| --- | --- | --- |
| `information` | `content` | Title, description, rich body, button + link |
| `hotspot` | `position` | Placed by clicking the video canvas while paused |
| `viewpoint` | `viewpoint.headingDegrees`, `viewpoint.pitchDegrees` | Captured with "Use current view", plus cut/smooth and transition duration |
| `image` | `content.imageAssetId` | Asset picker (`image` / `logo`) |
| `video` | `content.videoAssetId` | Asset picker (`video`) |
| `link` | `action.kind = openUrl` | URL + label |
| `cta` | `content.ctaLabel` or an `openUrl` action | Label, optional URL, emphasis |

Plus shared visibility rules: enabled, `persistUntilDismissed`,
`pauseVideoWhenShown`, and an optional end time.

### Player runtime
- `video-panorama` and `video-timeline` module loading.
- Ordered client-side profile selection with the server endpoint as fallback.
- Poster display, autoplay policy handling, muted-autoplay fallback.
- Timeline scheduler with correct seek semantics.
- Viewpoint transitions (cut and smooth).
- Playback controls consistent with `videoSettings`.
- Video and timeline telemetry.

---

## 5. Out of Scope for FE-06

- Scenes, tours, gallery, compass, map, plan — video projects have no scenes and
  the backend returns `422 PROJECT_TYPE_MISMATCH` for scene routes.
- Overlays and advanced geometry on video.
- Live 360° input — no provider is enabled; `501 LIVE_SOURCE_NOT_SUPPORTED`.
- Any non-linear editing: trimming, splitting, transitions, audio mixing
  (PRD §2.2).
- Adaptive-bitrate streaming beyond the profiles the backend produces.
- Analytics dashboards (FE-08).

---

## 6. Routes & Screens

No new routes. New surfaces:

| Surface | Location |
| --- | --- |
| Video tool (source, settings, profiles) | `/experiences/[projectId]` tool panel |
| Timeline rail | Below the canvas in the editor, `video360` only |
| Interaction properties | Properties panel |
| Video player | `/viewer/[projectId]` and `/view/[slug]` |

The timeline mounts only once `durationMs` is known; until then it shows a
"preparing your video" state and the timeline is read-only.

---

## 7. Frontend Work Breakdown

### 7.1 Types
`TimelineInteraction`, `TimelineInteractionKind`, `TimelineContent`,
`TimelineAction`, `TimelineVisibilityRules`, `Viewpoint`, `VideoSettings`,
`CompiledVideoMedia`, `VideoPlaybackProfile`, `VideoSelectionPolicy`,
`VideoPlaybackFailureCategory`.

### 7.2 Services
`timeline-service.ts`: `getTimeline`, `createInteraction`, `updateInteraction`,
`deleteInteraction`, `duplicateInteraction`, `batchUpdateTimeline`.
`player-service.ts` gains `selectPlaybackProfile`.

### 7.3 Editor features
`features/video/` — source assignment, settings form, profile availability.
`features/timeline/` — rail, ruler, playhead, markers, drag engine, selection,
keyboard handling, per-kind property forms.

### 7.4 Runtime additions
`runtime/video-controller.ts` — profile selection, poster, autoplay policy,
playback state, failure categorisation.
`runtime/timeline-scheduler.ts` — active-set computation from current time, seek
handling, show/hide, pause-on-show, viewpoint transitions.

### 7.5 Drag engine
Local optimistic positions during a drag; one atomic
`PATCH /timeline` on drop; full rollback on rejection. Never one request per
mouse move.

---

## 8. Backend / API Integrations

| Method | Route | Precondition | Notes |
| --- | --- | --- | --- |
| PATCH | `/api/v1/projects/:projectId` | `revision` | Sets `videoAssetId` and `videoSettings`. `422 INVALID_ASSET_REFERENCE` if the asset is not an available `video360`. |
| GET | `/api/v1/projects/:projectId/timeline` | — | Total deterministic order plus `durationMs`, which is `null` while preparing. |
| POST | `.../timeline/interactions` | `projectRevision` | Kind-specific required payload. |
| PATCH | `.../timeline/interactions/:id` | `projectRevision` | All fields optional; moving is a `timeMs` update. Changing `kind` clears foreign payload sections. |
| DELETE | `.../timeline/interactions/:id` | `projectRevision` | JSON body. |
| POST | `.../timeline/interactions/:id/duplicate` | `projectRevision` | New stable id. Omitting `timeMs` copies the source time; supplying one shifts `endTimeMs` by the same amount, clamped to duration. |
| PATCH | `.../timeline` | `projectRevision` | Atomic multi-move. All entries validated before any write; a rejected batch changes nothing. |
| POST | `/view/:slug/playback-profile` | — | Optional server-side selection. `private, no-store`. |
| POST | `/api/v1/assets/:assetId/reprocess` | `Idempotency-Key` | `{ "profiles": ["mobile"] }` for a targeted retry. |

### 8.1 Timeline error handling

| Condition | Code | UI |
| --- | --- | --- |
| No video assigned | `422 VIDEO_ASSET_NOT_ASSIGNED` | Timeline hidden; prompt to add a video. |
| Video still processing | `409 VIDEO_ASSET_NOT_READY` (retryable) | Read-only timeline; keep polling. |
| Duration not yet inspected | `409 VIDEO_DURATION_UNKNOWN` (retryable) | Same. |
| Time outside the video | `422 TIMELINE_TIME_OUT_OF_RANGE` | Clamp the drag and show a field error. |
| Referenced media missing or unready | `422 TIMELINE_REFERENCE_INVALID` | Field error on the picker. |
| Payload incomplete for the kind | `422 TIMELINE_PAYLOAD_INVALID` | Field errors on the missing inputs. |
| Timeline on an image project | `422 TIMELINE_NOT_AVAILABLE` | Never call it — branch on `project.type`. |

### 8.2 Playback profile selection

`manifest.video.profiles[]` is ordered best-first, handheld-safe candidates
leading, each with `constraints { maxWidth, handheldSafe, mimeType }`.
`selectionPolicy` supplies `handheldMaxWidth`, `defaultProfileId`,
`fallbackProfileId` and `selectionUrl`.

Select locally by default. Call `selectionUrl` only when local selection is
inconclusive. `422 VIDEO_PLAYBACK_CAPABILITY_UNSUPPORTED` means no published
profile fits — show the playback error rather than attempting an unsupported
source.

---

## 9. State, Cache & Invalidation

- `timeline` — `staleTime: 0`. While `durationMs` is `null`, poll alongside the
  video asset.
- Every timeline mutation increments the project revision; write it back into
  `project` before invalidating `timeline`.
- Drag state is local until drop; the batch response replaces it.
- The preview manifest recompiles on revision change, as in FE-04.
- The selected playback profile is session state in the runtime, not query state.

---

## 10. UX & Responsive Requirements

- The editor shell is unchanged; only the timeline is added (PRD VID-001).
- The timeline stays synchronised with playback, and the playhead is smooth at
  60 fps.
- The editor must not become an NLE: no trimming, no tracks, no clip editing
  (PRD VID-001, product architecture §24).
- Moving a marker updates its time deterministically, and "preview from here"
  seeks accurately (PRD VID-002).
- No codec, profile, bitrate or resolution choice is ever exposed (PRD VID-003).
  Quality preference is `automatic` / `data saver` / `high` only.
- Below `md`, timeline dragging is replaced by a list of interactions with
  numeric time entry via a time picker (mm:ss.mmm), and the reason is stated.
- Keyboard support: space, arrow nudge, Delete, Tab between markers.
- Playback failures produce a visible fallback state, never a black canvas
  (PRD VID-003).
- Reduced motion suppresses smooth viewpoint transitions in favour of cuts.

---

## 11. Error, Loading & Empty States

| Situation | Behaviour | Telemetry |
| --- | --- | --- |
| No video assigned | Canvas empty state pointing at the Video tool. | — |
| Video processing | Poster or placeholder plus stage progress; read-only timeline. | — |
| One profile unavailable | Playback continues on the surviving profile; advisory plus targeted reprocess. | — |
| No compatible profile | Poster plus playback error. | `video_playback_failed` (`profile_unavailable`) |
| Autoplay blocked | Poster plus a play control; not an error state. | `video_playback_failed` (`autoplay_blocked`) |
| Decode failure | Step to the next candidate profile, then the error state. | `video_playback_failed` (`decode_failed`) |
| Stalling | Buffering indicator after a debounce. | `video_stalled` |
| Batch move rejected | Restore pre-drag positions; explain which entry failed. | — |

---

## 12. Acceptance Criteria / Sprint Gate

1. A `video360` project can be created, a 360° video uploaded and assigned, and
   the timeline appears once `durationMs` is known.
2. All seven interaction kinds can be created with valid payloads; an incomplete
   payload produces field-level errors, not a toast.
3. Changing an interaction's kind leaves no incompatible fields, matching the
   server's stored result.
4. Dragging five selected markers issues **one** `PATCH /timeline`, and a
   rejected batch leaves the timeline and revision unchanged.
5. Duplicating an interaction with a new `timeMs` shifts `endTimeMs` by the same
   amount, clamped to the duration.
6. The interaction order shown in the editor matches the order the published
   player applies, including ties at the same timestamp.
7. Preview and published playback show interactions at identical times.
8. Seeking backwards re-arms interactions; seeking forwards does not fire every
   skipped interaction.
9. `pauseVideoWhenShown` pauses on show and resumes on dismiss;
   `persistUntilDismissed` survives past `endTimeMs`.
10. A handheld device (or an emulated handheld profile) selects a mobile-safe
    profile, and the trace shows the desktop profile was not fetched
    (PRD VID-003).
11. Autoplay rejection falls back to poster plus play control and emits
    `video_playback_failed` with `autoplay_blocked`.
12. `video_profile_selected` carries `assetId`, `derivativeId` and `profileId`;
    `timeline_interaction_shown` and `_clicked` carry `interactionId` and `kind`.
13. No creator-facing string contains "codec", "bitrate", "transcode",
    "container", "H.264" or "profile ladder".

---

## 13. Verification Requirements

- Unit: active-set computation across forward and backward seeks; drag-to-batch
  payload construction; duplicate time shifting and clamping; kind-change field
  clearing; local profile selection against synthetic device facts.
- Integration: full authoring flow against a live backend, including a video
  where the mobile profile deliberately failed.
- Device: real handheld playback (iOS Safari and Android Chrome) confirming the
  mobile-compatible profile and correct autoplay behaviour.
- Performance: playhead remains smooth with 100 interactions on the timeline;
  scheduler work per frame stays bounded.
- Telemetry: assert every video and timeline event and its required payload keys.

---

## 14. Execution Order

1. Video types, `timeline-service`, `videoSettings` form.
2. Primary video assignment and profile availability display.
3. Timeline rail: ruler, playhead, scrubbing, playback sync.
4. Markers, selection, add at playhead, delete, duplicate.
5. Drag engine with atomic batch commit and rollback.
6. Per-kind property forms with validation mapping.
7. Runtime `video-controller`: profile selection, poster, autoplay policy.
8. Runtime `timeline-scheduler`: show/hide, pause-on-show, viewpoint transitions,
   seek semantics.
9. Video and timeline telemetry.
10. Player integration for `experienceType: 'video360'`, replacing FE-03's
    unsupported state.
11. Device verification and gate.

---

## 15. Guardrails

1. Never call scene routes on a `video360` project, or timeline routes on an
   `image360` project.
2. Never issue a request per drag frame; commit once, atomically.
3. Never expose codecs, bitrates, containers or transcode settings.
4. Never assume the original upload is playable; always use the published
   profiles.
5. Never block playback on telemetry, and never surface a telemetry failure.
6. Never build trimming, splitting, tracks or audio mixing.
7. Never mix timeline units: milliseconds for product logic, seconds only when
   binding the renderer.
8. Never let a viewpoint transition run when the visitor prefers reduced motion.
9. Do not add overlays, map or plan features to video — they are FE-07 and apply
   to `image360`.
