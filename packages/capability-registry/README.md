# @alishaikh110/capability-registry

Capability definitions, their dependencies, incompatibilities and fallbacks.

Part of the shared package set released in lockstep by the
[Sphere backend](https://github.com/AliShaikh110/photo-sphere-backend). The six
packages always carry the same version; installing one at a different version
than the rest is unsupported and the compatibility check rejects it.

The single description of what an experience can be asked to do, and what
happens when a target cannot do it.

## Install

Published privately to GitHub Packages. See
[docs/shared-packages.md](https://github.com/AliShaikh110/photo-sphere-backend/blob/main/docs/shared-packages.md)
for registry authentication, the version policy and the startup compatibility
check every consumer must run.

```bash
npm install @alishaikh110/capability-registry
```

## Version

```ts
import { CAPABILITY_REGISTRY_PACKAGE_NAME, CAPABILITY_REGISTRY_PACKAGE_VERSION } from '@alishaikh110/capability-registry';
```

Changes are recorded in
[packages/CHANGELOG.md](https://github.com/AliShaikh110/photo-sphere-backend/blob/main/packages/CHANGELOG.md).
