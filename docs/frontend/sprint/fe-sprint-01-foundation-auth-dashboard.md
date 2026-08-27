# Frontend Sprint 01 — Foundation, Authentication & Dashboard

> **Execution target:** Frontend application for the No-Code 360° Experience Platform
> **Application root:** `photo-sphere-execution/sphere-frontend` (currently empty)
> **Technical basis:** [../frontend_trd.md](../frontend_trd.md) — stack, layering, routing and state rules are binding
> **Backend basis:** backend Sprints 01–04, already implemented
>
> **Architecture rule:** Components never call the API directly. Every request goes
> Feature hook → TanStack Query → service layer → Axios → backend. The access
> token never reaches browser JavaScript.

---

## 1. Sprint Objective

Stand up the frontend application and everything every later sprint depends on:
the project skeleton, the typed API and service layer, the session model, the
server-state layer, the design system, and the first working creator surface —
**sign in, see your experiences, create one, name it, configure its
product-level settings**.

No viewer, no upload, no editor canvas in this sprint.

---

## 2. Outcomes Required

By sprint completion:

- The Next.js application builds, type-checks, lints and runs against a local
  backend.
- A visitor can register, sign in and sign out; the session survives reload and
  expires safely.
- Unauthenticated access to a creator route redirects to `/login` and returns to
  the original destination after sign-in.
- The dashboard lists the caller's accessible projects with type, name and last
  updated, without fetching any full Experience payload.
- "Create Experience" offers **360° Image** and **360° Video** and creates a
  draft project of the chosen immutable type.
- A project can be renamed and its product-level settings and branding saved
  with a correct revision precondition.
- A `409 REVISION_CONFLICT` produces a conflict dialog, never a silent
  overwrite.
- Every backend error code maps to a defined UI behaviour; unknown codes degrade
  gracefully.
- Shared primitives exist and are documented: `ApiError`, query keys, the
  revision helper, the idempotency-key helper, layout shell, loading/empty/error
  states, toasts.

---

## 3. Dependencies

| Dependency | Status |
| --- | --- |
| Backend `POST /api/v1/auth/register`, `/login` | Implemented |
| Backend `GET/POST/PATCH /api/v1/projects` | Implemented |
| Backend `GET /api/v1/platform/capabilities` | Implemented |
| Backend running locally with `CORS_ORIGINS` including the frontend origin | Operator setup — see [../../runbook.md](../../runbook.md) |
| Frontend sprints | None. This is the root. |

---

## 4. In Scope

### Application foundation
- Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui + Lucide + Framer
  Motion, per [../frontend_trd.md](../frontend_trd.md) §2.
- Directory structure exactly as [../frontend_trd.md](../frontend_trd.md) §6:
  `app/`, `components/{ui,layout,common}`, `features/`, `hooks/`, `services/`,
  `lib/`, `types/`, `schemas/`.
- Route groups separating the creator app from the player, so player bundles
  never include editor code.
- ESLint, Prettier, TypeScript strict mode, path aliases, environment variable
  validation at startup.

### API and transport layer
- Server-only Axios instance: base URL, `X-Request-ID`, envelope unwrapping,
  `ApiError` normalisation.
- Session Route Handler (`/api/session`) performing login/register/sign-out and
  managing the httpOnly cookie.
- Server Action service modules for auth and projects.
- The revision-precondition helper and the idempotency-key helper.
- Zod schemas for auth and project payloads.

### Server state
- TanStack Query provider, default options, per-project mutation scope.
- `src/lib/query-keys.ts` — the full key registry from
  [../frontend-api-integration.md](../frontend-api-integration.md) §7.1,
  even for resources later sprints consume.
- Global error handling: 401 → sign-out and redirect; error toasts for
  unexpected failures.

### Authentication
- `/login`, `/register` with React Hook Form + Zod.
- Route protection for the creator group.
- Session context exposing the safe user DTO stored at login.
- Generic credential-failure copy that never reveals whether an email exists.

### Dashboard and projects
- `/dashboard`: project list, primary **Create Experience** action, empty state.
- `/projects`: full index with search and type filter (client-side).
- Create-experience dialog with the two experience-type cards.
- Project rename (inline) and a project settings surface covering `appearance`,
  `navigation`, `information` and `branding` text fields.
- Save-state indicator and the conflict dialog.
- `/settings`: account view of the stored user DTO.

### Shared UI
- Application shell: top navigation, user menu, sign-out.
- `LoadingSkeleton`, `EmptyState`, `ErrorState`, `ConfirmDialog`,
  `ConflictDialog`, toast provider.

---

## 5. Out of Scope for FE-01

- Any upload or asset UI (FE-02).
- Photo Sphere Viewer, any manifest, any viewer route (FE-03).
- The editor shell, canvas, tool panel, properties panel (FE-04).
- Scenes, hotspots, timeline, plans, overlays.
- Publish, preview, share.
- Workspaces, grants, templates, analytics (FE-08).
- Branding **asset** uploads — only textual branding fields here; asset-backed
  branding lands in FE-02/FE-04.

Do not implement these early, but the foundation must not block them: the query
key registry, service layer shape and route groups are laid out for all of them
now.

---

## 6. Routes & Screens

| Route | Screen | Notes |
| --- | --- | --- |
| `/` | Redirect | To `/dashboard` when a session exists, else `/login`. |
| `/login` | Sign in | Email + password. |
| `/register` | Create account | Email, password, display name. |
| `/dashboard` | Projects overview | List + primary create action + empty state. |
| `/projects` | Project index | Search, type filter, sort by last updated. |
| `/projects/[projectId]/settings` | Project settings | Name, appearance, navigation, information, textual branding. |
| `/settings` | Account | Display name and email, read-only. |

`/projects/[projectId]` itself redirects to `/experiences/[projectId]` from
FE-04 onward; until then it redirects to the settings route.

---

## 7. Frontend Work Breakdown

### 7.1 `types/` and `schemas/`
- `ApiError`, success envelope, error envelope.
- `Project`, `ProjectSummary`, `ProjectSettings`, `Branding`, `ProjectType`.
- `AuthUser`, `AuthResponse`.
- Zod schemas: `loginSchema`, `registerSchema`, `createProjectSchema`,
  `updateProjectSchema`.

Type names mirror the canonical model in
[../../backend-schema.md](../../backend-schema.md). Do **not** invent a parallel
vocabulary.

### 7.2 `lib/`
- `api/http.ts` (`import 'server-only'`), `api/errors.ts`, `api/session.ts`,
  `api/request-id.ts`, `api/idempotency.ts`.
- `query-keys.ts`, `query-client.ts`.
- `env.ts` — validated environment access.
- `revision.ts` — read the current project revision from cache and attach the
  correct precondition field.

### 7.3 `services/`
- `auth-service.ts`: `register`, `login`.
- `project-service.ts`: `listProjects`, `getProject`, `createProject`,
  `updateProject`.
- `platform-service.ts`: `getCapabilities`.

Every function is a Server Action, validates input with its Zod schema, and
returns the unwrapped payload or throws `ApiError`.

### 7.4 `features/`
- `features/auth/` — hooks, forms, session context.
- `features/projects/` — `useProjects`, `useProject`, `useCreateProject`,
  `useUpdateProject`; project card, create dialog, settings forms.
- `features/platform/` — `useCapabilities` for later progressive disclosure.

### 7.5 `components/`
- `layout/AppShell`, `layout/TopNav`, `layout/UserMenu`.
- `common/LoadingSkeleton`, `EmptyState`, `ErrorState`, `SaveIndicator`,
  `ConflictDialog`, `ConfirmDialog`.
- `ui/` — the shadcn primitives actually used; do not vendor the whole library.

---

## 8. Backend / API Integrations

| Method | Route | Used by | Notes |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/register` | Register form | Rate limited (30 / 15 min). Handle `429 AUTH_RATE_LIMITED`. |
| POST | `/api/v1/auth/login` | Login form | Generic 401 copy. |
| GET | `/api/v1/projects` | Dashboard, index | Returns accessible projects, not only owned — see validation report §R2. No pagination. |
| POST | `/api/v1/projects` | Create dialog | `type` is immutable after creation. `settings` and `branding` optional. |
| GET | `/api/v1/projects/:projectId` | Settings | Full canonical project including `revision`. |
| PATCH | `/api/v1/projects/:projectId` | Settings, rename | Requires `revision`. Returns the new revision. |
| GET | `/api/v1/platform/capabilities` | Capability cache | Long `staleTime`; used from FE-04 for tool availability. |

`video360` project creation may include `videoSettings`; sending `videoSettings`
or `videoAssetId` to an `image360` project returns
`422 PROJECT_TYPE_MISMATCH`. The create dialog must send the right shape.

---

## 9. State, Cache & Invalidation

- `projects` — `staleTime: 0`, refetch on focus.
- `project` — `staleTime: 0`; the mutation writes the returned project (with its
  new revision) straight into the cache before invalidating `projects`.
- `platformCapabilities` — `staleTime: 1 hour`.
- Project mutations use `scope: { id: projectId }` so writes to one project
  serialise (see [../frontend-api-integration.md](../frontend-api-integration.md)
  §3.2 rule 4).
- Settings forms are `useForm` + Zod with a 600 ms debounced autosave and a
  visible save state.

---

## 10. UX & Responsive Requirements

- **Create Experience is visually primary** on the dashboard (PRD PRJ-001).
- The two type cards use product language only — "360° Image / Interactive
  panorama" and "360° Video / Interactive 360° video". No adapter or renderer
  wording (PRD PRJ-002).
- Rename errors are field-level, never toasts (PRD PRJ-003).
- Renaming must not imply a change to the public URL; the publish slug is a
  separate concept introduced in FE-04.
- The dashboard is fully responsive down to phone width; the project list
  becomes single-column.
- Keyboard: the create action, list items and forms are all reachable and have
  visible focus.

---

## 11. Error, Loading & Empty States

| Situation | Behaviour |
| --- | --- |
| Project list loading | Card skeletons matching the final grid. |
| No projects | "No experiences yet" + Create Experience. |
| Project list fails | Error state with retry; the shell stays usable. |
| 401 anywhere | Clear session, redirect to `/login?next=…`. |
| 404 on a project | Not-found page. Never reveal whether it exists. |
| `VALIDATION_FAILED` with `path` | Focus and mark that control. |
| `REVISION_CONFLICT` | Conflict dialog with Reload / Retry. |
| `429` | Non-blocking toast plus a retry-after hint. |
| Backend unreachable | Full-page maintenance state with retry. |

---

## 12. Acceptance Criteria / Sprint Gate

1. `npm run build`, `typecheck` and `lint` all pass; the app runs against a local
   backend.
2. Register → dashboard → create an `image360` project → rename → change
   appearance settings → reload: everything persists.
3. Creating a `video360` project succeeds and its type is reported correctly.
4. Signing out clears the session; a protected route then redirects to `/login`
   and returns to the intended destination after sign-in.
5. A forced stale revision produces a conflict dialog; choosing **Reload latest**
   restores the server state, and no write is silently lost.
6. No component imports `lib/api/http.ts`; a deliberate attempt fails the build.
7. The access token is not present in `localStorage`, `sessionStorage`, or any
   value reachable from browser JavaScript.
8. The dashboard makes exactly one `GET /api/v1/projects` request and no
   per-project detail requests.
9. Every code in the error table in
   [../frontend-api-integration.md](../frontend-api-integration.md) §2.1 has a
   handler; an unknown code renders the generic error rather than crashing.
10. `X-Request-ID` is sent on every request and captured on every `ApiError`.

---

## 13. Verification Requirements

- Unit: `ApiError` normalisation for each envelope shape; revision helper picks
  `revision` versus `projectRevision` correctly; idempotency-key helper produces
  one key per intent and reuses it across retries.
- Integration: full auth flow; project create/read/update against a live local
  backend; a forced 409 producing a conflict dialog.
- Manual: sign-in on a phone-width viewport; sign-out from every route;
  browser devtools confirming no token is reachable from JavaScript.
- Performance: dashboard first contentful paint under 1.5 s on a local backend.

---

## 14. Execution Order

1. Bootstrap the application, tooling, environment validation, route groups.
2. Design-system baseline: Tailwind config, shadcn primitives, layout shell.
3. `types/` and `schemas/` for auth and projects.
4. `lib/api/*` — Axios, errors, request id, session cookie.
5. Session Route Handler and auth service actions.
6. TanStack Query provider, query keys, global error handling.
7. Auth routes, route protection, session context.
8. Project service actions and feature hooks.
9. Dashboard, project index, create dialog.
10. Project settings forms, autosave, save indicator, conflict dialog.
11. Shared state components; error-code mapping table wired end to end.
12. Gate verification.

---

## 15. Guardrails

1. Do not build any UI for uploads, viewers, scenes, hotspots or publishing.
2. Do not put the access token anywhere reachable from browser JavaScript.
3. Do not duplicate the project revision outside the TanStack Query cache.
4. Do not add a project delete action — no backend route exists (validation
   report §B G2).
5. Do not paginate the project list client-side in a way that hides projects;
   the backend returns the full accessible set.
6. Do not create a parallel type vocabulary; mirror the canonical model names.
7. Do not add a `me`/refresh call — no such endpoint exists (§B G3).
8. Do not import Photo Sphere Viewer anywhere in this sprint.
