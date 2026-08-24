# Technical Requirements Document (TRD) — Backend

## 1. Purpose

The backend provides the core API and business logic for the **360° Panorama Platform**, supporting 360° images, 360° videos, scenes, hotspots/interactions, projects, publishing, branding, users, and analytics.

The backend owns the **Experience model and platform logic**. Photo Sphere Viewer is treated only as the frontend rendering engine.

---

## 2. Backend Stack

| Layer          | Technology                    |
| -------------- | ----------------------------- |
| Runtime        | Node.js                       |
| Framework      | Express.js                    |
| Language       | TypeScript                    |
| Database       | PostgreSQL                    |
| ORM            | Sequelize                     |
| API            | REST API                      |
| Media Storage  | Object/File Storage           |
| Authentication | Token-based authentication    |
| Validation     | Request/schema validation     |
| HTTP Client    | Axios                         |
| Deployment     | Cloud / Serverless compatible |

**Principle:** PostgreSQL stores application metadata; large images/videos are stored separately in object/file storage.

---

## 3. Core Backend Modules

### User & Authentication

* User registration/login
* Authentication & authorization
* User/project ownership
* Role-based access where required

### Projects

* Create/update/delete projects
* Project settings and branding
* Project ownership and access

### Assets

* Upload 360° images
* Upload 360° videos
* Asset metadata
* Storage URL/reference
* Processing status

### Scenes

* Create and manage panorama scenes
* Scene ordering
* Scene-to-asset relationship
* Scene configuration

### Experience

* Experience configuration
* Multiple scenes
* Scene navigation
* Hotspots
* Interactive elements
* Viewer configuration
* Publishing state

### Publishing

* Draft/published versions
* Public experience access
* Publish/unpublish
* Shareable/public URLs

### Analytics

* Experience views
* Scene views
* Interaction events
* Basic engagement metrics

---

## 4. API Architecture

```text
Client
  ↓
Express Routes
  ↓
Controllers
  ↓
Services
  ↓
Repositories / Sequelize
  ↓
PostgreSQL
```

For media:

```text
Client
  ↓
Backend
  ↓
Object/File Storage
  ↓
Asset URL
  ↓
360° Viewer
```

**Controllers** handle HTTP concerns.
**Services** contain business logic.
**Sequelize models/repositories** handle database operations.

---

## 5. Data Model — Core Entities

```text
Users
  │
  └── Projects
        │
        ├── Assets
        │
        └── Experiences
              │
              ├── Scenes
              │     └── Asset
              │
              ├── Hotspots
              │
              └── Publishing
```

Main tables:

* `users`
* `projects`
* `assets`
* `experiences`
* `scenes`
* `hotspots`
* `experience_settings`
* `publish_versions`
* `analytics_events`

Relationships should be managed through Sequelize associations with proper foreign keys and cascading rules.

---

## 6. Media Handling

Large media files **must not be stored directly in PostgreSQL**.

Backend responsibilities:

1. Validate upload.
2. Create asset record.
3. Upload/store media in object storage.
4. Save storage reference and metadata.
5. Track processing status.
6. Return asset information to frontend.

Supported media will primarily include:

* 360° panorama images
* 360° videos
* Thumbnails/previews

---

## 7. API Standards

Use versioned REST APIs:

```text
/api/v1/auth
/api/v1/users
/api/v1/projects
/api/v1/assets
/api/v1/experiences
/api/v1/scenes
/api/v1/hotspots
/api/v1/publish
/api/v1/analytics
```

Standard response structure:

```text
{
  success: true,
  data: {},
  message: "..."
}
```

Errors should use consistent HTTP status codes and a centralized error handler.

---

## 8. Security

* Authentication middleware
* Authorization checks
* Input validation
* File type/size validation
* Secure upload handling
* Environment variables for secrets
* CORS configuration
* Rate limiting where required
* No sensitive credentials in source code

---

## 9. Error & Logging Strategy

Centralized:

```text
Request
  ↓
Validation
  ↓
Controller
  ↓
Service
  ↓
Error Handler
  ↓
Standard API Response
```

Use structured application logging for:

* API errors
* Authentication failures
* Upload failures
* Database errors
* Publishing failures
* Important system events

---

## 10. Backend Folder Structure

```text
src/
├── config/
├── routes/
├── controllers/
├── services/
├── models/
├── repositories/
├── middlewares/
├── validators/
├── utils/
├── types/
├── errors/
├── integrations/
│   ├── storage/
│   └── external/
├── app.ts
└── server.ts
```

**Rule:** Business logic stays in `services`; controllers remain thin.

---
