# Frontend Sprint 08 — Collaboration, Sharing Controls, Templates & Analytics

> **Depends on:** [FE-05](fe-sprint-05-tours-navigation-progressive.md), [FE-06](fe-sprint-06-video-timeline-playback.md), [FE-07](fe-sprint-07-spatial-immersive-overlays.md)
> **Backend basis:** backend Sprint 04 (workspaces, access grants, share tokens, embed policy, custom domains, templates, audit log, analytics, platform operations), implemented
> **Telemetry contract:** [../frontend-telemetry.md](../frontend-telemetry.md) — the analytics views depend on it

---

## 1. Sprint Objective

Complete the platform around the product: let teams work together, let creators
control exactly who can view and embed an experience, let them start from a
template instead of a blank canvas, and let them understand engagement,
performance and reliability from real runtime telemetry.

This sprint also hardens the app for scale: large project sets, large tours and
large analytics windows.

---

## 2. Outcomes Required

By sprint completion:

- Workspaces can be created and listed; members can be invited, accepted,
  re-roled and removed, with the owner protected.
- Per-project access grants can be listed, added and revoked, and the whole
  editor respects the caller's effective role.
- Share tokens can be created, listed and revoked, with the secret shown exactly
  once.
- Embed policy can be set to anywhere, allowlist or disabled, and takes effect
  without republishing.
- Custom domains can be registered and their verification state tracked.
- The audit log is readable for projects and workspaces.
- Templates can be captured from a project, listed, previewed and instantiated
  into a new draft project.
- All six analytics views render with bounded date ranges, publication-revision
  filtering, and a clear separation of engagement from reliability.
- Optional platform-admin surfaces expose the capability registry, viewer
  integration rollout and reference suite.
- Scale behaviour is verified: many projects, a very large tour, and the maximum
  analytics window.

---

## 3. Dependencies

| Dependency | Status |
| --- | --- |
| FE-04 role resolution and publish flow | Required |
| FE-03 / FE-05 / FE-06 / FE-07 telemetry emission | Required — analytics is empty without it |
| Backend workspaces, access, share tokens, embed policy, custom domains, templates, audit log, analytics, platform routes | Implemented |
| A charting library consistent with the design system | Chosen this sprint |

---

## 4. In Scope

### Workspaces and membership
- `/workspaces`: list with the caller's role; create with a unique slug.
- `/workspaces/[workspaceId]`: members, custom domains, audit log.
- Invite by email with role `viewer` / `editor` / `admin`; accept a pending
  invitation; change a role; remove a member (revocation, not deletion).
- Owner protection: the workspace owner cannot be demoted or removed.

### Project access
- `/projects/[projectId]/access`: grants list, add by email with a role, revoke.
- Effective role display including its source (`owner`, `project-grant`,
  `workspace-membership`).
- Role-aware gating applied consistently across the editor, publish, share and
  analytics surfaces.

### Sharing controls
- Share tokens: create with an optional label, expiry and pinned publication
  revision; copy the secret once; list metadata; revoke.
- Embed policy editor with the three modes, origin validation, and a clear
  statement that the allowlist restricts embedding, not the canonical link.
- Custom domains: register a hostname, show the verification token and status,
  update, delete.

### Templates
- `/templates`: catalogue filtered by experience type, showing own, workspace
  and platform templates.
- Template detail with the blueprint summary (scene, plan, timeline and asset
  counts).
- Capture a template from a project with visibility and asset policy.
- Instantiate into a new draft project (idempotent) and navigate to the editor.
- Status changes: draft, published, archived.

### Analytics
- `/projects/[projectId]/analytics` with a shared range control and a
  publication-revision filter.
- Six views:
  - **Summary** — engagement counts, first-panorama and time-to-interactive
    percentiles, reliability totals, device-class and viewer-integration
    breakdowns
  - **Timeseries** — events and sessions by hour or day
  - **Scenes** — per-scene views and transition failures
  - **Interactions** — hotspot, overlay, CTA and timeline engagement
  - **Video** — starts, stalls, profile selections, playback failures
  - **Reliability** — asset failures, transition failures, viewer errors, video
    stalls, capability fallbacks
- Entity id resolution to names (scene names, hotspot labels, interaction kinds).
- An explicit "no data yet" state that explains data appears once visitors view
  a published experience.

### Platform operator surfaces (optional)
- `/admin/capabilities`, `/admin/viewer-integrations`,
  `/admin/reference-suite`: read-only status plus rollout, promote and rollback
  actions, gated on `platform_admin`.

### Scale hardening
- Project index virtualisation and client-side filtering that stays responsive
  at several hundred projects.
- Analytics range clamping to `ANALYTICS_MAX_RANGE_DAYS`.
- Large-tour editor and player verification at 300+ scenes.

---

## 5. Out of Scope for FE-08

- Any new authoring capability — everything creative shipped in FE-04 to FE-07.
- Custom analytics event definitions or client-side aggregation. The six backend
  views are the contract.
- DNS or certificate provisioning; the backend only records the mapping and its
  verification state.
- Billing, plans or quotas — no backend surface exists.
- Real-time collaborative editing. Concurrency is handled by the revision
  protocol, not by presence or CRDTs.

---

## 6. Routes & Screens

| Route | Screen |
| --- | --- |
| `/workspaces` | Workspace list and creation |
| `/workspaces/[workspaceId]` | Members, custom domains, audit log |
| `/projects/[projectId]/access` | Grants, effective role, project audit log |
| `/projects/[projectId]/share` | Extended with share tokens and embed policy |
| `/templates` | Catalogue |
| `/templates/[templateId]` | Detail and instantiate |
| `/projects/[projectId]/analytics` | Six analytics views |
| `/admin/*` | Optional platform-admin surfaces |

---

## 7. Frontend Work Breakdown

### 7.1 Types
`Workspace`, `WorkspaceMembership`, `ProjectAccessGrant`, `ProjectRole`,
`ShareToken`, `EmbedPolicy`, `CustomDomain`, `AuditLogEntry`, `Template`,
`TemplateBlueprintSummary`, and one type per analytics response.

### 7.2 Services
`workspace-service.ts`, `access-service.ts` (extended), `share-token-service.ts`,
`embed-policy-service.ts`, `custom-domain-service.ts`, `audit-service.ts`,
`template-service.ts`, `analytics-service.ts`, `platform-service.ts` (extended).

### 7.3 Features
`features/workspaces/`, `features/access/`, `features/sharing/`,
`features/templates/`, `features/analytics/`, `features/admin/`.

### 7.4 Analytics presentation
- One `AnalyticsRangeControl` shared by all views, clamped to the maximum range.
- Chart primitives with a consistent palette that reads in light and dark, with
  accessible labels and non-colour-only encoding.
- Engagement and reliability are visually separated; never combine them into one
  "activity" number.
- Percentiles are shown as p50 / p75 / p95 with the sample count, and suppressed
  when the sample count is too small to be meaningful.

### 7.5 Role gating
A single `useProjectRole(projectId)` hook and a `<RequireRole>` wrapper.
Actions above the caller's role are **hidden**, not disabled. The server remains
authoritative — a 403 is still handled.

---

## 8. Backend / API Integrations

### 8.1 Workspaces and access

| Method | Route | Requires |
| --- | --- | --- |
| GET/POST | `/api/v1/workspaces` | Authenticated; unique slug on create |
| GET | `/api/v1/workspaces/:id/members` | workspace viewer |
| POST | `/api/v1/workspaces/:id/members` | workspace admin |
| POST | `/api/v1/workspaces/:id/members/accept` | pending invitation |
| PATCH/DELETE | `/api/v1/workspaces/:id/members/:membershipId` | workspace admin |
| GET | `/api/v1/workspaces/:id/audit-log` | workspace admin |
| GET/POST/PATCH/DELETE | `/api/v1/workspaces/:id/custom-domains[...]` | workspace admin |
| GET/POST | `/api/v1/projects/:id/access` | project admin |
| GET | `/api/v1/projects/:id/access/me` | any project role |
| DELETE | `/api/v1/projects/:id/access/:grantId` | project admin |
| GET | `/api/v1/projects/:id/audit-log` | project admin |

`owner` is transferred, never invited or granted — `ROLE_NOT_ASSIGNABLE`.
Inviting an unregistered address returns `INVITE_NOT_DELIVERABLE` and must not be
presented as "that account does not exist"; the backend deliberately does not
disclose registration. The workspace owner's membership cannot be demoted or
removed (`MEMBER_NOT_REMOVABLE`).

### 8.2 Sharing

| Method | Route | Requires |
| --- | --- | --- |
| GET/POST | `/api/v1/projects/:id/share-tokens` | project admin |
| DELETE | `/api/v1/projects/:id/share-tokens/:shareTokenId` | project admin |
| PUT | `/api/v1/projects/:id/embed-policy` | project admin |

The share-token secret is returned **once**, in the creation response, under
`private, no-store`. Copy it immediately and never store it; listing shows
metadata only. Omitting `publicationRevision` follows the current publication;
supplying one pins it.

Embed modes: `anywhere` (default), `allowlist` (at least one bare
scheme/host/port origin) and `disabled`. A path, wildcard or credential returns
`INVALID_EMBED_ORIGIN`. `allowedApiOrigins` additionally permits cross-origin
manifest reads, and applies **on top of** the deployment's `CORS_ORIGINS`, which
is evaluated first — say so in the UI, because an origin missing from
`CORS_ORIGINS` will still fail.

### 8.3 Templates

| Method | Route | Requires |
| --- | --- | --- |
| GET | `/api/v1/templates` | Authenticated; optional `experienceType` |
| GET | `/api/v1/templates/:templateId` | template readable |
| POST | `/api/v1/templates` | project admin on the source project |
| PATCH | `/api/v1/templates/:templateId/status` | owner or workspace admin |
| POST | `/api/v1/templates/:templateId/instantiate` | template readable, published, `Idempotency-Key` |

Asset policy: `omit` (structure only), `reference` (reuse assets the
instantiating user already owns), `copy` (duplicate media into the new owner's
library). Explain each in creator language. `platform` visibility is curated and
rejected here (`TEMPLATE_VISIBILITY_NOT_ALLOWED`). Schema or blueprint mismatches
return `TEMPLATE_SCHEMA_UNSUPPORTED`, `TEMPLATE_VERSION_UNSUPPORTED` or
`TEMPLATE_BLUEPRINT_INVALID`; an unpublished template returns
`TEMPLATE_NOT_AVAILABLE`.

### 8.4 Analytics

All six routes require project `viewer` and share `from`, `to` and
`publicationRevision`; timeseries adds `interval` (`hour` or `day`). The window
is bounded by `ANALYTICS_MAX_RANGE_DAYS` (92 by default); exceeding it returns
`422 DATE_RANGE_TOO_LARGE` with `details.maximumDays`. Every response echoes the
resolved `range` — display it so the user knows what they are looking at.

Device-class breakdowns are suppressed below a minimum session count; show
"not enough data" rather than an empty chart.

### 8.5 Platform (optional)

`GET /api/v1/platform/capabilities`, `/viewer-integrations`,
`/reference-suite` are readable by any authenticated creator. Checks, rollout,
promote, rollback and metrics require `platform_admin`; a rollout target without
a passing reference-suite run returns `409 REFERENCE_SUITE_NOT_PASSED`.

---

## 9. State, Cache & Invalidation

- `workspaces`, `workspaceMembers`, `customDomains`, `projectAccess`,
  `shareTokens` — `staleTime: 30 s`; each mutation invalidates its list plus the
  relevant `auditLog`.
- `projectRole` — `staleTime: 5 min`; invalidated by any access change.
- `templates`, `template` — `staleTime: 60 s`; instantiate invalidates
  `projects`.
- `analytics` — keyed by `[projectId, view, resolvedRange, publicationRevision,
  interval]`, `staleTime: 5 min`, no refetch on focus.
- Share-token secrets are never written to any cache or storage.
- Embed policy changes invalidate `project` and `publications`, because the
  current publication is updated server-side.

---

## 10. UX & Responsive Requirements

- Role differences are expressed by **what is present**, not by disabled
  controls with permission tooltips.
- Invitation copy never reveals whether an email address has an account.
- The share-token secret is presented in a one-time panel with an explicit
  "you won't be able to see this again" warning and a copy action.
- Embed policy explains each mode in visitor terms and warns that `disabled`
  makes framed reads fail everywhere.
- Analytics: engagement and reliability are separate sections; performance
  percentiles state their sample count; empty states explain how data arrives.
- Analytics tables link scene and interaction ids to their names where the draft
  still contains them, and fall back to the id with a note when an entity was
  deleted.
- Templates state clearly what an asset policy will and will not carry over.
- Below `md`, analytics charts become scrollable cards; member and grant tables
  become stacked lists.
- Charts are readable in both themes, use accessible labels, and never encode
  meaning by colour alone.

---

## 11. Error, Loading & Empty States

| Situation | Behaviour |
| --- | --- |
| No workspaces | Explain what a workspace is and offer creation. |
| `WORKSPACE_SLUG_EXISTS` | Field error on the slug. |
| `ROLE_NOT_ASSIGNABLE` / `MEMBER_NOT_REMOVABLE` | Inline explanation; the action is removed afterwards. |
| `INVITE_NOT_DELIVERABLE` | Neutral copy that does not disclose registration state. |
| `SHARE_TOKEN_LIMIT_REACHED` | Explain the limit and offer revocation of an existing token. |
| `INVALID_EMBED_ORIGIN` | Field error naming the required bare-origin form. |
| Template schema mismatch | Explain the template targets a different version; offer to open the source instead. |
| Analytics range too large | Clamp to `details.maximumDays` and explain. |
| Analytics empty | "No data yet — publish and share your experience to start seeing views." |
| `PLATFORM_ADMIN_REQUIRED` | Hide the operator surface entirely. |
| Audit log empty | Explain what is recorded. |

---

## 12. Acceptance Criteria / Sprint Gate

1. A workspace can be created, a member invited, the invitation accepted, the
   role changed and the member removed; the owner cannot be demoted or removed.
2. A project grant gives an `editor` edit access without publish, and an `admin`
   publish access; the editor UI reflects each role by hiding actions.
3. A caller with no access receives 404 and the UI shows "not found" without
   implying existence.
4. A share token opens a private published experience; revoking it takes effect
   immediately; the secret is shown exactly once and never appears again.
5. Setting embed policy to `allowlist` allows the listed origin to frame the
   experience and denies another, **without republishing**.
6. Setting embed policy to `disabled` makes framed reads fail while the direct
   link keeps working.
7. A template captured from a multi-scene project instantiates into a new draft
   whose ids are all new and whose internal references point only at itself.
8. Instantiate retried with the same idempotency key creates exactly one project.
9. All six analytics views render real data produced by a genuine player session,
   with scene, hotspot and timeline ids resolving to names.
10. A range beyond the maximum is clamped with an explanation, and every view
    echoes the resolved range.
11. Engagement and reliability numbers are never combined; a reliability spike
    cannot be read as engagement.
12. The project index stays responsive with 300 projects, and a 300-scene tour
    remains usable in both editor and player.
13. Platform-admin surfaces are invisible to an ordinary creator, and a rollout
    without a passing reference-suite run is refused with an explanation.

---

## 13. Verification Requirements

- Unit: role-gating matrix across every gated action; analytics range clamping;
  chart data transforms; embed-origin validation; share-token one-time display.
- Integration, against a live backend: full membership lifecycle; grant
  lifecycle; share-token create/use/revoke; embed policy across all three modes
  from a real second origin; template capture and instantiation; each analytics
  view after generating real telemetry through the player.
- End-to-end telemetry: run a scripted player session (scene changes, hotspot
  clicks, a video session with a stall, an induced capability fallback) and
  confirm every analytics view reflects it — this is the check that FE-03,
  FE-05, FE-06 and FE-07 emitted the required payload keys.
- Scale: 300 projects in the index, a 300-scene tour end to end, a 92-day
  analytics window.
- Security: confirm a revoked share token fails immediately; confirm the token
  secret is absent from logs, caches and storage; confirm a non-admin cannot
  reach any admin surface by direct URL.

---

## 14. Execution Order

1. Role gating: `useProjectRole`, `<RequireRole>`, and an audit of every existing
   gated action from FE-04 to FE-07.
2. Project access grants and the project audit log.
3. Workspaces, membership lifecycle, workspace audit log.
4. Custom domains.
5. Share tokens with the one-time secret flow.
6. Embed policy editor with origin validation.
7. Templates: catalogue, detail, capture, instantiate, status.
8. Analytics foundation: range control, service layer, chart primitives.
9. The six analytics views with entity-name resolution.
10. Optional platform-admin surfaces.
11. Scale hardening: virtualisation and large-tour verification.
12. End-to-end telemetry verification and gate.

---

## 15. Guardrails

1. Never disclose whether an email address is registered.
2. Never persist or re-display a share-token secret.
3. Never present an origin allowlist as if it also restricted the direct link.
4. Never combine engagement and reliability metrics into a single figure.
5. Never widen an analytics range beyond the server maximum, and never issue
   unbounded queries.
6. Never aggregate telemetry client-side to fabricate a metric the backend does
   not provide.
7. Never show a platform-admin surface to a non-admin, even disabled.
8. Never assume a project in the list is owned by the caller; resolve the role.
9. Do not add new authoring capability in this sprint.
10. Do not implement DNS or certificate provisioning; the backend records the
    mapping only.
