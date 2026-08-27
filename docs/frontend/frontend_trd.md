# Technical Requirements Document (TRD) — Frontend

## 1. Purpose

The frontend is the main **360° Panorama Experience Builder and Viewer**.

It allows users to:

* Upload/manage 360° images and videos
* Create panorama scenes
* Configure hotspots and interactions
* Build 360° galleries, virtual tours, and interactive experiences
* Preview and publish experiences
* View the final experience through the 360° Panorama Viewer

**Photo Sphere Viewer** is the core rendering engine. Other functionality is built around it through the application's feature/plugin architecture.

---

## 2. Frontend Stack

| Layer        | Technology      |
| ------------ | --------------- |
| Framework    | Next.js         |
| Language     | TypeScript      |
| UI           | React           |
| Styling      | Tailwind CSS    |
| Components   | shadcn/ui       |
| Server State | TanStack Query  |
| Forms        | React Hook Form |
| Validation   | Zod             |
| HTTP         | Axios           |
| Icons        | Lucide React    |
| Animation    | Framer Motion   |

---

## 3. Frontend Architecture

```text
Next.js App
    ↓
Pages / Routes
    ↓
Feature Components
    ↓
Custom Hooks
    ↓
TanStack Query
    ↓
Server Actions
    ↓
Backend API
```

### Important Rules

* React components **must not call APIs directly**.
* Axios is used only inside the API/service layer.
* TanStack Query is the **single source of truth for server state**.
* GET operations → `useQuery`
* POST/PUT/PATCH/DELETE → `useMutation`
* Forms → React Hook Form + Zod
* Reusable UI → `src/components`
* Feature-specific UI → feature/route `_components`

---

## 4. Core Application Areas

### Dashboard

* Projects
* Recent experiences
* Assets
* Project management

### Experience Builder

Main workspace for creating the 360° experience.

```text
┌─────────────────────────────────────┐
│ Header / Project Controls            │
├───────┬─────────────────────┬───────┤
│ Tool  │                     │       │
│ Side  │   360° Viewer       │ Config│
│ bar   │                     │ Panel │
│       │                     │       │
└───────┴─────────────────────┴───────┘
```

The **360° viewer remains the central workspace**.

Tools can be opened/closed through a collapsible sidebar so the panorama remains visible.

---

## 5. Tool / Plugin Architecture

The builder should use a modular tool architecture.

Possible tools:

* Scene Manager
* Hotspot Tool
* Navigation Tool
* Gallery Tool
* Virtual Tour Tool
* Interactive Element Tool
* Image Tool
* Video Tool
* Branding / Theme Tool
* Settings Tool
* Preview / Publish Tool

Not every tool must be enabled for every experience.

```text
Experience
   │
   ├── Core Viewer
   │
   └── Tools / Plugins
        ├── Gallery
        ├── Virtual Tour
        ├── Hotspots
        ├── Interactive
        └── Video
```

This keeps the core viewer independent from optional functionality.

---

## 6. Routing Structure

```text
src/
├── app/
│   ├── dashboard/
│   ├── projects/
│   ├── experiences/
│   │   └── [id]/
│   │       └── _components/
│   ├── viewer/
│   │   └── [id]/
│   └── ...
│
├── components/
│   ├── ui/
│   ├── layout/
│   └── common/
│
├── features/
│   ├── projects/
│   ├── assets/
│   ├── experiences/
│   ├── scenes/
│   ├── hotspots/
│   ├── gallery/
│   ├── virtual-tour/
│   └── video/
│
├── hooks/
├── services/
├── lib/
├── types/
└── schemas/
```

---

## 7. Data & API Layer

```text
Component
   ↓
Feature Hook
   ↓
TanStack Query
   ↓
Server Action
   ↓
Axios
   ↓
Backend API
```

### Query Management

Centralized query keys:

```text
projects
experiences
scenes
assets
hotspots
```

Configure:

* `staleTime`
* `gcTime`
* `enabled`
* `placeholderData`
* Cache invalidation after mutations

---

## 8. Viewer Architecture

The viewer is the **core product component**.

```text
Viewer
├── Photo Sphere Viewer
├── Scene Loader
├── Hotspot Layer
├── Navigation
├── Interaction Layer
└── Plugin/Tool Layer
```

The viewer should receive a structured **experience configuration** rather than containing business logic itself.

Example concept:

```text
Experience
 → Scenes
 → Active Scene
 → Assets
 → Hotspots
 → Plugins
 → Viewer Settings
```

---

## 9. State Management

### Server State

**TanStack Query**

Used for:

* Projects
* Experiences
* Scenes
* Assets
* Backend configuration

### Local UI State

React state/context where appropriate.

Used for:

* Sidebar open/close
* Active tool
* Selected hotspot
* Viewer mode
* Builder UI state

Avoid duplicating server state in local state.

---

## 10. Forms & Validation

All major forms use:

```text
React Hook Form
        +
Zod
```

Validation should happen before API submission.

Examples:

* Project creation
* Experience settings
* Scene configuration
* Hotspot configuration
* Publishing settings

---

## 11. UX Requirements

* Responsive layout
* Collapsible tool sidebar
* Viewer-first design
* Minimal UI obstruction over panorama
* Clear active-tool state
* Loading/skeleton states
* Empty states
* Error states
* Toast notifications
* Smooth Framer Motion transitions where useful

---

## 12. Core Frontend Principle

> **Frontend = Experience Builder + 360° Viewer**

The **Viewer is the core**, while Gallery, Virtual Tour, Interactive Experience, Hotspots, and Video are modular capabilities added around it.

The architecture must therefore remain **feature-based, plugin-oriented, viewer-centric, and scalable**.
