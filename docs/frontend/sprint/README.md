# Frontend Sprint Plan

Eight sprints. The boundaries follow **frontend** dependencies, not the four
backend sprints — the backend is already complete through backend Sprint 04, so
no frontend sprint waits on backend work. What sequences the frontend is the
Viewer Runtime: it is the core product component, it is shared by the editor
preview and the public player, and almost everything else depends on it.

## Sprints

| ID | Sprint | Delivers | Depends on |
| --- | --- | --- | --- |
| [FE-01](fe-sprint-01-foundation-auth-dashboard.md) | Foundation, Auth & Dashboard | App bootstrap, API/service layer, session, dashboard, project create/rename/settings | — |
| [FE-02](fe-sprint-02-media-upload-assets.md) | Media Upload & Asset Pipeline UI | Upload protocol, processing status, asset picker, reprocess, media library (constrained) | FE-01 |
| [FE-03](fe-sprint-03-viewer-runtime-player.md) | Viewer Runtime & Public Player | Manifest-driven runtime, module registry, `/view/[slug]`, telemetry, share access | FE-01 |
| [FE-04](fe-sprint-04-image-editor-publish.md) | Image Editor, Preview & Publish | Canvas-first editor shell, hotspots, appearance, branding, preflight, preview, publish, share | FE-02, FE-03 |
| [FE-05](fe-sprint-05-tours-navigation-progressive.md) | Multi-Scene Tours & Runtime Efficiency | Scenes, connections, gallery, navigation, progressive tours, preload, cache | FE-04 |
| [FE-06](fe-sprint-06-video-timeline-playback.md) | 360° Video, Timeline & Playback | Video projects, timeline editor, video runtime, profile selection, video telemetry | FE-04 |
| [FE-07](fe-sprint-07-spatial-immersive-overlays.md) | Spatial, Immersive & Advanced Interactions | Plans, map/plan navigation, overlays, advanced geometry, extensions, motion/stereo/VR, quality | FE-05 |
| [FE-08](fe-sprint-08-collaboration-analytics-scale.md) | Collaboration, Sharing, Templates & Analytics | Workspaces, grants, share tokens, embed policy, templates, six analytics views, scale hardening | FE-05, FE-06, FE-07 |

## Dependency graph

```text
FE-01 ──┬── FE-02 ──┐
        │           ├── FE-04 ──┬── FE-05 ── FE-07 ──┐
        └── FE-03 ──┘           │                     ├── FE-08
                                └── FE-06 ────────────┘
```

FE-05 and FE-06 may run in parallel once FE-04 is complete. FE-07 requires the
scene model from FE-05. FE-08 requires telemetry emission from FE-03, FE-05,
FE-06 and FE-07 to have real analytics data.

## Phase alignment

| PRD phase | Frontend sprints |
| --- | --- |
| Phase 1 — Core product + production foundation | FE-01, FE-02, FE-03, FE-04 |
| Phase 2 — Rich tours | FE-05 |
| Phase 3 — 360° video | FE-06 |
| Phase 4 — Advanced immersive & spatial | FE-07 |
| Phase 4/5 — Collaboration, analytics, scale | FE-08 |

**PRD §16.1 Phase-1 Definition of Done is met at the end of FE-04.**

## How to read a sprint document

Every sprint document uses the same structure as the backend sprint documents:

1. Sprint Objective
2. Outcomes Required
3. Dependencies
4. In Scope / Out of Scope
5. Routes & Screens
6. Frontend Work Breakdown
7. Backend / API Integrations
8. State, Cache & Invalidation
9. UX & Responsive Requirements
10. Error, Loading & Empty States
11. Acceptance Criteria / Sprint Gate
12. Verification Requirements
13. Execution Order
14. Guardrails

Shared contracts are referenced, not repeated. Before implementing any sprint,
read [../frontend_trd.md](../frontend_trd.md),
[../frontend-api-integration.md](../frontend-api-integration.md) and — from
FE-03 onward — [../frontend-viewer-runtime.md](../frontend-viewer-runtime.md).

## Standing guardrails (every sprint)

1. Components never call Axios or `fetch` directly. Feature hook → TanStack
   Query → service layer.
2. TanStack Query is the only source of truth for server state. Never mirror it
   in component state or a form default.
3. Renderer vocabulary never reaches creator-facing copy or canonical payloads.
   Photo Sphere Viewer is imported only inside the Viewer Runtime.
4. Every project-scoped mutation carries the correct revision precondition and
   handles `409 REVISION_CONFLICT` without silent overwrite.
5. Server-returned sanitised content and error codes are authoritative.
6. No feature may be built that the backend does not support. If a route seems
   missing, check [../frontend-validation-report.md](../frontend-validation-report.md)
   §B before inventing one.
7. Every sprint leaves the app deployable: type-checks, lints, builds, and its
   routes render without runtime errors.
