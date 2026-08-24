# No-Code 360° Experience Platform

## Product, Architecture, UX & Runtime Specification

**Revision 2.0 — August 2026**  
**Technology validation basis:** Photo Sphere Viewer 5.14.3 and its current official adapters/plugins.

---

## Executive Summary

Build a no-code platform for creating, managing, publishing, and measuring interactive 360° image and video experiences.

The platform must hide rendering-engine complexity while still exploiting the important capabilities of Photo Sphere Viewer (PSV): panorama and video adapters, markers, virtual tours, gallery, maps/plans, gyroscope, stereo, overlays, resolution handling, visible-range constraints, events, and extensibility.

The product must not become a thin UI wrapper around PSV. The platform owns the product model, media pipeline, editor, experience schema, publishing layer, security, analytics, performance policy, device fallbacks, and runtime orchestration. PSV remains a replaceable rendering engine beneath the Experience Engine.

The customer mental model stays simple:

**Upload → Edit visually → Preview → Publish → Share**

The technical system underneath should be significantly more sophisticated:

**Ingest → Inspect → Normalize → Optimize → Derive → Store → Configure → Render → Preload → Cache → Measure**

The defining quality target is:

> **Maximum visual space, minimum cognitive load, high runtime efficiency, and maximum capability when needed.**

---

# 1. Product Vision

Build a **no-code 360° content creation platform** where users can upload 360° images or videos and create polished, interactive experiences entirely through a visual interface.

The customer should never need to understand:

- Photo Sphere Viewer
- Three.js
- panorama adapters
- spherical coordinates
- yaw / pitch
- plugins
- JSON
- JavaScript
- tiling strategies
- cache policies
- video profiles
- device capability APIs
- embedding implementation

All technical complexity stays inside the platform.

The product should feel **simple, smooth, readable, visual, fast, reliable, and professional**.

---

# 2. Core Product

The platform should initially focus on two creation experiences while sharing one underlying Experience Engine.

## 2.1 360° Image

Users upload a 360° panorama and create an interactive experience around it.

User-facing capabilities can include:

- Hotspots
- Information panels
- Images
- Videos
- Links
- Multiple scenes
- Scene navigation
- Gallery
- Branding
- Appearance customization
- Viewer controls
- Auto-rotation
- Compass
- Viewing-area restrictions
- Map / plan
- Mobile / gyroscope experience
- VR / stereo experience
- High-resolution delivery
- Advanced overlays

Internally, the platform should be able to support multiple panorama representations over time, including:

- Equirectangular
- Cropped / partial equirectangular
- Tiled equirectangular
- Cubemap
- Tiled cubemap
- Dual-fisheye / raw-camera inputs where appropriate

These projection details should normally remain invisible to the customer.

## 2.2 360° Video

Users upload a 360° video and create an interactive video experience.

Possible capabilities:

- Video playback
- Timeline
- Timed interactions
- Hotspots
- Information
- Images
- Videos
- Links
- Calls-to-action
- Viewpoint changes
- Branding
- Appearance
- Playback controls
- Multiple delivery profiles
- Device-aware playback
- Optional live / stream-based 360° input in advanced plans

The editor is an **interactive experience builder**, not a full non-linear video editor.

---

# 3. Product Philosophy

The platform should follow seven major principles.

## 3.1 Canvas First

The 360° content is the most important element. The viewer should always receive maximum available screen space.

## 3.2 Simple by Default

Only the most important options should initially be visible. Advanced capabilities should appear progressively and contextually.

## 3.3 Visual Instead of Technical

Users should manipulate objects directly on the panorama instead of entering technical values.

Bad:

```text
Yaw: 1.237
Pitch: -0.231
```

Good:

```text
Click anywhere on the panorama to place your hotspot.
```

## 3.4 Contextual UI

Properties should appear only when relevant. If nothing is selected, do not display a large properties panel. If a hotspot is selected, show hotspot properties.

## 3.5 One Platform, Multiple Experiences

Do not build disconnected products for every use case. Build one Experience Platform with multiple creation modes.

## 3.6 Progressive Capability

Advanced rendering features may exist internally without becoming visible settings. The platform should expose outcomes such as **High Quality**, **Optimize Loading**, or **Straighten Panorama**, not adapter-level configuration.

## 3.7 Runtime Efficiency Is a Product Feature

Fast startup, sensible bandwidth usage, reliable mobile playback, smooth scene changes, and predictable memory usage are part of the customer experience and must be designed into the platform from the beginning.

---

# 4. Overall User Journey

```text
Website
   ↓
Sign Up / Login
   ↓
Dashboard
   ↓
Create Experience
   ↓
Choose Experience Type
   ├── 360° Image
   └── 360° Video
   ↓
Upload Media
   ↓
Automatic Media Inspection + Optimization
   ↓
Visual Editor
   ↓
Configure Experience
   ↓
Preview
   ↓
Publish
   ↓
Share / Embed / QR
```

The optimization step is normally automatic. It should not become a separate technical workflow unless the asset genuinely needs user attention.

---

# 5. Dashboard

The dashboard should be intentionally simple.

Main navigation:

```text
Dashboard
Projects
Templates
Assets
Analytics
Settings
```

Primary action:

**+ Create Experience**

When clicked:

```text
What do you want to create?

┌──────────────────────┐
│ 360° Image           │
│ Interactive panorama │
│                      │
│ [Create]             │
└──────────────────────┘

┌──────────────────────┐
│ 360° Video           │
│ Interactive 360° video│
│                      │
│ [Create]             │
└──────────────────────┘
```

The user should not see technical rendering terminology.

---

# 6. Upload Experience & Media Intelligence

The upload screen should be extremely straightforward.

```text
Upload your 360° image

┌────────────────────────────┐
│                            │
│       Drag & Drop          │
│                            │
│     or Browse Files        │
│                            │
└────────────────────────────┘
```

After upload, automatically inspect the asset.

Internally determine where applicable:

- File type / MIME type
- Resolution and aspect ratio
- File size
- 360° metadata
- Panorama projection
- XMP panorama metadata
- Full-sphere vs cropped / partial panorama
- Pose heading / pitch / roll metadata
- Initial-view metadata
- Color / orientation issues
- Video codec and dimensions
- Video duration, frame rate and bitrate
- Audio presence
- Mobile compatibility risk
- Whether tiling or multiple derivatives should be generated

Show the user only useful information.

Example:

```text
✓ 360° panorama detected

8192 × 4096
Ready to edit
```

If correction is helpful, expose plain-language actions:

```text
[ Straighten Panorama ]
[ Re-detect 360° Format ]
```

Do not expose raw cropping coordinates, pose angles, adapter configuration, or shader flags in the normal flow.

---

# 7. Main Editor

The editor is the heart of the platform.

```text
┌──────────────────────────────────────────────────────────────┐
│ ← Projects     Experience Name     Preview    Save   Publish │
├──────┬───────────────────────────────────────────┬───────────┤
│      │                                           │           │
│ TOOL │                                           │ PROPERTY  │
│PANEL │               360° VIEWER                 │  PANEL    │
│      │                                           │           │
│      │                                           │           │
└──────┴───────────────────────────────────────────┴───────────┘
```

The properties panel should only appear when required.

Default:

```text
Tool Panel + Viewer
```

Selected object:

```text
Tool Panel + Viewer + Properties
```

The panorama remains visually dominant at all times.

---

# 8. Collapsible Tool Panel

The left tool panel should be collapsible.

Expanded:

```text
┌──────────────┬─────────────────────────────┐
│              │                             │
│ Media        │                             │
│ Hotspots     │          Viewer             │
│ Scenes       │                             │
│ Information  │                             │
│ Video        │                             │
│ Appearance   │                             │
│ Navigation   │                             │
│ Settings     │                             │
└──────────────┴─────────────────────────────┘
```

Collapsed:

```text
┌──┬─────────────────────────────────────────┐
│🖼│                                         │
│📍│                                         │
│🎬│               FULL VIEWER               │
│ⓘ │                                         │
│🎨│                                         │
│⚙ │                                         │
└──┴─────────────────────────────────────────┘
```

The viewer should expand automatically into the available space.

---

# 9. Tool Panel

Initial user-facing tool categories:

```text
Media
Hotspots
Scenes
Information
Images
Video
Links
Gallery
Navigation
Appearance
Branding
Auto Rotation
Controls
Settings
```

Progressive / optional tools:

```text
Compass
Map / Plan
View Limits
Gyroscope
VR / Stereo
Quality / Resolution
Advanced Hotspots
Advanced Overlays
Analytics
```

Internal engine capabilities such as tiling, cache policy, XMP interpretation, projection adapters, preload rules, and shader selection should not appear as ordinary editor tools.

---

# 10. Configurable Tools

The project creator can decide which creation tools are available.

```text
Editor Tools

☑ Hotspots
☑ Information
☑ Appearance
☑ Branding

☐ Scenes
☐ Gallery
☐ Video
☐ Map
☐ VR
```

A simple panorama can therefore remain extremely clean.

A hotel virtual tour can enable:

```text
☑ Scenes
☑ Hotspots
☑ Gallery
☑ Information
☑ Video
☑ Map
☑ Compass
```

Tool visibility is a UX concern. Runtime dependencies are resolved separately by the Experience Engine.

---

# 11. Tool Panel Search

As the product grows, add:

```text
🔍 Search tools...
```

Searching `video` could expose:

```text
Add Video
Video Settings
Video Hotspot
```

Searching `navigation` could expose:

```text
Auto Rotation
Compass
View Limits
Scene Navigation
```

This becomes useful once the platform contains many capabilities.

---

# 12. Hotspot System

Hotspots should remain one of the primary interaction tools.

User selects:

**+ Add Hotspot**

Then:

> Click anywhere on the panorama to place your hotspot.

The user clicks. The hotspot appears immediately and a contextual property panel opens.

```text
Hotspot

Name
[ Pool ]

Type
○ Information
○ Image
○ Video
○ Link
○ Scene

Icon
[ ● ]

Tooltip
[ View Pool ]

Action
[ Open content ]
```

The system internally stores the position and rendering data. The user never sees yaw/pitch unless an explicit expert mode is introduced.

The underlying domain model should not permanently assume every hotspot is a single pin. It should be able to evolve into point, area, line, image-layer, video-layer, and custom interaction geometries.

---

# 13. Hotspot & Interaction Types

A hotspot can trigger:

## Information

```text
Title
Description
Image
Button
```

## Image

Open an image or image gallery.

## Video

Open or play video content.

## Link

Open an internal or external URL.

## Scene

Move to another panorama.

## Future Advanced Geometry

The internal schema should allow future support for:

- Point markers
- Image markers
- Video markers
- Text / HTML markers
- Polygon / area regions
- Polyline / route annotations
- Scene-layer visual elements
- Custom interaction components

These advanced forms should be exposed only when a product use case needs them.

---

# 14. Scenes & Virtual Tours

Scenes represent individual panoramas inside an experience.

```text
Scenes

Lobby
Bedroom
Bathroom
Pool
Restaurant

+ Add Scene
```

A scene can contain:

- Panorama
- Hotspots
- Information
- Images
- Videos
- Scene connections
- Appearance settings
- Optional map / GPS metadata
- Optional allowed viewing range
- Runtime preload hints

Scenes can be connected visually.

```text
Lobby
  │
  ├────→ Bedroom
  │
  └────→ Restaurant
```

The user should think **Connect scenes**, not **Configure virtual-tour nodes**.

The runtime must support both small client-loaded tours and large progressively loaded tours. Large tours should not require all scene definitions and full-resolution media to be downloaded at startup.

---

# 15. Information Panels

Information can appear in a clean contextual panel.

```text
┌─────────────────────────┐
│ Bedroom                 │
│                         │
│ King-size bed           │
│ Ocean view              │
│                         │
│ [ View More ]           │
└─────────────────────────┘
```

Content can include:

- Title
- Description
- Image
- Image gallery
- Video
- Button
- External link
- Internal navigation

Any user-generated rich content must pass through the platform sanitization policy before it reaches the viewer runtime.

---

# 16. Media & Asset Library

The Media section manages reusable project assets.

Possible categories:

```text
Panoramas
Images
Videos
Audio
Logos
Other Assets
```

Users should be able to reuse uploaded assets instead of uploading the same file repeatedly.

Each logical asset may have multiple internal derivatives, for example:

```text
Original Panorama
├── Thumbnail
├── Low-resolution base panorama
├── Standard web panorama
└── High-resolution tiles
```

or:

```text
Original 360° Video
├── Poster image
├── Desktop profile
├── Mobile-compatible profile
└── Future adaptive profiles
```

The user should normally see one asset, not all derivative files.

---

# 17. Appearance

Appearance should centralize visual customization.

```text
Appearance

Theme
○ Light
○ Dark
○ Custom

Primary Color
[       ]

Hotspot Style
[       ]

Background
[       ]

Viewer Controls
[       ]

Typography
[       ]
```

The goal is branded output without requiring CSS.

---

# 18. Branding

Branding should be separate from general appearance.

Possible options:

```text
Logo
Company Name
Brand Colors
Favicon
Watermark
Custom Welcome Screen
Custom Loading Screen
```

This is particularly valuable for agencies and businesses.

---

# 19. Navigation

Navigation settings can include:

```text
Mouse / Touch Navigation
Zoom
Pan
Keyboard Controls
Fullscreen
Navigation Buttons
Scene Navigation
Compass
Allowed Viewing Area
```

The **Allowed Viewing Area** is the product abstraction for horizontal/vertical view constraints. It is useful for partial panoramas, guided content, and experiences where the creator wants to prevent navigation into irrelevant regions.

The Compass should be optional and context-driven, especially for tours, tourism, outdoor locations, properties, campuses, museums, and spatial experiences.

Defaults should work automatically.

---

# 20. Auto Rotation

Simple interface:

```text
Auto Rotation

Enabled        [ON]

Speed
──────●──────

Direction
○ Clockwise
○ Counter-clockwise

Start automatically
☑
```

Advanced autorotation and viewpoint paths can remain hidden until required.

---

# 21. Gallery

For multiple panoramas, users can enable a gallery.

```text
┌────────┐ ┌────────┐ ┌────────┐
│ Lobby  │ │Bedroom │ │ Pool   │
└────────┘ └────────┘ └────────┘
```

This provides another navigation method in addition to scene hotspots.

The Experience Engine must account for underlying renderer compatibility rules rather than assuming all plugins can be enabled together.

---

# 22. Video Creator

The video creator should use the same visual language as the image creator. The major difference is the timeline.

```text
┌──────────────────────────────────────────────┐
│                 360° VIDEO                   │
│                                              │
│                                              │
└──────────────────────────────────────────────┘

00:00 ───────────────●──────────────── 02:34
                     01:20
```

The user can place interactions directly on the timeline.

The media backend should generate device-appropriate playback derivatives rather than assuming the original upload can be played efficiently everywhere.

---

# 23. Timed Video Interactions

At a specific time:

```text
01:20
   ↓
+ Add Interaction
```

Available actions:

```text
Show Information
Show Hotspot
Change Viewpoint
Show Image
Show Video
Open Link
Show CTA
```

Example:

```text
Interaction

Time
01:20

Action
[ Show Information ]

Title
Engine Room

Message
Take a closer look.

[ Save ]
```

This allows users to build interactive 360° video without programming.

---

# 24. Video Timeline Philosophy

The timeline should behave like a familiar creative tool.

Users should be able to:

- Drag interaction points
- Move interactions
- Delete interactions
- Duplicate interactions
- Preview from a selected point
- Play / pause while editing
- Jump to interaction points

The timeline should remain simple rather than becoming a professional video-editing suite.

---

# 25. Preview Mode

There must be a clear distinction between Edit and Preview.

Edit Mode:

```text
Tool panel
Properties
Guides
Selection
Editing controls
```

Preview Mode:

```text
Only the final visitor experience
```

The user should be able to press **Preview** and immediately experience what the customer or visitor will see.

Preview should also provide optional device simulation for mobile layout and capability fallbacks without exposing browser internals.

---

# 26. Publish Flow

Publishing should be extremely simple.

```text
Publish Experience

Name
[ Hotel Experience ]

URL
[ hotel-experience ]

Visibility
○ Public
○ Private

[ Publish ]
```

After publishing:

```text
✓ Published successfully

[ Copy Link ]
[ Embed ]
[ QR Code ]
```

The user should never need to configure hosting, CDN rules, cache headers, or viewer bundles.

---

# 27. Sharing

Every published experience can provide:

## Direct URL

```text
yourplatform.com/view/hotel-experience
```

## Embed

Generate embed code automatically. The user only clicks **Copy Embed Code**.

## QR Code

Generate a QR code for the experience.

Potential uses:

- Hotels
- Restaurants
- Real estate
- Museums
- Tourism
- Events
- Showrooms
- Education
- Construction
- Retail
- Campuses
- Industrial training

---

# 28. Internal Technical Architecture

Photo Sphere Viewer should be treated as the **rendering engine**, not the product itself.

```text
                         YOUR PLATFORM
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
     Authoring UX        Media Pipeline        Publishing
          │                    │                    │
          └──────────────┬─────┴─────┬──────────────┘
                         │           │
                   EXPERIENCE ENGINE
                         │
       ┌─────────────────┼──────────────────────────┐
       │                 │                          │
   Experience        Capability                Runtime
     Model            Resolver                 Services
       │                 │                          │
       ├── Viewer        ├── Plugins                ├── Cache
       ├── Scenes        ├── Adapters               ├── Preload
       ├── Hotspots      ├── Dependencies           ├── Analytics
       ├── Timeline      ├── Device support         ├── Lifecycle
       └── Branding      └── Fallbacks              └── Security
                         │
                  Photo Sphere Viewer
                         │
                      Three.js
```

Photo Sphere Viewer provides underlying capabilities for:

- Panorama rendering
- 360° video rendering
- Equirectangular / cubemap adapters
- Tiled panorama adapters
- Markers
- Virtual tours
- Gallery
- Resolution controls
- Gyroscope
- Stereo
- Maps / plans
- Compass
- Visible-range constraints
- Overlays
- Navigation
- Viewer events
- Plugin extension

The platform provides:

- Product abstraction
- Stable Experience schema
- No-code editor
- Asset library
- Media optimization
- Capability resolution
- Publishing
- Security
- Analytics
- Device fallbacks
- Runtime quality policy

The Experience Engine is the contract between the product and the renderer.

---

# 29. Product Data Model

The platform should have its own stable Experience model.

Conceptually:

```text
Project
│
├── id
├── type
├── name
├── schemaVersion
├── settings
├── branding
│
├── assets
│   ├── source
│   ├── mediaType
│   ├── projection
│   ├── metadata
│   ├── derivatives
│   └── processingStatus
│
├── scenes
│   ├── panoramaAssetId
│   ├── initialView
│   ├── viewLimits
│   ├── hotspots
│   ├── overlays
│   ├── connections
│   ├── spatialData
│   └── runtimeHints
│
└── interactions
```

For video:

```text
Project
│
├── type
├── videoAssetId
├── settings
├── branding
│
└── timeline
    ├── interaction
    ├── hotspot
    ├── viewpoint
    └── CTA
```

Example internal hotspot abstraction:

```text
Hotspot
├── id
├── geometry
│   ├── point
│   ├── polygon
│   ├── polyline
│   └── layer
├── position
├── appearance
├── content
├── action
└── visibilityRules
```

Important rule:

> **Do not make Photo Sphere Viewer configuration your database model.**

Translate the stable product model into viewer configuration at runtime.

This allows renderer versions, plugins, adapters, and even the rendering technology itself to change without rebuilding every saved customer project.

---

# 30. Future Product Expansion

Once the Image and Video creators are stable, the same platform can support:

```text
360° Image
360° Video
360° Gallery
360° Virtual Tour
Interactive 360° Experience
Live 360° Experience
```

These should not become disconnected applications.

```text
                 EXPERIENCE PLATFORM
                         │
       ┌─────────────────┼─────────────────┐
       │                 │                 │
   Image Creator    Video Creator     Tour Creator
       │                 │                 │
       └─────────────────┼─────────────────┘
                         │
                  EXPERIENCE PLAYER
                         │
                  Photo Sphere Viewer
```

All experiences can share:

- Assets
- Branding
- Editor components
- Hotspots
- Publishing
- Sharing
- Embedding
- Analytics
- User accounts
- Projects
- Templates
- Security policy
- Media processing
- Capability resolution

---

# 31. Core UX Rule

The entire product should follow this principle:

> **The user should interact with the experience, not configure the technology behind it.**

Instead of:

```text
Configure MarkerPlugin
```

show:

```text
Add Hotspot
```

Instead of:

```text
Configure Virtual Tour Node
```

show:

```text
Add Scene
```

Instead of:

```text
Configure navbar
```

show:

```text
Viewer Controls
```

Instead of:

```text
Configure adapter
```

show:

```text
Upload 360° Image
```

Instead of:

```text
panoData / poseRoll
```

show:

```text
Straighten Panorama
```

Instead of:

```text
EquirectangularTilesAdapter
```

show:

```text
Optimized High Quality
```

---

# 32. Editor Layout — Final Direction

Preferred editor structure:

```text
┌─────────────────────────────────────────────────────────────┐
│ ← Projects    Experience Name       Preview   Save Publish │
├──────┬──────────────────────────────────────────┬───────────┤
│      │                                          │           │
│ TOOL │                                          │ PROPERTY  │
│PANEL │                                          │  PANEL    │
│      │                                          │           │
│ Media│                                          │ Contextual│
│ Hotsp│             360° VIEWER                  │ settings  │
│ Scenes│                                         │           │
│ Info │                                          │           │
│ Video│                                          │           │
│ Gallery│                                        │           │
│ Design│                                         │           │
│ Brand│                                          │           │
│ Settings│                                       │           │
│      │                                          │           │
└──────┴──────────────────────────────────────────┴───────────┘
```

Default state: **Tool Panel + Viewer**

When an object is selected: **Tool Panel + Viewer + Properties**

When the user closes the tool panel: **Full-screen Viewer + compact toolbar**

This keeps the panorama visible at all times.

---

# 33. Product Development Priority — Revised

The first version should **not attempt to expose every Photo Sphere Viewer capability**. However, the architecture should avoid decisions that block advanced media and runtime efficiency later.

## Phase 1 — Core Product + Production Foundation

```text
Authentication
Dashboard
Projects
Upload 360° image
Image editor
Viewer
Basic point hotspots
Information panels
Basic appearance
Branding
Preview
Publish
Share
Embed
Asset metadata inspection
XMP / cropped-panorama handling where available
Thumbnail + optimized web derivative generation
CDN-ready asset delivery
HTML/content sanitization
Viewer lifecycle cleanup
Basic runtime telemetry
```

## Phase 2 — Rich Experiences + Tour Efficiency

```text
Scenes
Gallery
Image content
Video content
Links
Scene connections
Auto rotation
Advanced navigation
Compass
View limits
Adjacent-scene preloading
Scene cache policy
Large-tour progressive node loading
```

## Phase 3 — 360° Video

```text
Video upload
Video viewer
Timeline
Timed interactions
Hotspots
Viewpoint changes
CTA
Video settings
Poster generation
Desktop + mobile playback profiles
Device capability checks
Playback telemetry
```

## Phase 4 — Advanced Immersive & Spatial

```text
Map / Plan
GPS scene data
Gyroscope
VR / Stereo
High-resolution tiled panoramas
Quality / resolution controls where appropriate
Advanced overlays
Advanced marker geometry
Cubemap support
Templates
Analytics
Team collaboration
```

## Phase 5 — Professional / Scale Capabilities

```text
Multi-level tiling pipeline
Large enterprise tours
Dual-fisheye ingest where justified
Live / MediaStream 360° input
Custom interaction extensions
Advanced access controls
Versioned public API / SDK
Enterprise observability
```

---

# 34. Final Product Concept

```text
                 CREATE
                    ↓
        ┌─────────────────────┐
        │ 360° Image          │
        │ 360° Video          │
        └──────────┬──────────┘
                   ↓
          INGEST + OPTIMIZE
                   ↓
                 EDIT
                   ↓
        ┌─────────────────────┐
        │      Tool Panel     │
        │          +          │
        │    360° Viewer      │
        │          +          │
        │ Contextual Settings │
        └──────────┬──────────┘
                   ↓
                PREVIEW
                   ↓
                PUBLISH
                   ↓
       ┌───────────┼───────────┐
       ↓           ↓           ↓
      URL        Embed        QR
```

The **360° viewer is the canvas**.

The **tool panel is the toolbox**.

The **properties panel is contextual**.

The **Experience Engine is the product layer**.

The **Media Pipeline makes assets efficient**.

The **Capability Resolver makes combinations safe**.

**Photo Sphere Viewer is the underlying rendering engine.**

---

# 35. Media Ingestion & Derivative Pipeline

Media processing must become a first-class platform service.

For panoramas:

```text
Original Upload
      ↓
Validate File
      ↓
Inspect Metadata / XMP / Projection
      ↓
Normalize Orientation if needed
      ↓
Generate Thumbnail
      ↓
Generate Low-Resolution Base
      ↓
Generate Standard Web Derivative
      ↓
Generate Tiles / Higher Levels when policy requires
      ↓
Store + CDN
```

For video:

```text
Original Upload
      ↓
Validate Container / Codec
      ↓
Inspect Dimensions / Duration / Audio
      ↓
Generate Poster
      ↓
Transcode Desktop Profile
      ↓
Transcode Mobile-Compatible Profile
      ↓
Optional Additional Profiles
      ↓
Store + CDN
```

The editor should work against logical assets while the player chooses the most appropriate derivative.

Processing status should be explicit internally:

```text
uploaded → inspecting → processing → ready → failed
```

Failures must be recoverable and should not corrupt the project model.

---

# 36. Performance & Delivery Strategy

Performance is an Experience Engine responsibility.

## 36.1 High-Resolution Panorama Policy

Large panoramas should use a low-resolution base image followed by tiles or appropriate high-resolution derivatives. The first meaningful view should not require downloading the entire highest-resolution source.

Recommended behavior:

```text
Open Experience
   ↓
Load thumbnail / low-res base
   ↓
Render immediately
   ↓
Load required higher-detail regions
   ↓
Continue loading as view/zoom requires
```

## 36.2 Caching

The runtime should define an explicit cache policy for recently used panoramas and scene assets.

Goals:

- Fast back-navigation
- Controlled memory use
- Avoid duplicate network requests
- Predictable behavior on long sessions

Cache limits should be platform-controlled and tuned per asset type/device class.

## 36.3 Preloading

Do not preload everything.

Prefer likely-next-scene behavior:

```text
Current Scene
├── preload strongest connected scene
├── maybe preload second likely scene
└── do not download unrelated full-resolution scenes
```

Preloading can use link importance, user navigation history, scene graph proximity, or explicit creator hints.

## 36.4 Bundle Efficiency

Lazy-load heavy or uncommon capabilities where possible:

- Map / Plan
- Stereo / VR
- Video tooling
- Advanced overlays
- Specialized adapters

The initial player bundle should not carry every possible feature for every experience.

---

# 37. Large Tours & Progressive Loading

The platform must support two runtime strategies.

## Small Tour

All scene metadata can be delivered with the experience manifest.

## Large Tour

Scene metadata and assets should be loaded progressively.

```text
Experience Manifest
├── initial scene
├── global settings
├── branding
└── lightweight scene index

User navigates
      ↓
Fetch scene definition
      ↓
Load optimized panorama
      ↓
Preload likely next nodes
```

This prevents 100+ scene experiences from becoming unnecessarily heavy at startup.

The Experience schema should support both strategies without changing the editor mental model.

---

# 38. Panorama Formats & Rendering Quality

The domain model should be projection-aware without exposing projection complexity to ordinary users.

Supported or planned internal media families:

- Full equirectangular panorama
- Cropped / partial equirectangular panorama
- Tiled equirectangular panorama
- Cubemap panorama
- Tiled cubemap panorama
- Equirectangular video
- Cubemap video
- Dual-fisheye inputs where justified

## 38.1 Cropped / Partial Panorama

When metadata exists, use it automatically. When it does not, provide a visual correction workflow rather than raw coordinates.

## 38.2 Sphere Correction

Expose a user-level **Straighten Panorama** experience that can map internally to heading/pitch/roll correction.

## 38.3 Rendering Quality

The renderer currently supports an opt-in shader-based equirectangular rendering path that improves pole quality. Treat renderer-quality selection as an internal compatibility/performance decision unless users have a clear reason to choose it.

Quality policy should be test-driven across representative devices before a renderer option becomes a default.

---

# 39. Advanced Hotspot & Overlay Model

The initial UI can remain pin-oriented, but the domain should be capable of richer interaction geometry.

```text
Interaction Geometry
├── Point
├── Area / Polygon
├── Line / Polyline
├── Image Layer
├── Video Layer
└── Custom Component
```

Potential use cases:

- Floor / wall area highlight
- Equipment annotation
- Route or path guidance
- Before / after visual layer
- Construction progress overlay
- Product placement layer
- Interactive signage
- Chroma-key or transparent media layer

Advanced overlays should preserve the same product rule: creators work with visual concepts rather than spherical-mesh configuration.

---

# 40. Capability & Dependency Resolver

Do not let the editor directly assemble arbitrary renderer plugins/adapters.

The Experience Engine should maintain a capability registry.

Conceptually:

```text
Capability
├── id
├── productFeature
├── rendererModule
├── dependencies
├── incompatibilities
├── deviceRequirements
├── mediaRequirements
├── lazyLoadModule
└── fallback
```

Examples of rules the resolver must understand:

- 360° video requires the corresponding video adapter/runtime support.
- Stereo mode relies on motion/orientation behavior and should only appear when the device/runtime can support the experience.
- Some renderer features are incompatible when enabled simultaneously; the product must resolve or redesign the combination rather than showing a technical error.
- Map / Plan features require spatial data and should not appear for projects without meaningful location context.
- Tiled media requires the appropriate derivative assets.

A specific current PSV example is that Gallery and Resolution plugins are not compatible. The product should therefore avoid mapping user features one-to-one to raw plugin toggles.

---

# 41. Device & Browser Compatibility

The player should perform capability detection at runtime and degrade gracefully.

Potential capability classes:

```text
Touch input
Keyboard input
Fullscreen
Device orientation
Stereo suitability
Video codec support
Hardware / GPU limits
Network quality
Viewport size
```

The user experience should never fail merely because an optional immersive feature is unavailable.

Example fallback:

```text
VR / Stereo requested
        ↓
Capability available? ── Yes → Enable immersive mode
        │
        No
        ↓
Continue in normal 360° mode
```

Video requires extra care. The current PSV equirectangular video documentation warns that video above 4096 pixels may not display on handheld devices. The media pipeline should therefore create and select mobile-compatible profiles rather than relying on the original upload.

---

# 42. Security & Content Trust Boundary

The platform is multi-user and no-code, so it must treat authored content as untrusted by default.

Any rich text or HTML-capable content passed to the viewer must be sanitized.

This includes, where applicable:

- Captions
- Descriptions
- Information panels
- Tooltips
- Custom marker content
- Overlay text
- Custom navigation content

Security policy should cover:

- HTML sanitization
- URL validation
- External-link policy
- File type validation
- SVG handling policy
- Upload malware scanning where required
- Signed/private asset delivery
- Authorization for private experiences
- CSP strategy
- Embed origin controls for paid/private plans

Security belongs in shared platform services, not individual editor components.

---

# 43. Runtime Lifecycle & Observability

Every experience player should have predictable lifecycle management.

Important responsibilities:

- Create viewer only when required
- Cleanly destroy viewer and event listeners on unmount/navigation
- Release media elements and GPU resources
- Avoid duplicate plugin subscriptions
- Cancel obsolete asset requests where practical
- Track asset load failures
- Track scene transition failures
- Capture client performance signals

Useful runtime metrics:

```text
Experience load started
First panorama visible
Time to interactive
Scene changed
Hotspot clicked
Video started
Video stalled
Asset failed
Viewer error
Experience exited
```

These events support both product analytics and operational debugging.

---

# 44. Versioning & Viewer Integration Contract

The platform should isolate Photo Sphere Viewer behind a versioned adapter layer.

```text
Experience Schema
      ↓
Experience Compiler
      ↓
Viewer Integration Adapter
      ↓
Photo Sphere Viewer Version X
```

Rules:

- Saved projects never store raw PSV config as their canonical model.
- Viewer-specific defaults live in the integration adapter.
- Plugin compatibility lives in the capability resolver.
- Viewer upgrades are tested against a reference experience suite.
- Breaking renderer changes should require adapter changes, not customer-data migrations wherever possible.
- The Experience schema itself should be versioned.

Reference test experiences should include:

- Basic panorama
- Cropped panorama
- High-resolution panorama
- Multi-scene tour
- Gallery
- Hotspots
- Map / plan
- Gyroscope / stereo fallback
- 360° video
- Timed interactions
- Advanced overlay

---

# 45. Efficiency & Quality Bar

A feature is not considered complete merely because it renders.

For every major capability, evaluate:

## Product Efficiency

- Can a first-time user understand it without documentation?
- Can the task be completed visually?
- Are advanced controls hidden until required?

## Network Efficiency

- Are oversized assets avoided?
- Are thumbnails/base derivatives used?
- Are high-resolution tiles or derivatives loaded progressively where appropriate?

## Runtime Efficiency

- Is memory bounded?
- Are scenes cached intelligently?
- Are optional modules lazy-loaded?
- Are viewer instances destroyed cleanly?

## Device Efficiency

- Does mobile receive an appropriate media profile?
- Is an unsupported capability gracefully downgraded?

## Data Efficiency

- Are large tours progressively fetched?
- Are reusable assets deduplicated?
- Are project records renderer-independent?

## Operational Efficiency

- Can failures be diagnosed from telemetry?
- Can an asset be reprocessed without rebuilding the project?
- Can a viewer upgrade be rolled out independently of saved Experience data?

---

# 46. Photo Sphere Viewer Coverage Map

The platform should consider the following PSV capability families in its long-term architecture.

```text
PSV Core / Adapter Capability          Product Abstraction
────────────────────────────────────────────────────────────
Equirectangular panorama              Upload 360° Image
Cropped panorama / XMP                Automatic detection / correction
Equirectangular tiles                 Optimized High Quality
Cubemap / cubemap tiles               Advanced panorama format
Equirectangular / cubemap video       360° Video
Dual fisheye                          Pro camera ingest
Markers                               Hotspots / annotations
Virtual Tour                          Scenes / connections
Gallery                               Gallery
Autorotate                            Auto Rotation
Compass                               Compass
Visible Range                         Allowed Viewing Area
Map / Plan                            Map / Floor Plan
Gyroscope                             Motion Navigation
Stereo                                VR / Stereo
Overlays                              Visual Overlays
Resolution                            Quality options / derivatives
Video plugin                          Playback + video interactions
Viewer methods/events                 Experience runtime orchestration
Custom plugins                        Extension layer
```

The goal is not to expose every row as a setting. The goal is to ensure the product model and architecture can exploit the capability when a valuable user experience requires it.

---

# 47. Final Recommendation

The product should not add a large number of visible controls merely to match a rendering library feature-for-feature.

The visible editor should remain simple.

The major investment should be underneath the editor:

- Stable Experience schema
- Media intelligence
- High-resolution tiling strategy
- Video transcoding and mobile profiles
- Caching
- Smart preloading
- Progressive tour loading
- Projection / XMP handling
- Sphere correction
- Capability dependency resolution
- Security and content sanitization
- Device fallbacks
- Runtime observability
- Versioned viewer integration

If these are built well, the platform becomes more than a UI around Photo Sphere Viewer. It becomes a scalable **360° authoring and delivery system** with PSV serving as one specialized rendering component.

The final product principle remains:

> **The user configures the experience. The platform configures the technology.**

---

# Appendix A — Current Photo Sphere Viewer Validation Notes

This revision was validated against the Photo Sphere Viewer documentation current at version 5.14.3 in August 2026.

Important implementation facts reflected in this specification include:

- PSV supports full/partial equirectangular, tiled equirectangular, cubemap, tiled cubemap, video and dual-fisheye adapter families.
- Tiled equirectangular loading is designed to reduce initial loading time and bandwidth and can use a low-resolution base panorama.
- PSV includes a configurable global panorama cache.
- Virtual tours support linked-node preloading and server-mode node fetching.
- Markers support a richer model than simple point pins.
- Cropped panorama information can be read from XMP metadata.
- The current equirectangular renderer exposes an opt-in shader mode for improved pole rendering quality.
- Current equirectangular video documentation specifies a 4096-pixel handheld constraint and supports URL, MediaStream, or existing HTMLVideoElement sources.
- Rich HTML-capable viewer content requires sanitization when input is untrusted.
- Current Gallery and Resolution plugins are documented as incompatible.

These are implementation inputs, not product vocabulary. They belong primarily in the Experience Engine, media pipeline, and capability resolver.

---

# Appendix B — Official Technical References

Engineering validation should use the current official Photo Sphere Viewer documentation rather than copying assumptions from this specification indefinitely.

- [Photo Sphere Viewer — Main Documentation](https://photo-sphere-viewer.js.org/)
- [Configuration and Cache](https://photo-sphere-viewer.js.org/guide/config)
- [Supported Adapters](https://photo-sphere-viewer.js.org/guide/adapters/)
- [Equirectangular and Cropped Panorama](https://photo-sphere-viewer.js.org/guide/adapters/equirectangular.html)
- [Equirectangular Tiles](https://photo-sphere-viewer.js.org/guide/adapters/equirectangular-tiles.html)
- [Equirectangular Video](https://photo-sphere-viewer.js.org/guide/adapters/equirectangular-video.html)
- [Markers Plugin](https://photo-sphere-viewer.js.org/plugins/markers.html)
- [Virtual Tour Plugin](https://photo-sphere-viewer.js.org/plugins/virtual-tour.html)
- [Gallery Plugin](https://photo-sphere-viewer.js.org/plugins/gallery)

The platform should pin an explicit PSV version in production and review these references when upgrading the renderer integration.
