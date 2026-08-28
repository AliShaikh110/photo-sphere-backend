import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CAPABILITY_REGISTRY_PACKAGE_NAME, CAPABILITY_REGISTRY_PACKAGE_VERSION } from '@alishaikh110/capability-registry';
import { EXPERIENCE_COMPILER_PACKAGE_NAME, EXPERIENCE_COMPILER_PACKAGE_VERSION } from '@alishaikh110/experience-compiler';
import {
  EXPERIENCE_SCHEMA_PACKAGE_NAME,
  EXPERIENCE_SCHEMA_PACKAGE_VERSION,
  SHARED_PACKAGE_NAMES,
  comparePackageVersions
} from '@alishaikh110/experience-schema';
import { LIVE_PATCH_PACKAGE_NAME, LIVE_PATCH_PACKAGE_VERSION } from '@alishaikh110/live-patch';
import { TELEMETRY_CONTRACT_PACKAGE_NAME, TELEMETRY_CONTRACT_PACKAGE_VERSION } from '@alishaikh110/telemetry-contract';
import { VIEWER_INTEGRATION_PACKAGE_NAME, VIEWER_INTEGRATION_PACKAGE_VERSION } from '@alishaikh110/viewer-integration';

import {
  BACKEND_PACKAGE_VERSIONS,
  MINIMUM_COMPATIBLE_PACKAGE_VERSION,
  sharedPackageContract
} from '../../../apps/api/src/contracts/shared-packages';

/**
 * The publishing contract, asserted from the suite rather than only from the
 * release script.
 *
 * `npm run packages:check` enforces the same invariants and is what gates a
 * release, but it needs a build. These run in `npm test`, so a manifest edited
 * in the wrong direction fails on the commit that makes it rather than on the
 * day someone tries to publish.
 */

const repositoryRoot = path.resolve(__dirname, '..', '..', '..');
const packagesRoot = path.join(repositoryRoot, 'packages');
const SCOPE = '@alishaikh110';

/** Third-party runtime code the set is allowed to carry. Mirrors scripts/shared-packages.mjs. */
const ALLOWED_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = {
  'experience-schema': ['sanitize-html']
};
const ALLOWED_PEERS: Readonly<Record<string, readonly string[]>> = {
  'telemetry-contract': ['zod']
};

interface Manifest {
  readonly name: string;
  readonly version: string;
  readonly private?: boolean;
  readonly sideEffects?: unknown;
  readonly main?: string;
  readonly module?: string;
  readonly types?: string;
  readonly files?: readonly string[];
  readonly exports?: unknown;
  readonly engines?: Record<string, string>;
  readonly publishConfig?: Record<string, string>;
  readonly repository?: Record<string, string>;
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
}

function directories(): string[] {
  return readdirSync(packagesRoot)
    .filter((entry) => statSync(path.join(packagesRoot, entry)).isDirectory())
    .sort();
}

function manifest(name: string): Manifest {
  return JSON.parse(readFileSync(path.join(packagesRoot, name, 'package.json'), 'utf8')) as Manifest;
}

const RUNTIME_VERSIONS: Readonly<Record<string, string>> = {
  [TELEMETRY_CONTRACT_PACKAGE_NAME]: TELEMETRY_CONTRACT_PACKAGE_VERSION,
  [CAPABILITY_REGISTRY_PACKAGE_NAME]: CAPABILITY_REGISTRY_PACKAGE_VERSION,
  [EXPERIENCE_SCHEMA_PACKAGE_NAME]: EXPERIENCE_SCHEMA_PACKAGE_VERSION,
  [VIEWER_INTEGRATION_PACKAGE_NAME]: VIEWER_INTEGRATION_PACKAGE_VERSION,
  [EXPERIENCE_COMPILER_PACKAGE_NAME]: EXPERIENCE_COMPILER_PACKAGE_VERSION,
  [LIVE_PATCH_PACKAGE_NAME]: LIVE_PATCH_PACKAGE_VERSION
};

describe('the published package set', () => {
  it('is exactly the six packages the contract names', () => {
    expect(directories().map((name) => `${SCOPE}/${name}`).sort())
      .toEqual([...SHARED_PACKAGE_NAMES].sort());
  });

  it('moves in lockstep', () => {
    const versions = new Set(directories().map((name) => manifest(name).version));
    expect([...versions]).toHaveLength(1);
  });

  it('pins every sibling to the exact lockstep version', () => {
    const version = manifest('experience-compiler').version;
    for (const name of directories()) {
      for (const [dependency, range] of Object.entries(manifest(name).dependencies ?? {})) {
        if (!dependency.startsWith(`${SCOPE}/`)) continue;
        // A range would let a resolver assemble a combination nobody has tested.
        expect({ package: name, dependency, range }).toMatchObject({ range: version });
      }
    }
  });

  it('carries no runtime dependency outside the allowlist', () => {
    for (const name of directories()) {
      const allowed = new Set<string>([
        ...(ALLOWED_DEPENDENCIES[name] ?? []),
        ...SHARED_PACKAGE_NAMES
      ]);
      for (const dependency of Object.keys(manifest(name).dependencies ?? {})) {
        expect({ package: name, dependency, allowed: allowed.has(dependency) })
          .toMatchObject({ allowed: true });
      }
    }
  });

  it('declares zod as a peer so a consumer never holds two copies', () => {
    for (const name of directories()) {
      const declared = Object.keys(manifest(name).peerDependencies ?? {}).sort();
      expect({ package: name, declared })
        .toMatchObject({ declared: [...(ALLOWED_PEERS[name] ?? [])].sort() });
    }
  });

  it('is publishable: not private, scoped, and pointed at the private registry', () => {
    for (const name of directories()) {
      const found = manifest(name);
      // `private: true` is what the workspace used before these were released;
      // leaving it on any of them would make `npm publish` refuse silently.
      expect({ directory: name, private: found.private }).toMatchObject({ private: undefined });
      expect({ directory: name, ...found }).toMatchObject({
        name: `${SCOPE}/${name}`,
        sideEffects: false,
        main: './dist/index.cjs',
        module: './dist/index.mjs',
        types: './dist/index.d.ts'
      });
      expect(found.files).toEqual(['dist', 'README.md']);
      expect(found.publishConfig).toEqual({
        registry: 'https://npm.pkg.github.com',
        access: 'restricted'
      });
      expect(found.repository?.directory).toBe(`packages/${name}`);
      expect(found.engines?.node).toBeTruthy();
    }
  });

  it('exposes one entry point in both module systems, types first', () => {
    for (const name of directories()) {
      expect({ directory: name, exports: manifest(name).exports }).toMatchObject({
        exports: {
          '.': {
            // `types` must precede `default`: a condition matched earlier wins,
            // and a consumer that resolves the JavaScript first gets no types.
            import: { types: './dist/index.d.mts', default: './dist/index.mjs' },
            require: { types: './dist/index.d.ts', default: './dist/index.cjs' }
          },
          './package.json': './package.json'
        }
      });
    }
  });

  it('reports its own version at runtime, matching package.json', () => {
    for (const name of directories()) {
      const found = manifest(name);
      expect({ package: found.name, runtime: RUNTIME_VERSIONS[found.name] })
        .toMatchObject({ runtime: found.version });
    }
  });
});

describe('the backend compatibility contract', () => {
  it('covers every package in the set', () => {
    expect(Object.keys(BACKEND_PACKAGE_VERSIONS).sort()).toEqual([...SHARED_PACKAGE_NAMES].sort());
  });

  it('reports the versions this process actually loaded', () => {
    expect(BACKEND_PACKAGE_VERSIONS).toEqual(RUNTIME_VERSIONS);
  });

  it('never asks a frontend for a release the backend is not itself running', () => {
    for (const [name, version] of Object.entries(BACKEND_PACKAGE_VERSIONS)) {
      expect(
        { name, version, atLeastMinimum: comparePackageVersions(version, MINIMUM_COMPATIBLE_PACKAGE_VERSION) >= 0 },
        `${name} is ${version} but the floor is ${MINIMUM_COMPATIBLE_PACKAGE_VERSION}`
      ).toMatchObject({ atLeastMinimum: true });
    }
  });

  it('raises the floor to the current major, which is the rule that gets missed', () => {
    const [backendMajor] = EXPERIENCE_COMPILER_PACKAGE_VERSION.split('.');
    const [floorMajor] = MINIMUM_COMPATIBLE_PACKAGE_VERSION.split('.');
    // A frontend a major behind holds a different classification table. Leaving
    // the floor below the current major is what lets that reach production.
    expect({ floorMajor, backendMajor }).toMatchObject({ floorMajor: backendMajor });
  });

  it('publishes a contract a frontend can act on without further lookups', () => {
    const contract = sharedPackageContract();
    expect(contract.registry).toBe('https://npm.pkg.github.com');
    expect(contract.scope).toBe(SCOPE);
    expect(contract.minimumCompatibleVersion).toBe(MINIMUM_COMPATIBLE_PACKAGE_VERSION);
    expect(contract.backendPackageVersions).toEqual(BACKEND_PACKAGE_VERSIONS);
  });
});
