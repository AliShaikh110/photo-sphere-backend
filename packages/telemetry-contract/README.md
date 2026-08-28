# @alishaikh110/telemetry-contract

Runtime telemetry event names and payload schemas shared by the platform and its players.

Part of the shared package set released in lockstep by the
[Sphere backend](https://github.com/AliShaikh110/photo-sphere-backend). The six
packages always carry the same version; installing one at a different version
than the rest is unsupported and the compatibility check rejects it.

Ingest validates against these zod schemas and a player builds against them, so
both sides of the wire are described once. `zod` is a peer dependency: the
schemas cross the package boundary, and two zod instances in one application
produce failures that are very hard to read.

## Install

Published privately to GitHub Packages. See
[docs/shared-packages.md](https://github.com/AliShaikh110/photo-sphere-backend/blob/main/docs/shared-packages.md)
for registry authentication, the version policy and the startup compatibility
check every consumer must run.

```bash
npm install @alishaikh110/telemetry-contract
```

## Version

```ts
import { TELEMETRY_CONTRACT_PACKAGE_NAME, TELEMETRY_CONTRACT_PACKAGE_VERSION } from '@alishaikh110/telemetry-contract';
```

Changes are recorded in
[packages/CHANGELOG.md](https://github.com/AliShaikh110/photo-sphere-backend/blob/main/packages/CHANGELOG.md).
