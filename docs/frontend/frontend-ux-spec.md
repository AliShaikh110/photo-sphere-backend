# Editor Shell & UX Behaviour Specification

Executable detail for the UX direction in
[../product_architecture.md](../product_architecture.md) §7–§11, §25, §32 and the
requirements in [../prd.md](../prd.md) §5. The frontend TRD
([frontend_trd.md](frontend_trd.md) §4, §11) establishes the shape; this document
fixes the behaviour — geometry, state machines, breakpoints and copy rules —
so two implementers produce the same editor.

---

## 1. Editor shell layout

```text
┌──────────────────────────────────────────────────────────────────────┐
│ ← Projects   [Experience name]        Saved ✓   Preview  Publish     │  56px
├───────┬──────────────────────────────────────────────┬───────────────┤
│       │                                              │               │
│ TOOL  │                360° VIEWER                   │  PROPERTIES   │
│ PANEL │              (always dominant)               │ (contextual)  │
│ 280px │                                              │    320px      │
│       │                                              │               │
└───────┴──────────────────────────────────────────────┴───────────────┘
                    (video360 adds a timeline rail below the viewer)
```

| Region | Width | Rule |
| --- | --- | --- |
| Top bar | full, 56 px | Back, editable name, save state, Preview, Publish. Publish is visible only to `admin`/`owner`. |
| Tool panel | 280 px expanded / 56 px collapsed | Collapsible. Collapsed shows icons with tooltips only. |
| Viewer | remainder | **Never below 50% of viewport width** at any breakpoint above `md`. Absorbs all space freed by collapsing panels. |
| Properties | 320 px | Mounted **only** when something is selected. Never rendered empty. |
| Timeline (video) | full width, 120 px | `video360` only, and only once `durationMs` is known. |

### 1.1 Panel states

| State | Composition | Trigger |
| --- | --- | --- |
| Default | Tool panel + Viewer | Editor open, nothing selected |
| Selected | Tool panel + Viewer + Properties | An entity is selected |
| Focus | Collapsed tools + Viewer (+ Properties) | Creator collapses the tool panel |
| Preview | Viewer only, no editor chrome | Preview action |

Panel collapse state persists per user in `localStorage`; selection state does
not survive reload.

### 1.2 Viewer resize

The viewer must recompute its size when a panel opens or closes, on window
resize and on timeline mount. Debounce to one resize per animation frame and
never let a transition leave the canvas letterboxed.

---

## 2. Tool registry

Tools are data, not hard-coded panels: `{ id, label, icon, group, availability,
sprint }`. This is what makes progressive disclosure (PRD FE-002) and
configurable tools (product architecture §10) possible.

| Tool | Availability rule | Sprint |
| --- | --- | --- |
| Media | Always | FE-02 |
| Hotspots | `image360`, and a ready panorama exists | FE-04 |
| Information | Always | FE-04 |
| Appearance | Always | FE-04 |
| Branding | Always | FE-04 |
| Settings | Always | FE-04 |
| Scenes | `image360` | FE-05 |
| Gallery | `image360` and scene count > 1 | FE-05 |
| Navigation | Always | FE-05 |
| Auto Rotation | `image360` | FE-05 |
| Compass | `image360`, advanced group | FE-05 |
| View Limits | `image360`, advanced group | FE-05 |
| Video | `video360` | FE-06 |
| Timeline | `video360` and `durationMs` known | FE-06 |
| Map | `image360` and at least one scene has world coordinates | FE-07 |
| Plan | `image360` and at least one plan exists | FE-07 |
| Overlays | `image360`, advanced group | FE-07 |
| Motion / VR | Advanced group; capability registry reports availability | FE-07 |
| Quality | Advanced group | FE-07 |
| Analytics | Published at least once | FE-08 |

### 2.1 Availability sources

1. `project.type` — hard branch.
2. Draft content — for example Map appears only once a scene carries
   coordinates, mirroring the compiler's own fallback rule.
3. `GET /api/v1/platform/capabilities` — the capability registry, in product
   terms. A capability the deployment reports as unavailable must be hidden,
   never shown disabled with a technical explanation (PRD FE-002).

### 2.2 Disclosure rules

- Common tools first; the advanced group is collapsed by default.
- A tool the project cannot use is **hidden**, not greyed out, unless the reason
  is something the creator can fix — then show it with a plain-language hint
  ("Add a scene location to use the map").
- Tool search (product architecture §11) is deferred until the registry exceeds
  roughly twelve visible entries; the registry shape already supports it.

---

## 3. Hotspot placement state machine

PRD HOT-001: the creator clicks the panorama; they never type an angle.

```text
        ┌──────┐  "Add Hotspot"   ┌───────────┐  click on panorama  ┌──────────┐
        │ idle │ ───────────────► │ placing   │ ──────────────────► │ selected │
        └──────┘                  └───────────┘                     └──────────┘
           ▲                        │  Esc / click "Cancel"              │
           └────────────────────────┴────────────────────────────────────┘
```

| State | Behaviour |
| --- | --- |
| `idle` | Normal navigation. Clicking an existing hotspot selects it. |
| `placing` | Crosshair cursor, persistent hint banner "Click anywhere on the panorama to place your hotspot", `Esc` cancels. Panning still works; a drag is not a placement. |
| `selected` | Hotspot exists and is persisted; the properties panel is open and focused on the name field. |

Rules:

- The hotspot appears **immediately** on click (optimistic), before the mutation
  resolves. A failed create removes it and shows a retryable error.
- Cancelling from `placing` creates nothing.
- Distinguish click from drag with a movement threshold (~5 px) so panning never
  drops a hotspot.
- The click position is converted to `{ coordinateSystem: 'spherical_degrees',
  longitudeDegrees, latitudeDegrees }` by the Viewer Runtime. Degrees never
  appear in the UI.
- Dragging an existing hotspot updates its position with the same debounce as
  other property edits.

---

## 4. Save, conflict and publish states

### 4.1 Save indicator

```text
idle ──edit──► dirty ──600ms debounce──► saving ──ok──► saved ──3s──► idle
                                            │
                                            └──error──► error (retry available)
                                            └──409────► conflict (dialog)
```

| State | Top-bar affordance |
| --- | --- |
| `idle` | Nothing |
| `dirty` | "Unsaved changes" |
| `saving` | Spinner + "Saving" |
| `saved` | Check + "Saved" for 3 seconds |
| `error` | Warning + "Couldn't save" + **Retry** |
| `conflict` | Warning + conflict dialog |

Leaving the editor while `dirty`, `saving` or `error` warns via
`beforeunload` and the router's navigation guard.

### 4.2 Conflict dialog

Copy: *"Someone else changed this experience while you were editing."*
Actions: **Reload latest** (discard local change) and, where the pending change
is a safe whole-field replacement, **Retry my change**. No silent overwrite —
see [frontend-api-integration.md](frontend-api-integration.md) §3.2.

### 4.3 Preview

One action, `Preview`, hides all editor chrome and renders the visitor
experience through the shared Viewer Runtime. Exit returns to the exact editor
state, including selection and panel layout. Optional device simulation
(compact viewport, touch input, reduced capability) is presented in product
language — "Phone", "Tablet", "Desktop" — never as browser internals.

Preview must run preflight first
(`POST /projects/:id/validate`); blocking issues open the issues panel instead
of the preview.

### 4.4 Publish

```text
Publish ─► preflight ─► errors?  ─yes─► issues panel (focus by `path`)
                          │no
                          ▼
                   publish dialog (name, slug, visibility)
                          ▼
                   POST /publish  + Idempotency-Key
                          ▼
              success ─► share panel: Copy Link · Embed · QR
              failure ─► error state; previous published revision still live
```

The slug field validates locally (lowercase, hyphenated, no spaces) and treats
`409 SLUG_ALREADY_EXISTS` as a field error. Visibility copy is explicit:
"Anyone with the link can view" versus "Only people you allow can view".

Republish shows that the draft differs from the published revision and reuses
the same flow with a **new** idempotency key.

---

## 5. Responsive behaviour

| Breakpoint | Layout |
| --- | --- |
| `≥1280px` | Full three-region shell. |
| `1024–1279px` | Tool panel auto-collapses to icons; properties stays docked. |
| `768–1023px` (tablet) | Tool panel and properties become overlay drawers above the viewer. The viewer stays fully usable — PRD FE-004. |
| `<768px` (phone) | Editing is **view-and-review**: the viewer, a bottom sheet for properties, and a reduced tool set. Complex authoring (timeline drag, polygon drawing, plan placement) is not offered; show a plain-language note that these need a larger screen. |

Rules:

- No essential action depends on hover (PRD FE-004). Every hover affordance has
  a tap/focus equivalent.
- The viewer is never smaller than the drawer that overlays it.
- The **player** (`/view/[slug]`) is fully responsive at every size, including
  phones, with no reduced functionality.

---

## 6. State conventions

| State | Requirement |
| --- | --- |
| Loading | Skeletons that match the final layout. No layout shift when data arrives. Never a full-page spinner inside the editor. |
| Empty | Explain what the surface is for and offer the primary action ("No experiences yet — Create Experience"). |
| Error | Plain-language cause, one clear recovery action, and the request id available for support (never displayed prominently). |
| Partial | A ready panorama with a still-processing derivative shows the experience and an advisory, not an error. |
| Optimistic | Applied only where rollback is safe; always snapshot and restore. |
| Toast | Reserved for background outcomes (published, copied, asset ready). **Never** for field validation, which is inline. |

---

## 7. Product language guardrails

PRD Appendix C is binding. The lint list for creator-facing copy:

| Never write | Write |
| --- | --- |
| MarkerPlugin, marker | Hotspot |
| Virtual tour node | Scene |
| navbar, navbar config | Viewer Controls |
| adapter, projection, equirectangular | Upload / Media quality |
| panoData, poseRoll, yaw, pitch, radians | Straighten Panorama / (nothing — click to place) |
| EquirectangularTilesAdapter, tiles | Optimized High Quality |
| cache policy, preload, eviction | Faster scene switching |
| device orientation API | Motion Navigation |
| codec, bitrate, transcode, profile | Playback quality |
| plugin incompatible | "These features can't be used together — try …" |

Numeric technical values (angles, byte counts, tile levels, revision numbers)
must not appear in normal creator flows. Revision numbers may appear in the
publication history, which is an expert surface.

---

## 8. Accessibility

| Requirement | Implementation |
| --- | --- |
| Keyboard navigation | Every tool, property control and dialog reachable by keyboard; visible focus rings. The viewer canvas supports arrow-key navigation when the project enables keyboard controls. |
| Focus management | Opening properties moves focus to its first control; closing returns focus to the trigger. Dialogs trap focus. |
| Reduced motion | `prefers-reduced-motion` disables Framer Motion transitions and suppresses auto-rotation auto-start (PRD NAV-003). |
| Labelling | Icon-only controls (collapsed tool panel, viewer controls) carry accessible names. |
| Contrast | Creator UI meets WCAG AA. Player chrome over a panorama uses a scrim so contrast holds against arbitrary imagery. |
| Announcements | Save state, publish result and asset-processing completion announce via a polite live region. |
| Media | Information-panel images require alt text; the field is offered wherever an image is attached. |

Captions and transcripts for embedded video remain an open product decision
(PRD §17.2) and are out of scope until decided.

---

## 9. Visual system

Tailwind CSS with shadcn/ui, per [frontend_trd.md](frontend_trd.md) §2.

- **The creator UI theme is independent of the experience's `appearance`
  settings.** Editing a dark experience must not turn the editor dark. Project
  appearance applies inside the viewer surface only.
- The properties panel previews the effect of appearance changes in the viewer,
  not in the panel's own chrome.
- Branding assets referenced by id resolve through the asset endpoints; a
  missing branded asset must never block editing or playback (PRD BRD-001).
- Framer Motion is used for panel transitions and selection affordances only —
  never for anything on the critical path to first paint.
